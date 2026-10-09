import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Webcam from 'react-webcam';

type FacingMode = 'user' | 'environment';

interface CameraCaptureProps {
  shot: Blob | null;
  onCapture: (blob: Blob) => void;
  onRetake: () => void;
  onAccept: () => void;
}

export default function CameraCapture({ shot, onCapture, onRetake, onAccept }: CameraCaptureProps) {
  const webcamRef = useRef<Webcam>(null);
  const [facing, setFacing] = useState<FacingMode>('environment');
  const [camError, setCamError] = useState<string | null>(null);
  const [camKey, setCamKey] = useState(0);
  const [ready, setReady] = useState(false);

  // Use `ideal` (not exact) so phones that do not support 1280x720 / a given
  // facing mode still start a stream instead of throwing OverconstrainedError.
  const videoConstraints = useMemo(
    () => ({
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    }),
    [facing],
  );

  const capture = useCallback(() => {
    const w = webcamRef.current;
    if (!w) return;
    const video = w.video;
    const vw = video?.videoWidth || 1280;
    const vh = video?.videoHeight || 720;
    const dataUrl = w.getScreenshot({ width: vw, height: vh });
    if (!dataUrl) {
      setCamError('Could not read a frame from the camera.');
      return;
    }
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((blob) => onCapture(new Blob([blob], { type: 'image/jpeg' })))
      .catch(() => setCamError('Failed to capture frame.'));
  }, [onCapture]);

  // Remount the <Webcam> (new key) so mobile browsers fully release and
  // re-acquire the camera track when switching front/back.
  const switchCamera = useCallback(() => {
    setReady(false);
    setCamError(null);
    setFacing((f) => (f === 'user' ? 'environment' : 'user'));
    setCamKey((k) => k + 1);
  }, []);

  const retry = useCallback(() => {
    setReady(false);
    setCamError(null);
    setCamKey((k) => k + 1);
  }, []);

  const handleError = useCallback(
    (err: unknown) => {
      setReady(false);
      const name = (err as { name?: string } | null)?.name || '';
      // Some devices expose only one camera; fall back automatically instead of
      // leaving a dead black preview.
      if (facing === 'environment' && !/NotAllowedError|Permission/i.test(name)) {
        setFacing('user');
        setCamKey((k) => k + 1);
        setCamError('Back camera unavailable — switched to the front camera. Retry if needed.');
      } else if (/NotAllowedError|Permission/i.test(name)) {
        setCamError('Camera permission denied. Allow access in your browser settings, or upload a file.');
      } else {
        setCamError('Camera unavailable. Tap “Retry camera”, or upload a file.');
      }
    },
    [facing],
  );

  const previewUrl = useMemo(() => (shot ? URL.createObjectURL(shot) : null), [shot]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  if (shot) {
    return (
      <div className="card">
        <h2>Review</h2>
        <img className="preview" src={previewUrl ?? undefined} alt="Captured preview" />
        <div className="row">
          <button className="secondary" onClick={onRetake}>
            Retake
          </button>
          <button onClick={onAccept}>Use photo</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Capture</h2>
      {camError && <p className="error-text">{camError}</p>}
      <div className="cam-wrap">
        <Webcam
          key={`${facing}-${camKey}`}
          ref={webcamRef}
          audio={false}
          screenshotFormat="image/jpeg"
          screenshotQuality={0.95}
          videoConstraints={videoConstraints}
          mirrored={facing === 'user'}
          onUserMedia={() => {
            setReady(true);
            setCamError(null);
          }}
          onUserMediaError={handleError}
        />
      </div>
      <div className="row">
        <button onClick={capture} disabled={!!camError && !ready}>
          Capture photo
        </button>
        <button className="ghost" onClick={switchCamera}>
          {facing === 'environment' ? 'Use front camera' : 'Use back camera'}
        </button>
        {camError && (
          <button className="secondary" onClick={retry}>
            Retry camera
          </button>
        )}
        <label className="file-label">
          Upload file
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onCapture(f);
            }}
          />
        </label>
      </div>
    </div>
  );
}
