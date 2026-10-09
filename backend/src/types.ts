// Shared domain types for the face-e-demo backend.

export type OrgTextMatchMode = 'tokens' | 'substring';

export interface BoundingBox {
  Width: number;
  Height: number;
  Left: number;
  Top: number;
}

export interface RekognitionTextDetection {
  DetectedText?: string;
  Confidence?: number;
  Type?: string;
  Id?: number;
  ParentId?: number;
}

export interface DetectTextResult {
  TextDetections?: RekognitionTextDetection[];
}

export interface FaceMatch {
  Face: {
    FaceId: string;
    ExternalImageId?: string;
    BoundingBox?: BoundingBox;
    Confidence?: number;
  };
  Similarity: number;
}

export interface PublicConfig {
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

export interface PresignRequest {
  contentType?: string;
  sizeBytes?: number;
}

export interface PresignResponse {
  uploadId: string;
  key: string;
  url: string;
  method: 'PUT';
  expiresIn: number;
  headers: Record<string, string>;
  sizeBytes: number;
  contentType: string;
}

export interface ValidationResult {
  uploadId: string;
  objectKey: string;
  bucket: string;
  contentType: string;
  image: {
    bytes: number;
    contentType: string;
    width: number | null;
    height: number | null;
  };
  face: {
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
  };
  checks: { face: boolean; e: boolean; orgText: boolean };
  validation: { status: 'PASS' | 'FAIL' | 'ERROR'; reasons: string[] };
  score: {
    breakdown: { face: number; standaloneE: number; orgText: number };
    total: number;
    max: number;
    weights?: { face: number; e: number; orgText: number };
    active?: { face: boolean; e: boolean; orgText: boolean };
  };
  text: {
    itemCount: number;
    usableItemCount: number;
    normalized: string;
    standaloneE: unknown;
    orgText: unknown;
    detections: unknown[];
  } | null;
  processing: {
    attempt: number;
    durationMs: number;
    processedAt: string;
    workerError: string | null;
  };
}

export interface Job {
  uploadId: string;
  key: string;
  startedAt: number;
}
