import { getSignedUrlForFile } from '../../utils/s3Upload.js';
import { S3_BUCKET_NAME } from '../../config/s3Client.js';
import { isAnnouncementImageUrl } from './isAnnouncementImageUrl.js';

/** AWS SigV4 presigned GET max is 7 days. */
const EMAIL_IMAGE_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Extract S3 object key from a public bucket URL returned by uploadToS3.
 */
export function extractS3KeyFromPublicUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const bucketPrefix = `${S3_BUCKET_NAME}/`;
  const bucketIndex = trimmed.indexOf(bucketPrefix);
  if (bucketIndex >= 0) {
    return decodeURIComponent(trimmed.slice(bucketIndex + bucketPrefix.length).split('?')[0]);
  }
  const match = trimmed.match(/amazonaws\.com\/([^?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Resolve an HTTPS image URL for announcement emails (hosted image, not CID).
 * Prefers a 7-day signed S3 URL so private buckets still render in the inbox.
 */
export async function resolveAnnouncementImageSrcForEmail(attachmentUrl) {
  if (!isAnnouncementImageUrl(attachmentUrl)) return null;

  const key = extractS3KeyFromPublicUrl(attachmentUrl);
  if (key) {
    try {
      return await getSignedUrlForFile(key, EMAIL_IMAGE_URL_TTL_SECONDS);
    } catch (error) {
      console.error(
        '[announcementRecipientEmails] Signed image URL failed; using stored URL:',
        error?.message || error
      );
    }
  }

  return String(attachmentUrl).trim() || null;
}
