import { formatBytes } from '../lib/compress';
import type { CompressedResult } from '../lib/compress';
import type { Phase, ProgressState } from '../lib/types';

const LABEL: Partial<Record<Phase, string>> = {
  compressing: 'Compressing image',
  uploading: 'Uploading to S3',
  processing: 'Server-side validation',
};

function Bar({ value, tone }: { value: number; tone?: string }) {
  return (
    <div className="bar">
      <div className={`bar-fill ${tone || ''}`} style={{ width: `${Math.max(3, value)}%` }} />
    </div>
  );
}

interface UploadProgressProps {
  phase: Phase;
  progress: ProgressState;
  previewUrl: string | null;
  compressed: CompressedResult | null;
  onCancel: () => void;
}

export default function UploadProgress({
  phase,
  progress,
  previewUrl,
  compressed,
  onCancel,
}: UploadProgressProps) {
  const compression = progress.compression ?? 0;
  const upload = progress.upload ?? 0;

  return (
    <div className="card">
      <h2>{LABEL[phase] || 'Working'}</h2>

      {previewUrl && <img className="preview small" src={previewUrl} alt="Uploaded preview" />}

      <div className="meter">
        <div className="meter-row">
          <span>Compression (Web Worker)</span>
          <span>{Math.round(compression)}%</span>
        </div>
        <Bar value={compression} />
        {compressed && (
          <div className="meta">
            {formatBytes(compressed.originalBytes)} → <strong>{formatBytes(compressed.bytes)}</strong>
            {compressed.hitTarget ? (
              <span className="tag good">within target</span>
            ) : (
              <span className="tag warn">outside 300 KB–1 MB target</span>
            )}
          </div>
        )}
      </div>

      <div className="meter">
        <div className="meter-row">
          <span>S3 upload</span>
          <span>{Math.round(upload)}%</span>
        </div>
        <Bar value={upload} tone="blue" />
      </div>

      <div className="meter">
        <div className="meter-row">
          <span>Rekognition validation</span>
          <span>{phase === 'processing' ? '…' : 'pending'}</span>
        </div>
        <Bar value={phase === 'processing' ? 70 : phase === 'uploading' ? 15 : 5} tone="violet" />
      </div>

      <p className="status-line">{progress.status}</p>

      <div className="row">
        <button className="ghost" onClick={onCancel}>
          Cancel & retake
        </button>
      </div>
    </div>
  );
}
