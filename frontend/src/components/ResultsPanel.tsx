import type {
  FaceResult,
  OrgTextText,
  ResultText,
  StandaloneEText,
  ValidationResult,
} from '../lib/types';

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}%`);

interface ScoreRingProps {
  total: number;
  max: number;
}

function ScoreRing({ total, max }: ScoreRingProps) {
  const ratio = max > 0 ? total / max : 0;
  const deg = Math.round(ratio * 360);
  const tone = ratio >= 0.8 ? '#22c55e' : ratio >= 0.5 ? '#f59e0b' : '#ef4444';
  return (
    <div
      className="ring"
      style={{
        background: `conic-gradient(${tone} ${deg}deg, #1f2937 ${deg}deg)`,
      }}
    >
      <div className="ring-inner">
        <strong>{total}</strong>
        <span>/ {max}</span>
      </div>
    </div>
  );
}

interface CheckProps {
  label: string;
  ok: boolean;
  detail?: string;
}

function Check({ label, ok, detail }: CheckProps) {
  return (
    <div className={`check ${ok ? 'pass' : 'fail'}`}>
      <span className="dot" />
      <div>
        <div className="check-label">{label}</div>
        {detail && <div className="check-detail">{detail}</div>}
      </div>
      <span className="check-verdict">{ok ? 'PASS' : 'FAIL'}</span>
    </div>
  );
}

interface ResultsPanelProps {
  result: ValidationResult;
  previewUrl: string | null;
  uploadId: string | null;
  onRetry: (shot: Blob) => void;
  onReset: () => void;
  sourceShot: Blob | null;
}

export default function ResultsPanel({
  result,
  previewUrl,
  uploadId,
  onRetry,
  onReset,
  sourceShot,
}: ResultsPanelProps) {
  const face: Partial<FaceResult> = result.face || {};
  const text: Partial<ResultText> = result.text || {};
  const status = result.validation?.status || 'UNKNOWN';
  const reasons = result.validation?.reasons || [];
  const score = result.score || { breakdown: { face: 0, standaloneE: 0, orgText: 0 }, total: 0, max: 100 };
  const e: Partial<StandaloneEText> = text.standaloneE || {};
  const org: Partial<OrgTextText> = text.orgText || {};

  return (
    <div className="card">
      <div className="result-head">
        <div>
          <h2>Validation result</h2>
          <p className={`status-pill ${status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'err'}`}>
            {status}
          </p>
        </div>
        <ScoreRing total={score.total} max={score.max} />
      </div>

      {reasons.length > 0 && (
        <ul className="reasons">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      <div className="grid">
        <section className="subcard">
          <h3>Face match</h3>
          <Check
            label="Authorized member face"
            ok={result.checks?.face}
            detail={
              face.detected
                ? `${face.count} face(s) · similarity ${pct(face.similarity)} vs threshold ${pct(face.threshold)}`
                : 'No face detected'
            }
          />
          <dl>
            <dt>Matched</dt>
            <dd>{face.matched ? 'Yes' : 'No'}</dd>
            <dt>Member ID</dt>
            <dd>{face.externalImageId || '—'}</dd>
            <dt>Collection</dt>
            <dd>{face.collectionId}</dd>
          </dl>
        </section>

        <section className="subcard">
          <h3>Standalone “E”</h3>
          <Check
            label="Letter E detected"
            ok={result.checks?.e}
            detail={`rule: ${e.rule || 'n/a'} · ${e.count ?? 0} hit(s)`}
          />
          <dl>
            <dt>Standalone</dt>
            <dd>{e.standaloneCount ?? 0}</dd>
            <dt>Inside words</dt>
            <dd>{e.insideWordCount ?? 0}{e.rule === 'standalone' ? ' (not counted)' : ''}</dd>
            <dt>Evidence</dt>
            <dd className="mono">{(e.evidence || []).slice(0, 5).map((x) => x.token).join(', ') || '—'}</dd>
          </dl>
        </section>

        <section className="subcard">
          <h3>Organization text</h3>
          <Check
            label="Configured text found"
            ok={result.checks?.orgText}
            detail={org.found ? (org.matches || []).map((m) => `${m.term} (${m.confidence}%)`).join(', ') : 'no configured term matched'}
          />
          <dl>
            <dt>Mode</dt>
            <dd>{org.mode || '—'}</dd>
            <dt>Terms</dt>
            <dd>{(org.terms || []).join(', ') || '—'}</dd>
          </dl>
        </section>

        <section className="subcard">
          <h3>Image</h3>
          <dl>
            <dt>Dimensions</dt>
            <dd>{result.image?.width ?? '?'} × {result.image?.height ?? '?'} px</dd>
            <dt>Size</dt>
            <dd>{result.image?.bytes ? `${(result.image.bytes / 1024).toFixed(1)} KB` : '—'}</dd>
            <dt>Type</dt>
            <dd>{result.image?.contentType || '—'}</dd>
            <dt>Processing</dt>
            <dd>{result.processing?.durationMs ?? '—'} ms · attempt {result.processing?.attempt ?? 1}</dd>
          </dl>
        </section>
      </div>

      <section className="subcard">
        <h3>OCR detections</h3>
        <p className="mono wrap">{text.normalized || '—'}</p>
        <div className="chips">
          {(text.detections || []).slice(0, 30).map((d, i) => (
            <span
              key={`${d.text}-${i}`}
              className={`chip ${d.confidence >= 80 ? 'high' : 'low'}`}
              title={`confidence ${d.confidence}% · ${d.type}`}
            >
              {d.text} <em>{Math.round(d.confidence)}%</em>
            </span>
          ))}
          {!text.detections?.length && <span className="chip">no text detected</span>}
        </div>
        {(text.standaloneE?.skippedLowConfidence ?? 0) > 0 && (
          <p className="hint">{text.standaloneE?.skippedLowConfidence} low-confidence item(s) ignored</p>
        )}
      </section>

      <section className="subcard">
        <h3>Demo score</h3>
        <div className="score-bars">
          <div className="score-row">
            <span>Face</span>
            <div className="bar"><div className="bar-fill" style={{ width: `${(score.breakdown.face / score.max) * 100}%` }} /></div>
            <span>{score.breakdown.face}</span>
          </div>
          <div className="score-row">
            <span>Standalone E</span>
            <div className="bar"><div className="bar-fill blue" style={{ width: `${(score.breakdown.standaloneE / score.max) * 100}%` }} /></div>
            <span>{score.breakdown.standaloneE}</span>
          </div>
          <div className="score-row">
            <span>Org text</span>
            <div className="bar"><div className="bar-fill violet" style={{ width: `${(score.breakdown.orgText / score.max) * 100}%` }} /></div>
            <span>{score.breakdown.orgText}</span>
          </div>
        </div>
      </section>

      <div className="meta-row">
        <span>uploadId: <code>{uploadId}</code></span>
        <span>result key: <code>results/{uploadId}.json</code></span>
      </div>

      <div className="row">
        {sourceShot && (
          <button className="secondary" onClick={() => onRetry(sourceShot)}>
            Re-run validation
          </button>
        )}
        <button onClick={onReset}>New capture</button>
      </div>

      {previewUrl && (
        <p className="hint">
          Stored object preview uses a short-lived pre-signed GET URL (private bucket).
        </p>
      )}
    </div>
  );
}
