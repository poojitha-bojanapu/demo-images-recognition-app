import type { AppConfig, Health, Presign, ValidationResult } from './types';

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  status?: number;
  data?: unknown;
  code?: string;
  lastStatus?: number;
  partial?: unknown;

  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

interface JsonResponse {
  status: number;
  data: any;
}

async function jsonOrThrow(res: Response): Promise<JsonResponse> {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok && res.status !== 202) {
    const err = new ApiError(data?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { status: res.status, data };
}

export const getConfig = async (): Promise<AppConfig> => {
  const r = await fetch(`${BASE}/config`);
  const { data } = await jsonOrThrow(r);
  return data;
};

export const getHealth = async (): Promise<Health> => {
  const r = await fetch(`${BASE}/health`);
  const { data } = await jsonOrThrow(r);
  return data;
};

export const requestPresign = async ({
  contentType,
  sizeBytes,
}: {
  contentType: string;
  sizeBytes: number;
}): Promise<Presign> => {
  const r = await fetch(`${BASE}/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType, sizeBytes }),
  });
  const { data } = await jsonOrThrow(r);
  return data;
};

export const uploadWithProgress = (
  url: string,
  blob: Blob,
  onProgress?: (pct: number) => void,
): Promise<{ status: number; etag: string | null }> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve({ status: xhr.status, etag: xhr.getResponseHeader('ETag') });
      else reject(new Error(`S3 upload failed: HTTP ${xhr.status} ${xhr.responseText || ''}`));
    };
    xhr.onerror = () => reject(new Error('S3 upload failed: network error'));
    xhr.send(blob);
  });

export const fetchResult = async (
  uploadId: string,
): Promise<{ status: number; data: ValidationResult | { uploadId: string; status: 'PROCESSING' } | null }> => {
  const r = await fetch(`${BASE}/result/${uploadId}`);
  const { status, data } = await jsonOrThrow(r);
  return { status, data };
};

export const fetchPreviewUrl = async (uploadId: string): Promise<string | null> => {
  const r = await fetch(`${BASE}/preview/${uploadId}`);
  const { data } = await jsonOrThrow(r);
  return data?.url || null;
};

export const pollResult = async (
  uploadId: string,
  {
    intervalMs = 1500,
    timeoutMs = 90000,
    onUpdate,
  }: { intervalMs?: number; timeoutMs?: number; onUpdate?: (data: unknown) => void } = {},
): Promise<ValidationResult> => {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  for (;;) {
    const { status, data } = await fetchResult(uploadId);
    lastStatus = status;
    if (onUpdate) onUpdate(data);
    if (status === 200 && data) return data as ValidationResult;
    if (Date.now() > deadline) {
      const err = new ApiError('Timed out waiting for validation result');
      err.code = 'TIMEOUT';
      err.lastStatus = lastStatus;
      err.partial = data;
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
};
