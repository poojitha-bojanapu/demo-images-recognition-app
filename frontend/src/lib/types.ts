export type OrgTextMatchMode = 'tokens' | 'substring';

export interface AppConfig {
  collectionId: string;
  faceMatchThreshold: number;
  allowedOrgText: string[];
  orgTextMatchMode: OrgTextMatchMode;
  minOcrConfidence: number;
  allowEInsideWords: boolean;
  countStandaloneE: boolean;
  require: { face: boolean; e: boolean; orgText: boolean };
  weights: { face: number; e: number; orgText: number };
  maxDimension: number;
  upload: {
    minBytes: number;
    maxBytes: number;
    presignTtlSeconds: number;
    allowedContentTypes: string[];
  };
}

export interface Health {
  ok: boolean;
  bucket: string;
  config: AppConfig;
}

export interface Presign {
  uploadId: string;
  key: string;
  url: string;
  method: string;
  expiresIn: number;
  headers: Record<string, string>;
  sizeBytes: number;
  contentType: string;
}

export interface EEevidence {
  source: string;
  token: string;
  confidence: number;
  kind: 'standalone' | 'inside-word';
}

export interface StandaloneEText {
  rule: string;
  counted: boolean;
  count: number;
  standaloneCount: number;
  insideWordCount: number;
  evidence: EEevidence[];
  skippedLowConfidence: number;
}

export interface OrgTextText {
  mode: string;
  terms: string[];
  found: boolean;
  matches: { term: string; confidence: number }[];
}

export interface OcrDetection {
  text: string;
  normalized?: string;
  confidence: number;
  type: string;
  id?: number;
}

export interface ResultText {
  itemCount: number;
  usableItemCount: number;
  normalized: string;
  standaloneE: StandaloneEText;
  orgText: OrgTextText;
  detections: OcrDetection[];
}

export interface FaceResult {
  detected: boolean;
  count: number;
  matched: boolean;
  similarity: number | null;
  externalImageId: string | null;
  faceId: string | null;
  matchedFaceIndex: number | null;
  searchedFaces: number;
  threshold: number;
  collectionId: string;
  error: string | null;
}

export interface ScoreBreakdown {
  face: number;
  standaloneE: number;
  orgText: number;
}

export interface ValidationResult {
  uploadId: string;
  objectKey: string;
  bucket: string;
  contentType: string;
  image: { bytes: number; contentType: string; width: number | null; height: number | null };
  face: FaceResult;
  checks: { face: boolean; e: boolean; orgText: boolean };
  validation: { status: 'PASS' | 'FAIL' | 'ERROR'; reasons: string[] };
  score: { breakdown: ScoreBreakdown; total: number; max: number };
  text: ResultText | null;
  processing: { attempt: number; durationMs: number; processedAt: string; workerError: string | null };
}

export interface ProcessingStatus {
  uploadId: string;
  status: 'PROCESSING';
}

export type Phase =
  | 'capture'
  | 'review'
  | 'compressing'
  | 'uploading'
  | 'processing'
  | 'result'
  | 'error';

export interface ProgressState {
  compression: number;
  upload: number;
  status: string;
}
