import type {
  DetectTextResult,
  OrgTextMatchMode,
  RekognitionTextDetection,
} from '../types.js';

// ---------------------------------------------------------------------------
// OCR text evaluation rules (ported 1:1 from the original .mjs implementation)
// ---------------------------------------------------------------------------

export interface TextRulesDefaults {
  allowedOrgText: string[];
  orgTextMatchMode: OrgTextMatchMode;
  minOcrConfidence: number;
  allowEInsideWords: boolean;
  countStandaloneE: boolean;
}

export const DEFAULTS: TextRulesDefaults = {
  allowedOrgText: [],
  orgTextMatchMode: 'tokens',
  minOcrConfidence: 60,
  allowEInsideWords: false,
  countStandaloneE: true,
};

export interface TextRulesConfig {
  allowedOrgText: string[];
  orgTextMatchMode: OrgTextMatchMode;
  minOcrConfidence: number;
  allowEInsideWords: boolean;
  countStandaloneE: boolean;
}

export interface TextItem {
  text: string;
  confidence: number;
  type?: string;
}

export interface OcrItem extends TextItem {
  index: number;
  normalized: string;
  type: string;
  id: number;
  parentId: number | null;
}

export interface EEvidence {
  source: string;
  token: string;
  confidence: number;
  kind: 'standalone' | 'inside-word';
}

export interface StandaloneEResult {
  rule: 'any-position' | 'standalone' | 'disabled';
  counted: boolean;
  count: number;
  standaloneCount: number;
  insideWordCount: number;
  evidence: EEvidence[];
  skippedLowConfidence: number;
}

export interface OrgTextMatch {
  term: string;
  confidence: number;
}

export interface OrgTextResult {
  mode: OrgTextMatchMode;
  terms: string[];
  found: boolean;
  matches: OrgTextMatch[];
}

export interface EvaluatedText {
  config: TextRulesConfig;
  itemCount: number;
  electionCount: number;
  usableItemCount: number;
  normalized: string;
  items: OcrItem[];
  standaloneE: StandaloneEResult;
  orgText: OrgTextResult;
  checks: { standaloneE: boolean; orgText: boolean };
}

export interface ScoreInput {
  faceMatched?: boolean;
  faceSimilarity?: number | null;
  threshold?: number;
  standaloneEFound?: boolean;
  orgTextFound?: boolean;
  weights?: { face?: number; e?: number; orgText?: number };
  enabled?: { face?: boolean; e?: boolean; orgText?: boolean };
}

export interface ScoreResult {
  breakdown: { face: number; standaloneE: number; orgText: number };
  total: number;
  max: number;
  weights: { face: number; e: number; orgText: number };
  active: { face: boolean; e: boolean; orgText: boolean };
}

export function normalizeText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return String(input)
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(input: unknown): string[] {
  const n = normalizeText(input);
  return n === '' ? [] : n.split(' ');
}

