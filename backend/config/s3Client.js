import { S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

// AWS S3 Configuration
const s3Config = {
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
};

// Optional: Use custom endpoint (for S3-compatible services)
if (process.env.AWS_S3_ENDPOINT) {
  s3Config.endpoint = process.env.AWS_S3_ENDPOINT;
}

// Create S3 client
export const s3Client = new S3Client(s3Config);

// S3 bucket name
export const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'psms';

// Log S3 configuration (without sensitive data)
console.log('📦 S3 Configuration:', {
  region: s3Config.region,
  bucket: S3_BUCKET_NAME,
  endpoint: process.env.AWS_S3_ENDPOINT || 'default',
});

export default s3Client;

