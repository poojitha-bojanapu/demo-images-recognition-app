import { S3Client } from '@aws-sdk/client-s3';
import { RekognitionClient } from '@aws-sdk/client-rekognition';
import { env } from './env.js';

export const s3 = new S3Client({ region: env.AWS_REGION });
export const rekognition = new RekognitionClient({ region: env.AWS_REGION });
