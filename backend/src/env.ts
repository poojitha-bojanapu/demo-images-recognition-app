import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Environment loading.
//
// Single source of truth stays infrastructure/config.env (validation rules).
// infrastructure/outputs.env carries the resolved AWS resource names created by
// deploy.sh. Real process.env values win over both files, and an optional
// backend/.env is layered on top for local overrides.
// ---------------------------------------------------------------------------

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'infrastructure', 'config.env'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).split('#')[0]!.trim();
    if (key) out[key] = value;
  }
  return out;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

const fileEnv: Record<string, string> = {
  ...parseEnvFile(path.join(repoRoot, 'infrastructure', 'config.env')),
  ...parseEnvFile(path.join(repoRoot, 'infrastructure', 'outputs.env')),
  ...parseEnvFile(path.join(repoRoot, 'backend', '.env')),
};

const raw: Record<string, string | undefined> = { ...fileEnv, ...process.env };

const str = (v: string | undefined, d: string): string => (v === undefined || v === '' ? d : v);
const bool = (v: string | undefined, d: boolean): boolean => {
  if (v === undefined || v === null || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
};
const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const env = {
  AWS_REGION: str(raw.AWS_REGION, 'ap-south-1'),
  BUCKET_NAME: str(raw.BUCKET_NAME, ''),
  UPLOADS_PREFIX: str(raw.UPLOADS_PREFIX, 'uploads/'),
  RESULTS_PREFIX: str(raw.RESULTS_PREFIX, 'results/'),

  COLLECTION_ID: str(raw.COLLECTION_ID, 'org-members'),
  FACE_MATCH_THRESHOLD: num(raw.FACE_MATCH_THRESHOLD, 92),
  MAX_FACES_TO_SEARCH: num(raw.MAX_FACES_TO_SEARCH, 1),
  MAX_FACES_TO_SCAN: Math.min(20, Math.max(1, num(raw.MAX_FACES_TO_SCAN, 10))),

  ALLOWED_ORG_TEXT: str(raw.ALLOWED_ORG_TEXT, ''),
  ORG_TEXT_MATCH_MODE: str(raw.ORG_TEXT_MATCH_MODE, 'tokens'),
  MIN_OCR_CONFIDENCE: num(raw.MIN_OCR_CONFIDENCE, 60),
  ALLOW_E_INSIDE_WORDS: bool(raw.ALLOW_E_INSIDE_WORDS, false),
  COUNT_STANDALONE_E: bool(raw.COUNT_STANDALONE_E, true),

  REQUIRE_FACE: bool(raw.REQUIRE_FACE, true),
  REQUIRE_E: bool(raw.REQUIRE_E, true),
  REQUIRE_ORG_TEXT: bool(raw.REQUIRE_ORG_TEXT, false),

  W_FACE: num(raw.W_FACE, 50),
  W_E: num(raw.W_E, 25),
  W_ORG_TEXT: num(raw.W_ORG_TEXT, 25),

  MAX_DIMENSION: num(raw.MAX_DIMENSION, 1600),
  MIN_UPLOAD_BYTES: num(raw.MIN_UPLOAD_BYTES, 40000),
  MAX_UPLOAD_BYTES: num(raw.MAX_UPLOAD_BYTES, 1048576),
  PRESIGN_TTL_SECONDS: num(raw.PRESIGN_TTL_SECONDS, 720),
  PREVIEW_TTL_SECONDS: num(raw.PREVIEW_TTL_SECONDS, 300),
  ALLOWED_CONTENT_TYPES: str(raw.ALLOWED_CONTENT_TYPES, 'image/jpeg,image/png,image/webp'),

  // in-process retry budget (formerly SQS maxReceiveCount before the DLQ)
  SQS_MAX_RECEIVE_COUNT: num(raw.SQS_MAX_RECEIVE_COUNT, 3),

  // Express server
  PORT: num(raw.PORT, 8787),
  ALLOWED_ORIGINS: str(raw.ALLOWED_ORIGINS, '*'),
  LOG_LEVEL: str(raw.LOG_LEVEL, 'info'),
};

export const repoRootPath = repoRoot;
