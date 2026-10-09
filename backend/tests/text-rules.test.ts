import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeText,
  tokenize,
  parseConfig,
  detectStandaloneE,
  detectOrgText,
  containsSubsequence,
  evaluateText,
  computeScore,
} from '../src/shared/text-rules.js';
import type { DetectTextResult } from '../src/types.js';

type Row = [text: string, confidence: number, type?: string];

const det = (list: Row[]): DetectTextResult => ({
  TextDetections: list.map(([text, confidence, type], i) => ({
    DetectedText: text,
    Confidence: confidence,
    Type: type ?? 'WORD',
    Id: i,
  })),
});

test('normalizeText strips punctuation and uppercases', () => {
  assert.equal(normalizeText('  Acme, Pvt. Ltd!! '), 'ACME PVT LTD');
  assert.equal(normalizeText('E.'), 'E');
  assert.equal(normalizeText('-E-'), 'E');
  assert.equal(normalizeText(null), '');
});

test('tokenize splits normalized text', () => {
  assert.deepEqual(tokenize('Hello E world'), ['HELLO', 'E', 'WORLD']);
});

test('standalone E is counted', () => {
  const cfg = parseConfig({});
  const r = detectStandaloneE([{ text: 'E', confidence: 99, type: 'WORD' }], cfg);
  assert.equal(r.counted, true);
  assert.equal(r.count, 1);
  assert.equal(r.rule, 'standalone');
});

test('E inside an unrelated word is NOT counted by default', () => {
  const cfg = parseConfig({});
  const r = detectStandaloneE(
    [
      { text: 'HELLO', confidence: 99, type: 'WORD' },
      { text: 'TEST', confidence: 99, type: 'WORD' },
      { text: 'GREEN', confidence: 99, type: 'WORD' },
    ],
    cfg,
  );
  assert.equal(r.counted, false);
  assert.equal(r.count, 0);
});

test('E inside a word IS counted when explicitly allowed', () => {
  const cfg = parseConfig({ allowEInsideWords: 'true' });
  const r = detectStandaloneE([{ text: 'HELLO', confidence: 99, type: 'WORD' }], cfg);
  assert.equal(r.counted, true);
  assert.equal(r.insideWordCount, 1);
  assert.equal(r.standaloneCount, 0);
  assert.equal(r.rule, 'any-position');
});

test('WORD and LINE detections are not double counted', () => {
  const text = det([
    ['E', 99, 'LINE'],
    ['E', 98, 'WORD'],
  ]);
  const result = evaluateText(text, {});
  assert.equal(result.standaloneE.count, 1, 'LINE+WORD pair must count once');
});

test('falls back to LINE detections when no WORD detections exist', () => {
  const text = det([['THE E SHOP', 95, 'LINE']]);
  const result = evaluateText(text, {});
  assert.equal(result.standaloneE.count, 1);
});

test('low confidence detections are skipped', () => {
  const cfg = parseConfig({ minOcrConfidence: 60 });
  const r = detectStandaloneE([{ text: 'E', confidence: 20, type: 'WORD' }], cfg);
  assert.equal(r.counted, false);
  assert.equal(r.skippedLowConfidence, 1);
});

test('E rule can be disabled', () => {
  const cfg = parseConfig({ countStandaloneE: 'false' });
  const r = detectStandaloneE([{ text: 'E', confidence: 99, type: 'WORD' }], cfg);
  assert.equal(r.rule, 'disabled');
  assert.equal(r.counted, false);
});

test('org text matches on token boundaries (default mode)', () => {
  const cfg = parseConfig({ allowedOrgText: 'ACME' });
  const r = detectOrgText([{ text: 'ACME', confidence: 98, type: 'WORD' }], cfg);
  assert.equal(r.found, true);
  assert.equal(r.matches[0]!.term, 'ACME');
});

test('tokens mode does NOT match a term embedded in a longer word', () => {
  const cfg = parseConfig({ allowedOrgText: 'ACME', orgTextMatchMode: 'tokens' });
  const r = detectOrgText([{ text: 'XACMEX', confidence: 98, type: 'WORD' }], cfg);
  assert.equal(r.found, false);
});

