import { useCallback, useEffect, useRef, useState } from 'react';
import CameraCapture from './components/CameraCapture';
import UploadProgress from './components/UploadProgress';
import ResultsPanel from './components/ResultsPanel';
import { compressForUpload, formatBytes } from './lib/compress';
import type { CompressedResult } from './lib/compress';
import {
  getConfig,
  getHealth,
  requestPresign,
  uploadWithProgress,
  pollResult,
  fetchPreviewUrl,
} from './lib/api';
import type { AppConfig, Health, Phase, ProgressState, ValidationResult } from './lib/types';

const STEPS = ['Capture', 'Compress', 'Upload', 'Validate', 'Result'];

const message = (e: unknown): string =>
  e instanceof Error ? e.message || String(e) : String(e);

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('capture');
  const [shot, setShot] = useState<Blob | null>(null);
  const [compressed, setCompressed] = useState<CompressedResult | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [progress, setProgress] = useState<ProgressState>({ compression: 0, upload: 0, status: '' });
  const cancelRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, h] = await Promise.all([getConfig(), getHealth().catch(() => null)]);
        setConfig(cfg);
        setHealth(h);
      } catch (e) {
        setLoadError(message(e) || 'Could not reach API');
      }
    })();
  }, []);

  const stepIndex =
    phase === 'capture' ? 0
    : phase === 'review' ? 0
    : phase === 'compressing' ? 1
    : phase === 'uploading' ? 2
    : phase === 'processing' ? 3
    : phase === 'result' ? 4
    : 0;

  const reset = useCallback(() => {
    cancelRef.current = true;
    setShot(null);
    setCompressed(null);
    setUploadId(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    setProgress({ compression: 0, upload: 0, status: '' });
    setPhase('capture');
  }, []);

  const retake = useCallback(() => {
    setShot(null);
    setResult(null);
    setError(null);
    setPreviewUrl(null);
    setPhase('capture');
  }, []);

  const runPipeline = useCallback(
    async (blob: Blob) => {
      cancelRef.current = false;
      setError(null);
      setResult(null);

      try {
        setPhase('compressing');
        setProgress({ compression: 0, upload: 0, status: 'Compressing in Web Worker…' });
        const comp = await compressForUpload(
          blob,
          {
            maxDimension: config?.maxDimension || 1600,
            targetMinBytes: 300 * 1024,
            targetMaxBytes: Math.min(config?.upload?.maxBytes || 1048576, 1048576),
          },
          (p) => {
            if (p.stage === 'compressing') {
              setProgress((s) => ({ ...s, compression: p.percent ?? s.compression }));
            }
          },
        );
        if (cancelRef.current) return;
        setCompressed(comp);
        setProgress((s) => ({ ...s, compression: 100, status: 'Requesting pre-signed URL…' }));

        const presign = await requestPresign({
          contentType: comp.contentType,
          sizeBytes: comp.bytes,
        });
        if (cancelRef.current) return;
        setUploadId(presign.uploadId);

        setPhase('uploading');
        setProgress((s) => ({ ...s, status: `Uploading ${formatBytes(comp.bytes)}…` }));
        await uploadWithProgress(presign.url, comp.blob, (pct) =>
          setProgress((s) => ({ ...s, upload: pct })),
        );
        if (cancelRef.current) return;

        setPreviewUrl(await fetchPreviewUrl(presign.uploadId).catch(() => null));
        setPhase('processing');
        setProgress((s) => ({ ...s, upload: 100, status: 'Waiting for server-side validation…' }));

        const res = await pollResult(presign.uploadId, {
          onUpdate: () => setProgress((s) => ({ ...s, status: 'Rekognition processing…' })),
        });
        if (cancelRef.current) return;
        setResult(res);
        setPhase('result');
      } catch (e) {
        if (cancelRef.current) return;
        setError(message(e) || String(e));
        setPhase('error');
      }
    },
    [config],
  );

  if (loadError) {
    return (
      <div className="shell">
        <div className="card error-card">
          <h2>Backend unreachable</h2>
          <p>{loadError}</p>
          <p className="hint">
            Check <code>frontend/.env</code> (VITE_API_BASE_URL) and{' '}
            <code>infrastructure/deploy.sh</code>.
          </p>
          <button onClick={() => location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="shell">
        <div className="card">Loading configuration…</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header>
        <h1>Face + E Validator</h1>
        <p className="sub">
          threshold {config.faceMatchThreshold}% · standalone E{' '}
          {config.allowEInsideWords ? 'any position' : 'only'} · org text{' '}
          {config.allowedOrgText.join(', ') || 'none'} · max {config.maxDimension}px
        </p>
        {health && (
          <p className={`badge ${health.ok ? 'ok' : 'bad'}`}>
            API {health.ok ? 'connected' : 'degraded'} · bucket {health.bucket}
          </p>
        )}
      </header>

      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < stepIndex ? 'done' : i === stepIndex ? 'active' : ''}>
            {s}
          </li>
        ))}
      </ol>

      {(phase === 'capture' || phase === 'review') && (
        <CameraCapture
          shot={shot}
          onCapture={(blob) => {
            setShot(blob);
            setPhase('review');
          }}
          onRetake={retake}
          onAccept={() => {
            if (shot) runPipeline(shot);
          }}
        />
      )}

      {(phase === 'compressing' || phase === 'uploading' || phase === 'processing') && (
        <UploadProgress
          phase={phase}
          progress={progress}
          previewUrl={previewUrl}
          compressed={compressed}
          onCancel={() => {
            cancelRef.current = true;
            reset();
          }}
        />
      )}

      {phase === 'result' && result && (
        <ResultsPanel
          result={result}
          previewUrl={previewUrl}
          uploadId={uploadId}
          onRetry={runPipeline}
          onReset={reset}
          sourceShot={shot}
        />
      )}

      {phase === 'error' && (
        <div className="card error-card">
          <h2>Something went wrong</h2>
          <p>{error}</p>
          <div className="row">
            <button onClick={retake}>Retake photo</button>
            {shot && <button className="secondary" onClick={() => runPipeline(shot)}>Retry upload</button>}
            <button className="ghost" onClick={reset}>Start over</button>
          </div>
        </div>
      )}

      <footer>
        <span>
          Images are stored in a private S3 bucket; access is via short-lived pre-signed URLs only.
        </span>
      </footer>
    </div>
  );
}
