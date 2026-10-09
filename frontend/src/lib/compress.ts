import imageCompression from 'browser-image-compression';

export interface CompressOptions {
  maxDimension?: number;
  targetMinBytes?: number;
  targetMaxBytes?: number;
}

export interface CompressedResult {
  blob: Blob;
  quality: number;
  originalBytes: number;
  bytes: number;
  contentType: string;
  hitTarget: boolean;
  maxDimension: number;
  minBytes: number;
  maxBytes: number;
}

export interface CompressProgress {
  stage: 'start' | 'compressing' | 'compressed';
  blob?: Blob;
  quality?: number | null;
  percent?: number;
}

export const DEFAULTS: Required<CompressOptions> = {
  maxDimension: 1600,
  targetMinBytes: 300 * 1024,
  targetMaxBytes: 1024 * 1024,
};

const QUALITY_LADDER = [0.7, 0.8, 0.88, 0.94, 1.0];

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Compress in a Web Worker until the blob fits [targetMinBytes, targetMaxBytes]
 * while never exceeding maxDimension on the longest edge.
 * Falls back to the smallest/largest achievable size if the window cannot be hit.
 */
export async function compressForUpload(
  file: Blob,
  opts: CompressOptions = {},
  onProgress?: (p: CompressProgress) => void,
): Promise<CompressedResult> {
  const maxDimension = opts.maxDimension || DEFAULTS.maxDimension;
  const minBytes = opts.targetMinBytes || DEFAULTS.targetMinBytes;
  const maxBytes = opts.targetMaxBytes || DEFAULTS.targetMaxBytes;

  const report = (stage: CompressProgress['stage'], blob: Blob, quality: number | null) => {
    if (onProgress) onProgress({ stage, blob, quality });
  };

  report('start', file, null);

  let best: Blob | null = null;
  let withinWindow: Blob | null = null;
  let usedQuality = QUALITY_LADDER[QUALITY_LADDER.length - 1];

  for (const quality of QUALITY_LADDER) {
    const out = await imageCompression(file as unknown as File, {
      maxSizeMB: Math.max(maxBytes / (1024 * 1024), 0.01),
      maxWidthOrHeight: maxDimension,
      initialQuality: quality,
      useWebWorker: true,
      alwaysKeepResolution: false,
      fileType: 'image/jpeg',
      onProgress: (p: number) => onProgress && onProgress({ stage: 'compressing', percent: p, quality }),
    });

    if (!best || Math.abs(out.size - (minBytes + maxBytes) / 2) < Math.abs(best.size - (minBytes + maxBytes) / 2)) {
      best = out;
      usedQuality = quality;
    }

    if (out.size >= minBytes && out.size <= maxBytes) {
      withinWindow = out;
      usedQuality = quality;
      report('compressed', out, quality);
      break;
    }
    report('compressed', out, quality);
  }

  const blob = withinWindow ?? best;
  if (!blob) throw new Error('compression produced no output');
  const hitTarget = Boolean(withinWindow);

  return {
    blob,
    quality: usedQuality,
    originalBytes: file.size,
    bytes: blob.size,
    contentType: blob.type || 'image/jpeg',
    hitTarget,
    maxDimension,
    minBytes,
    maxBytes,
  };
}
