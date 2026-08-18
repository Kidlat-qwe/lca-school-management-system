const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;

/**
 * True when an announcement attachment URL is an image (previewable inline).
 * Ignores query/hash so S3 signed URLs still match.
 */
export function isAnnouncementImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:image/')) return true;
  const path = trimmed.split('?')[0].split('#')[0];
  return IMAGE_EXTENSION_PATTERN.test(path);
}

/** True when a selected File is an image (before upload completes). */
export function isAnnouncementImageFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('image/')) return true;
  return isAnnouncementImageUrl(file.name || '');
}