function coerceNumber(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function coerceBool(v: unknown, d: boolean): boolean {
  if (v === undefined || v === null || v === '') return d;
  if (typeof v === 'boolean') return v;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function coerceList(v: unknown, d: string[]): string[] {
  if (Array.isArray(v)) return v.map((s) => normalizeText(s)).filter(Boolean);
  if (v === undefined || v === null || v === '') return d;
  return String(v)
    .split(',')
    .map((s) => normalizeText(s))
    .filter(Boolean);
}

export function parseConfig(raw: Record<string, unknown> = {}): TextRulesConfig {
  const mode = String(raw.orgTextMatchMode ?? DEFAULTS.orgTextMatchMode).toLowerCase();
  return {
    allowedOrgText: coerceList(raw.allowedOrgText, DEFAULTS.allowedOrgText),
    orgTextMatchMode: mode === 'substring' ? 'substring' : 'tokens',
    minOcrConfidence: coerceNumber(raw.minOcrConfidence, DEFAULTS.minOcrConfidence),
    allowEInsideWords: coerceBool(raw.allowEInsideWords, DEFAULTS.allowEInsideWords),
    countStandaloneE: coerceBool(raw.countStandaloneE, DEFAULTS.countStandaloneE),
  };
}

export function toOcrItems(detectTextResult: DetectTextResult): OcrItem[] {
  const items = Array.isArray(detectTextResult?.TextDetections)
    ? detectTextResult.TextDetections
    : [];
  return items
    .map((it: RekognitionTextDetection, idx: number): OcrItem => ({
      index: idx,
      text: String(it?.DetectedText ?? ''),
      normalized: normalizeText(it?.DetectedText ?? ''),
      confidence: Number(it?.Confidence ?? 0),
      type: String(it?.Type ?? 'WORD'),
      id: Number(it?.Id ?? idx),
      parentId:
        it?.ParentId === undefined || it.ParentId === null ? null : Number(it.ParentId),
    }))
    .filter((it) => it.text !== '');
}

export function isStandaloneE(token: string): boolean {
  return token === 'E';
}

export function containsE(token: string): boolean {
  return token.includes('E');
}

export function detectStandaloneE(items: TextItem[], cfg: TextRulesConfig): StandaloneEResult {
  const result: StandaloneEResult = {
    rule: cfg.allowEInsideWords ? 'any-position' : 'standalone',
    counted: false,
    count: 0,
    standaloneCount: 0,
    insideWordCount: 0,
    evidence: [],
    skippedLowConfidence: 0,
  };

  if (!cfg.countStandaloneE) {
    result.rule = 'disabled';
    return result;
  }

  for (const item of items) {
    if (item.confidence < cfg.minOcrConfidence) {
      result.skippedLowConfidence += 1;
      continue;
    }
    const tokens = tokenize(item.text);
    for (const token of tokens) {
      if (isStandaloneE(token)) {
        result.standaloneCount += 1;
        result.count += 1;
        result.evidence.push({
          source: item.text,
          token,
          confidence: item.confidence,
          kind: 'standalone',
        });
      } else if (cfg.allowEInsideWords && containsE(token)) {
        result.insideWordCount += 1;
        result.count += 1;
        result.evidence.push({
          source: item.text,
          token,
          confidence: item.confidence,
          kind: 'inside-word',
        });
      }
    }
  }

  result.evidence = result.evidence
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20);
  result.counted = result.count > 0;
  return result;
}

export function containsSubsequence(haystackTokens: string[], needleTokens: string[]): boolean {
  if (needleTokens.length === 0) return false;
  if (needleTokens.length > haystackTokens.length) return false;
  for (let i = 0; i <= haystackTokens.length - needleTokens.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needleTokens.length; j += 1) {
      if (haystackTokens[i + j] !== needleTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function averageConfidence(items: TextItem[]): number {
  if (!items.length) return 0;
  return round2(items.reduce((s, it) => s + it.confidence, 0) / items.length);
}

export function detectOrgText(items: TextItem[], cfg: TextRulesConfig): OrgTextResult {
  const usable = items.filter((it) => it.confidence >= cfg.minOcrConfidence);
  const docTokens = usable.flatMap((it) => tokenize(it.text));
  const docJoined = docTokens.join(' ');

  const matches: OrgTextMatch[] = [];
  for (const term of cfg.allowedOrgText) {
    const needleTokens = tokenize(term);
    if (needleTokens.length === 0) continue;
    const needle = needleTokens.join(' ');

    if (cfg.orgTextMatchMode === 'substring') {
      if (!docJoined.includes(needle)) continue;
      const participating = usable.filter((it) => normalizeText(it.text).includes(needle));
      matches.push({
        term,
        confidence: averageConfidence(participating.length ? participating : usable),
      });
      continue;
    }

    const participating = usable.filter((it) =>
      containsSubsequence(tokenize(it.text), needleTokens),
    );
    if (participating.length) {
      matches.push({ term, confidence: averageConfidence(participating) });
    } else if (containsSubsequence(docTokens, needleTokens)) {
      matches.push({ term, confidence: averageConfidence(usable) });
    }
  }

  return {
    mode: cfg.orgTextMatchMode,
    terms: cfg.allowedOrgText,
    found: matches.length > 0,
    matches,
  };
}

export function preferWords<T extends { type?: string }>(items: T[]): T[] {
  const words = items.filter((it) => it.type === 'WORD');
  return words.length ? words : items.filter((it) => it.type === 'LINE');
}

export function evaluateText(
  detectTextResult: DetectTextResult,
  rawCfg: Record<string, unknown> = {},
): EvaluatedText {
  const cfg = parseConfig(rawCfg);
  const items = toOcrItems(detectTextResult);
  const election = preferWords(items);
  const usable = election.filter((it) => it.confidence >= cfg.minOcrConfidence);

  const e = detectStandaloneE(election, cfg);
  const org = detectOrgText(election, cfg);

  return {
    config: cfg,
    itemCount: items.length,
    electionCount: election.length,
    usableItemCount: usable.length,
    normalized: normalizeText(usable.map((it) => it.text).join(' ')),
    items: items.slice(0, 100),
    standaloneE: e,
    orgText: org,
    checks: {
      standaloneE: e.counted,
      orgText: org.found,
    },
  };
}

export function computeScore({
  faceMatched,
  faceSimilarity,
  standaloneEFound,
  orgTextFound,
  weights,
  enabled,
}: ScoreInput): ScoreResult {
  const w = {
    face: Number(weights?.face ?? 50),
    e: Number(weights?.e ?? 25),
    orgText: Number(weights?.orgText ?? 25),
  };
  const active = {
    face: enabled?.face !== false,
    e: enabled?.e !== false,
    orgText: enabled?.orgText !== false,
  };
  const keys = (['face', 'e', 'orgText'] as const).filter((k) => active[k]);
  const denom = keys.reduce((sum, k) => sum + w[k], 0) || w.face + w.e + w.orgText;
  const scale = denom > 0 ? 100 / denom : 0;

  let face = 0;
  if (faceMatched && Number.isFinite(faceSimilarity)) {
    // Award points in proportion to how strong the match is (100% -> full weight).
    const ratio = Math.max(0, Math.min((faceSimilarity as number) / 100, 1));
    face = w.face * ratio;
  }

  const e = standaloneEFound ? w.e : 0;
  const orgText = orgTextFound ? w.orgText : 0;

  const earned = keys.reduce(
    (sum, k) => sum + (k === 'face' ? face : k === 'e' ? e : orgText),
    0,
  );

  return {
    breakdown: {
      face: round2(active.face ? face * scale : 0),
      standaloneE: round2(active.e ? e * scale : 0),
      orgText: round2(active.orgText ? orgText * scale : 0),
    },
    total: round2(earned * scale),
    max: 100,
    weights: w,
    active,
  };
}
