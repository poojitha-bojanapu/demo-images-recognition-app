import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { s3 } from './aws.js';
import { env } from './env.js';
import { allowedContentTypes, allowedExtensions, publicConfig } from './config.js';
import { findUploadKey, startProcessing } from './pipeline/process.js';
import type { PresignResponse } from './types.js';

export const router = Router();

const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

const isNotFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
};

router.get('/health', async (_req: Request, res: Response) => {
  let bucketOk = false;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.BUCKET_NAME }));
    bucketOk = true;
  } catch {
    bucketOk = false;
  }
  res.json({ ok: bucketOk, bucket: env.BUCKET_NAME, config: publicConfig() });
});

router.get('/config', (_req: Request, res: Response) => {
  res.json(publicConfig());
});

router.post('/presign', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { contentType?: unknown; sizeBytes?: unknown };

  const contentType = String(body.contentType || '').toLowerCase();
  if (!allowedContentTypes.has(contentType)) {
    res.status(400).json({
      error: 'unsupported content type',
      allowed: [...allowedContentTypes],
      received: contentType || null,
    });
    return;
  }

  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    res.status(400).json({ error: 'sizeBytes must be a positive number' });
    return;
  }
  if (sizeBytes < env.MIN_UPLOAD_BYTES || sizeBytes > env.MAX_UPLOAD_BYTES) {
    res.status(413).json({
      error: 'file size out of allowed range',
      minBytes: env.MIN_UPLOAD_BYTES,
      maxBytes: env.MAX_UPLOAD_BYTES,
      received: sizeBytes,
    });
    return;
  }

  const uploadId = randomUUID();
  const ext = allowedExtensions[contentType];
  const key = `${env.UPLOADS_PREFIX}${uploadId}.${ext}`;

  const put = new PutObjectCommand({
    Bucket: env.BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: sizeBytes,
    Metadata: { uploadid: uploadId, declaredbytes: String(sizeBytes) },
  });

  const url = await getSignedUrl(s3, put, { expiresIn: env.PRESIGN_TTL_SECONDS });

  const payload: PresignResponse = {
    uploadId,
    key,
    url,
    method: 'PUT',
    expiresIn: env.PRESIGN_TTL_SECONDS,
    headers: { 'Content-Type': contentType },
    sizeBytes,
    contentType,
  };
  res.json(payload);
});

router.get('/result/:uploadId', async (req: Request, res: Response) => {
  const uploadId = req.params.uploadId || '';
  if (!UPLOAD_ID_RE.test(uploadId)) {
    res.status(400).json({ error: 'invalid uploadId' });
    return;
  }

  try {
    const body = await s3.send(
      new GetObjectCommand({ Bucket: env.BUCKET_NAME, Key: `${env.RESULTS_PREFIX}${uploadId}.json` }),
    );
    const text = await body.Body!.transformToString('utf8');
    res.json(JSON.parse(text));
  } catch (err) {
    if (isNotFound(err)) {
      // Result not written yet: if the upload exists, kick off in-process
      // validation (deduped) and report PROCESSING so the client keeps polling.
      const key = await findUploadKey(uploadId).catch(() => null);
      if (key) startProcessing(uploadId, key);
      res.status(202).json({ uploadId, status: 'PROCESSING' });
      return;
    }
    throw err;
  }
});

router.get('/preview/:uploadId', async (req: Request, res: Response) => {
  const uploadId = req.params.uploadId || '';
  if (!UPLOAD_ID_RE.test(uploadId)) {
    res.status(400).json({ error: 'invalid uploadId' });
    return;
  }

  const listed = await s3.send(
    new ListObjectsV2Command({ Bucket: env.BUCKET_NAME, Prefix: `${env.UPLOADS_PREFIX}${uploadId}.` }),
  );
  const key = (listed.Contents || [])[0]?.Key;
  if (!key) {
    res.status(404).json({ error: 'image not found' });
    return;
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.BUCKET_NAME, Key: key }),
    { expiresIn: env.PREVIEW_TTL_SECONDS },
  );
  res.json({ uploadId, url, expiresIn: env.PREVIEW_TTL_SECONDS });
});
