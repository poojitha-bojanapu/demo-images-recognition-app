import { createApp } from './app.js';
import { env } from './env.js';

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`face-e-demo backend listening on http://localhost:${env.PORT}`);
  console.log(`  region=${env.AWS_REGION} bucket=${env.BUCKET_NAME || '(unset)'} collection=${env.COLLECTION_ID}`);
});
