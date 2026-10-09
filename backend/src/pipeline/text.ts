import { DetectTextCommand } from '@aws-sdk/client-rekognition';

import { rekognition } from '../aws.js';
import { env } from '../env.js';
import { computeScore, evaluateText } from '../shared/text-rules.js';
import type { EvaluatedText } from '../shared/text-rules.js';
import type { ImageDimensions } from '../shared/image-size.js';
import type { FaceCheckResult } from './face.js';
import type { DetectTextResult, RekognitionTextDetection } from '../types.js';

export interface TextCheckResult {
  items: RekognitionTextDetection[];
  error: string | null;
}

export async function textCheck(buffer: Buffer): Promise<TextCheckResult> {
  try {
    const res = await rekognition.send(new DetectTextCommand({ Image: { Bytes: buffer } }));
    return { items: res.TextDetections || [], error: null };
  } catch (err) {
    return {
      items: [],
      error: `${(err as Error)?.name || 'DetectTextError'}: ${(err as Error)?.message}`,
    };
  }
}

export interface Evaluation {
  checks: { face: boolean; e: boolean; orgText: boolean };
  reasons: string[];
  status: 'PASS' | 'FAIL';
  score: ReturnType<typeof computeScore>;
  text: EvaluatedText;
  withinLimits: boolean;
}

export function evaluate({
  face,
  textResult,
  dims,
  bytes,
}: {
  face: FaceCheckResult;
  textResult: DetectTextResult;
  dims: ImageDimensions | null;
  bytes: number;
}): Evaluation {
  const text = evaluateText(textResult, {
    allowedOrgText: env.ALLOWED_ORG_TEXT,
    orgTextMatchMode: env.ORG_TEXT_MATCH_MODE,
    minOcrConfidence: env.MIN_OCR_CONFIDENCE,
    allowEInsideWords: env.ALLOW_E_INSIDE_WORDS,
    countStandaloneE: env.COUNT_STANDALONE_E,
  });

  const checks = {
    face: env.REQUIRE_FACE ? Boolean(face.matched) : true,
    e: env.REQUIRE_E ? text.checks.standaloneE : true,
    orgText: env.REQUIRE_ORG_TEXT ? text.checks.orgText : true,
  };

  const reasons: string[] = [];
  if (env.REQUIRE_FACE && !face.matched) {
    reasons.push(face.detected ? 'no authorized member face matched' : 'no face detected');
  }
  if (env.REQUIRE_E && !text.checks.standaloneE) {
    reasons.push(
      env.ALLOW_E_INSIDE_WORDS
        ? 'letter E not found'
        : 'standalone letter E not found (E inside unrelated words is not counted)',
    );
  }
  if (env.REQUIRE_ORG_TEXT && !text.checks.orgText) {
    reasons.push('configured organization text not found');
  }
  if (dims && dims.width > env.MAX_DIMENSION) reasons.push(`width ${dims.width} exceeds ${env.MAX_DIMENSION}px`);
  if (dims && dims.height > env.MAX_DIMENSION) reasons.push(`height ${dims.height} exceeds ${env.MAX_DIMENSION}px`);
  if (bytes < env.MIN_UPLOAD_BYTES) reasons.push(`file too small (${bytes} < ${env.MIN_UPLOAD_BYTES} bytes)`);
  if (bytes > env.MAX_UPLOAD_BYTES) reasons.push(`file too large (${bytes} > ${env.MAX_UPLOAD_BYTES} bytes)`);

  const withinLimits =
    (!dims || (dims.width <= env.MAX_DIMENSION && dims.height <= env.MAX_DIMENSION)) &&
    bytes >= env.MIN_UPLOAD_BYTES &&
    bytes <= env.MAX_UPLOAD_BYTES;

  const score = computeScore({
    faceMatched: face.matched,
    faceSimilarity: face.similarity,
    threshold: env.FACE_MATCH_THRESHOLD,
    standaloneEFound: text.checks.standaloneE,
    orgTextFound: text.checks.orgText,
    weights: { face: env.W_FACE, e: env.W_E, orgText: env.W_ORG_TEXT },
    enabled: {
      face: env.REQUIRE_FACE,
      e: env.REQUIRE_E,
      orgText: env.REQUIRE_ORG_TEXT,
    },
  });

  const passed = Object.values(checks).every(Boolean) && withinLimits;

  return {
    checks,
    reasons,
    status: passed ? 'PASS' : 'FAIL',
    score,
    text,
    withinLimits,
  };
}
