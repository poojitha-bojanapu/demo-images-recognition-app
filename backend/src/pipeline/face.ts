import {
  DetectFacesCommand,
  SearchFacesByImageCommand,
} from '@aws-sdk/client-rekognition';
import { Jimp, JimpMime } from 'jimp';

type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

import { rekognition } from '../aws.js';
import { env } from '../env.js';
import type { BoundingBox } from '../types.js';

export interface DetectedFace {
  BoundingBox?: {
    Width?: number;
    Height?: number;
    Left?: number;
    Top?: number;
  };
}

export interface FaceCheckResult {
  detected: boolean;
  count: number;
  matched: boolean;
  similarity: number | null;
  faceId: string | null;
  externalImageId: string | null;
  threshold: number;
  collectionId: string;
  error: string | null;
  searchedFaces?: number;
  matchedFaceIndex?: number;
  boundingBox?: BoundingBox;
}

interface Candidate {
  image: Buffer;
  faceIndex: number;
}

interface ScoredMatch {
  similarity: number;
  faceId: string;
  externalImageId: string | null;
  boundingBox?: BoundingBox;
  faceIndex: number;
}

async function cropFaces(buffer: Buffer, faces: DetectedFace[]): Promise<Candidate[]> {
  let image: JimpImage;
  try {
    image = await Jimp.read(buffer);
  } catch {
    return [];
  }
  const W = image.bitmap.width;
  const H = image.bitmap.height;
  const crops: Candidate[] = [];
  const pad = 0.25;
  for (let i = 0; i < faces.length; i += 1) {
    const b = faces[i]?.BoundingBox;
    if (!b || b.Width === undefined || b.Height === undefined || b.Left === undefined || b.Top === undefined) {
      continue;
    }
    const x = Math.max(0, Math.round((b.Left - b.Width * pad) * W));
    const y = Math.max(0, Math.round((b.Top - b.Height * pad) * H));
    const w = Math.min(W - x, Math.round(b.Width * (1 + 2 * pad) * W));
    const h = Math.min(H - y, Math.round(b.Height * (1 + 2 * pad) * H));
    if (w < 40 || h < 40) continue;
    try {
      const clone = image.clone().crop({ x, y, w, h });
      const out = await clone.getBuffer(JimpMime.jpeg, { quality: 90 });
      crops.push({ image: Buffer.from(out), faceIndex: i });
    } catch {
      // skip un-croppable face
    }
  }
  return crops;
}

async function searchOne(imageBytes: Buffer): Promise<ScoredMatch | null> {
  const res = await rekognition.send(
    new SearchFacesByImageCommand({
      CollectionId: env.COLLECTION_ID,
      Image: { Bytes: imageBytes },
      FaceMatchThreshold: env.FACE_MATCH_THRESHOLD,
      MaxFaces: Math.max(1, env.MAX_FACES_TO_SEARCH),
    }),
  );
  const match = (res.FaceMatches || [])[0];
  if (!match?.Face) return null;
  const bb = match.Face.BoundingBox;
  return {
    similarity: Number(match.Similarity ?? 0),
    faceId: match.Face.FaceId ?? '',
    externalImageId: match.Face.ExternalImageId ?? null,
    boundingBox:
      bb && bb.Width !== undefined && bb.Height !== undefined && bb.Left !== undefined && bb.Top !== undefined
        ? { Width: bb.Width, Height: bb.Height, Left: bb.Left, Top: bb.Top }
        : undefined,
    faceIndex: -1,
  };
}

export async function faceCheck(buffer: Buffer): Promise<FaceCheckResult> {
  const base: FaceCheckResult = {
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

  let faces: DetectedFace[];
  try {
    const res = await rekognition.send(new DetectFacesCommand({ Image: { Bytes: buffer } }));
    faces = (res.FaceDetails || []) as DetectedFace[];
  } catch (err) {
    return { ...base, error: `${(err as Error)?.name || 'DetectFacesError'}: ${(err as Error)?.message}` };
  }

  if (!faces.length) return base;

  const out: FaceCheckResult = { ...base, detected: true, count: faces.length };
  try {
    // SearchFacesByImage only compares the single largest face, so for group
    // photos we crop every detected face and search each one, keeping the best.
    // MAX_FACES_TO_SCAN caps how many faces we crop+search individually.
    const searchable = faces.slice(0, env.MAX_FACES_TO_SCAN);
    let candidates: Candidate[] = [];
    if (searchable.length > 1) candidates = await cropFaces(buffer, searchable);
    if (!candidates.length) {
      candidates = [{ image: buffer, faceIndex: searchable.length > 1 ? -1 : 0 }];
    }

    const settled = await Promise.all(
      candidates.map(async (c) => {
        try {
          return { match: await searchOne(c.image), faceIndex: c.faceIndex };
        } catch (err) {
          if ((err as Error)?.name === 'InvalidParameterException') return null;
          throw err;
        }
      }),
    );

    let best: { match: ScoredMatch; faceIndex: number } | null = null;
    for (const r of settled) {
      if (r?.match && (!best || r.match.similarity > best.match.similarity)) {
        best = { match: r.match, faceIndex: r.faceIndex };
      }
    }

    out.searchedFaces = candidates.length;
    if (best) {
      out.matched = true;
      out.similarity = Number(best.match.similarity.toFixed(2));
      out.faceId = best.match.faceId;
      out.externalImageId = best.match.externalImageId;
      out.boundingBox = best.match.boundingBox;
      out.matchedFaceIndex = best.faceIndex;
    }
  } catch (err) {
    out.error = `${(err as Error)?.name || 'SearchFacesByImageError'}: ${(err as Error)?.message}`;
    throw err;
  }
  return out;
}
