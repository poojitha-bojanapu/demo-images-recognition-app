import fs from 'node:fs';
import {
  RekognitionClient,
  DetectTextCommand,
  DetectFacesCommand,
} from '@aws-sdk/client-rekognition';

// Ad-hoc inspector:  npm run detect -- <file> [text|faces]
const client = new RekognitionClient({ region: process.env.AWS_REGION || 'ap-south-1' });
const file = process.argv[2];
const cmd = process.argv[3] || 'text';

if (!file) {
  console.error('usage: npm run detect -- <image-file> [text|faces]');
  process.exit(1);
}

const bytes = fs.readFileSync(file);

if (cmd === 'faces') {
  const res = await client.send(
    new DetectFacesCommand({ Image: { Bytes: bytes } }),
  );
  console.log('faces:', (res.FaceDetails || []).length);
} else {
  const res = await client.send(new DetectTextCommand({ Image: { Bytes: bytes } }));
  for (const d of res.TextDetections || []) {
    console.log(JSON.stringify(d.DetectedText), d.Type, (d.Confidence ?? 0).toFixed(1));
  }
}
