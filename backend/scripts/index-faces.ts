import fs from 'node:fs';
import { RekognitionClient, IndexFacesCommand } from '@aws-sdk/client-rekognition';

// Ad-hoc enrollment helper:  npm run index-faces -- [collection] [externalImageId]
const client = new RekognitionClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const buf = fs.readFileSync('scripts/out/face-smile.jpg');
const res = await client.send(
  new IndexFacesCommand({
    CollectionId: process.env.COLLECTION_ID || process.argv[2] || 'org-members',
    Image: { Bytes: buf },
    ExternalImageId: process.argv[3] || 'demo-member-1',
    MaxFaces: 1,
    QualityFilter: 'AUTO',
    DetectionAttributes: ['DEFAULT'],
  }),
);
console.log(JSON.stringify(res.FaceRecords || [], null, 2));
