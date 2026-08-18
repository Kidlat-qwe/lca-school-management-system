import { useState } from 'react';
import { isAnnouncementImageUrl } from './isAnnouncementImageUrl';

/**
 * Announcement attachment: image preview when the file is an image,
 * plus an open-in-new-tab link for every file type.
 * Pass localPreviewUrl (blob URL) for instant preview while uploading or when S3 is private.
 */
const AnnouncementAttachmentPreview = ({
  url,
  localPreviewUrl = '',
  className = '',
  compact = false,
}) => {
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewSrc = localPreviewUrl || url;
  const openUrl = url || localPreviewUrl;
  const showImage =
    Boolean(previewSrc) &&
    (Boolean(localPreviewUrl) || isAnnouncementImageUrl(url)) &&
    !previewFailed;

  if (!openUrl) return null;

  return (
    <div className={className}>
      {showImage && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-2 block max-w-full"
        >
          <img
            src={previewSrc}
            alt="Announcement attachment preview"
            className={`${compact ? 'max-h-28' : 'max-h-64'} w-auto max-w-full rounded-lg border border-gray-200 bg-gray-50 object-contain`}
            onError={() => setPreviewFailed(true)}
          />
        </a>
      )}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary-600 hover:underline"
        >
          Open attached file
        </a>
      ) : localPreviewUrl ? (
        <span className="text-sm text-gray-500">Image selected — uploading…</span>
      ) : null}
    </div>
  );
};

export default AnnouncementAttachmentPreview;
