const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;

/**
 * True when an announcement attachment URL is an image (inline preview / email embed).
 */
export function isAnnouncementImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:image/')) return true;
  const path = trimmed.split('?')[0].split('#')[0];
  return IMAGE_EXTENSION_PATTERN.test(path);
}
