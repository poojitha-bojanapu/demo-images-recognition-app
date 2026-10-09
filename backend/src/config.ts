import { env } from './env.js';
import type { OrgTextMatchMode, PublicConfig } from './types.js';

const ALLOWED_TYPES = env.ALLOWED_CONTENT_TYPES.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const allowedContentTypes = new Set(ALLOWED_TYPES);
export const allowedExtensions = ALLOWED_EXT;

export function publicConfig(): PublicConfig {
  const mode: OrgTextMatchMode = env.ORG_TEXT_MATCH_MODE === 'substring' ? 'substring' : 'tokens';
  return {
    collectionId: env.COLLECTION_ID,
    faceMatchThreshold: env.FACE_MATCH_THRESHOLD,
    allowedOrgText: env.ALLOWED_ORG_TEXT.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    orgTextMatchMode: mode,
    minOcrConfidence: env.MIN_OCR_CONFIDENCE,
    allowEInsideWords: env.ALLOW_E_INSIDE_WORDS,
    countStandaloneE: env.COUNT_STANDALONE_E,
    require: {
      face: env.REQUIRE_FACE,
      e: env.REQUIRE_E,
      orgText: env.REQUIRE_ORG_TEXT,
    },
    weights: {
      face: env.W_FACE,
      e: env.W_E,
      orgText: env.W_ORG_TEXT,
    },
    maxDimension: env.MAX_DIMENSION,
    upload: {
      minBytes: env.MIN_UPLOAD_BYTES,
      maxBytes: env.MAX_UPLOAD_BYTES,
      presignTtlSeconds: env.PRESIGN_TTL_SECONDS,
      allowedContentTypes: [...ALLOWED_TYPES],
    },
  };
}
