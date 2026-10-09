import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import { s3 } from '../aws.js';
import { env } from '../env.js';
import { imageSize } from '../shared/image-size.js';
import { faceCheck } from './face.js';
import { evaluate, textCheck } from './text.js';
import type { FaceCheckResult } from './face.js';
import type { DetectTextResult } from '../types.js';

// ---------------------------------------------------------------------------
// In-process async pipeline.
//
// Previously the browser uploaded to S3, an S3 event dropped a message on SQS,
// and a Lambda worker wrote the result JSON. We keep the exact same validation
// logic but run it in-process: the first /result poll for a finished upload
// kicks off processing (idempotent, deduped) and later polls return the result.
// ---------------------------------------------------------------------------

const RETRYABLE = new Set([
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
  'ProvisionedThroughputExceededException',
  'ServiceUnavailable',
  'ServiceUnavailableException',
  'InternalError',
  'InternalFailure',
  'RequestTimeout',
  'TimeoutError',
  'NetworkingError',
  'SlowDown',
  'RequestTimeoutException',
]);

export function isRetryable(err: unknown): boolean {
  const e = err as { name?: string; retryable?: boolean };
  return (e?.name ? RETRYABLE.has(e.name) : false) || e?.retryable === true;
}

function uploadIdFromKey(key: string): string {
  const file = key.split('/').pop() || '';
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

async function readBody(res: { Body?: { transformToByteArray(): Promise<Uint8Array> } }): Promise<Buffer> {
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export interface UploadOutcome {
  uploadId: string;
  status?: string;
  skipped?: string;
}

export async function processUpload({
  bucket,
  key,
  attempt,
}: {
  bucket: string;
  key: string;
  attempt: number;
}): Promise<UploadOutcome> {
  const uploadId = uploadIdFromKey(key);
  const resultKey = `${env.RESULTS_PREFIX}${uploadId}.json`;
  const startedAt = Date.now();

  const existing = await s3
    .send(new HeadObjectCommand({ Bucket: bucket, Key: resultKey }))
    .then(() => true)
    .catch(() => false);
  if (existing) {
    return { uploadId, skipped: 'already processed' };
  }

  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buffer = await readBody(obj);
  const bytes = buffer.length;
  const contentType = obj.ContentType || 'application/octet-stream';
  const dims = imageSize(buffer);

  const sizeOk = bytes >= env.MIN_UPLOAD_BYTES && bytes <= env.MAX_UPLOAD_BYTES;
  const typeOk = /^image\/(jpeg|png|webp)$/.test(contentType);

  let face: FaceCheckResult = {
    detected: false,
    count: 0,
    matched: false,
    similarity: null,
    faceId: null,
    externalImageId: null,
    threshold: env.FACE_MATCH_THRESHOLD,
    collectionId: env.COLLECTION_ID,
    error: null,
  };
  let textResult: DetectTextResult = { TextDetections: [] };
  let evaluation: ReturnType<typeof evaluate> | null = null;
  let failure: string | null = null;

  if (!typeOk) failure = `unsupported content type: ${contentType}`;
  else if (!sizeOk) failure = `file size ${bytes} outside ${env.MIN_UPLOAD_BYTES}-${env.MAX_UPLOAD_BYTES} bytes`;
  else if (!dims) failure = 'could not decode image dimensions (unsupported or corrupt image)';

  if (!failure) {
    const [f, t] = await Promise.all([faceCheck(buffer), textCheck(buffer)]);
    if (f.error && !f.detected && f.error.includes('DetectFaces')) failure = `face detection failed: ${f.error}`;
    face = f;
    textResult = { TextDetections: t.items };
    if (t.error) failure = failure || `text detection failed: ${t.error}`;
    if (!failure) evaluation = evaluate({ face, textResult, dims, bytes });
  }

  const result = {
    uploadId,
    objectKey: key,
    bucket,
    contentType,
    image: { bytes, contentType, width: dims?.width ?? null, height: dims?.height ?? null },
    face: {
      detected: face.detected,
      count: face.count,
      matched: face.matched,
      similarity: face.similarity,
      externalImageId: face.externalImageId,
      faceId: face.faceId,
      matchedFaceIndex: face.matchedFaceIndex ?? null,
      searchedFaces: face.searchedFaces ?? 0,
      threshold: env.FACE_MATCH_THRESHOLD,
      collectionId: env.COLLECTION_ID,
      error: face.error ?? null,
    },
    checks: evaluation?.checks ?? { face: false, e: false, orgText: false },
    validation: evaluation
      ? { status: evaluation.status, reasons: evaluation.reasons }
      : { status: 'ERROR' as const, reasons: [failure] },
    score: evaluation?.score ?? { breakdown: { face: 0, standaloneE: 0, orgText: 0 }, total: 0, max: 100 },
    text: evaluation?.text
      ? {
          itemCount: evaluation.text.itemCount,
          usableItemCount: evaluation.text.usableItemCount,
          normalized: evaluation.text.normalized,
          standaloneE: evaluation.text.standaloneE,
          orgText: evaluation.text.orgText,
          detections: evaluation.text.items,
        }
      : null,
    processing: {
      attempt,
      durationMs: Date.now() - startedAt,
      processedAt: new Date().toISOString(),
      workerError: failure,
    },
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: resultKey,
      Body: JSON.stringify(result, null, 2),
      ContentType: 'application/json',
    }),
  );

  return { uploadId, status: result.validation.status };
}

async function processWithRetry(bucket: string, key: string): Promise<void> {
  const maxAttempts = Math.max(1, Number(env.SQS_MAX_RECEIVE_COUNT || 3));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await processUpload({ bucket, key, attempt });
      return;
    } catch (err) {
      const retryable = isRetryable(err);
      console.error(
        'worker_error',
        JSON.stringify({
          key,
          attempt,
          name: (err as Error)?.name,
          retryable,
          canRetry: retryable && attempt < maxAttempts,
          message: (err as Error)?.message,
        }),
      );
      if (!retryable || attempt >= maxAttempts) return;
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
}

const inFlight = new Map<string, Promise<void>>();

export async function findUploadKey(uploadId: string): Promise<string | null> {
  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: env.BUCKET_NAME, Prefix: `${env.UPLOADS_PREFIX}${uploadId}.` }),
  );
  return (listed.Contents || [])[0]?.Key ?? null;
}

export function startProcessing(uploadId: string, key: string): void {
  if (inFlight.has(uploadId)) return;
  const job = processWithRetry(env.BUCKET_NAME, key).finally(() => inFlight.delete(uploadId));
  inFlight.set(uploadId, job);
}