test('substring mode DOES match a term embedded in a longer word', () => {
  const cfg = parseConfig({ allowedOrgText: 'ACME', orgTextMatchMode: 'substring' });
  const r = detectOrgText([{ text: 'XACMEX', confidence: 98, type: 'WORD' }], cfg);
  assert.equal(r.found, true);
});

test('multi token term spanning separate detections is matched', () => {
  const cfg = parseConfig({ allowedOrgText: 'WIDGET INDIA' });
  const r = detectOrgText(
    [
      { text: 'WIDGET', confidence: 97, type: 'WORD' },
      { text: 'INDIA', confidence: 96, type: 'WORD' },
    ],
    cfg,
  );
  assert.equal(r.found, true);
});

test('containsSubsequence semantics', () => {
  assert.equal(containsSubsequence(['A', 'B', 'C'], ['B', 'C']), true);
  assert.equal(containsSubsequence(['A', 'B', 'C'], ['A', 'C']), false);
  assert.equal(containsSubsequence(['A'], []), false);
});

test('parseConfig coerces comma lists and booleans', () => {
  const cfg = parseConfig({ allowedOrgText: 'acme, widget-india ,,', allowEInsideWords: 'YES' });
  assert.deepEqual(cfg.allowedOrgText, ['ACME', 'WIDGET INDIA']);
  assert.equal(cfg.allowEInsideWords, true);
  assert.equal(cfg.orgTextMatchMode, 'tokens');
});

test('computeScore gives partial face credit scaled by similarity', () => {
  const s = computeScore({
    faceMatched: true,
    faceSimilarity: 96,
    threshold: 92,
    standaloneEFound: true,
    orgTextFound: false,
    weights: { face: 50, e: 25, orgText: 25 },
  });
  assert.equal(s.breakdown.face, 48);
  assert.equal(s.total, 73);
  assert.equal(s.max, 100);
});

test('computeScore caps face credit at the configured weight', () => {
  const s = computeScore({
    faceMatched: true,
    faceSimilarity: 99.9,
    threshold: 90,
    standaloneEFound: false,
    orgTextFound: true,
    weights: { face: 50, e: 25, orgText: 25 },
  });
  assert.equal(s.breakdown.face, 49.95);
  assert.equal(s.total, 74.95);
});

test('computeScore normalizes to enabled criteria (face-only reaches 100)', () => {
  const s = computeScore({
    faceMatched: true,
    faceSimilarity: 100,
    threshold: 92,
    standaloneEFound: false,
    orgTextFound: false,
    weights: { face: 50, e: 25, orgText: 25 },
    enabled: { face: true, e: false, orgText: false },
  });
  assert.equal(s.breakdown.face, 100);
  assert.equal(s.total, 100);
});

test('computeScore is zero when nothing matches', () => {
  const s = computeScore({
    faceMatched: false,
    faceSimilarity: undefined,
    threshold: 92,
    standaloneEFound: false,
    orgTextFound: false,
    weights: { face: 50, e: 25, orgText: 25 },
  });
  assert.equal(s.total, 0);
});

test('evaluateText end to end with realistic Rekognition payload', () => {
  const payload = det([
    ['E', 99.8, 'LINE'],
    ['WIDGET INDIA', 97.2, 'LINE'],
    ['E', 99.1, 'WORD'],
    ['WIDGET', 97.9, 'WORD'],
    ['INDIA', 96.4, 'WORD'],
  ]);
  const r = evaluateText(payload, { allowedOrgText: 'WIDGET INDIA', minOcrConfidence: 60 });
  assert.equal(r.standaloneE.counted, true);
  assert.equal(r.orgText.found, true);
  assert.equal(r.checks.standaloneE, true);
  assert.equal(r.checks.orgText, true);
  assert.ok(r.normalized.includes('WIDGET INDIA'));
});
