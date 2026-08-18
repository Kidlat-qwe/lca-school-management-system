# Announcement attachment preview

Shared UI for announcement file attachments on View Details and create/edit forms.

## Behavior

- Image URLs (`jpg`, `jpeg`, `png`, `gif`, `webp`, `bmp`, `svg`, including S3 query strings) show an inline preview.
- Pass `localPreviewUrl` (blob URL from `URL.createObjectURL`) for instant preview while uploading.
- Non-image files (PDF, Word, TXT, CSV) show only **Open attached file**.
- If the image fails to load, the preview hides and the open link remains.

## Usage

- `compact`: smaller preview for create/edit forms.

```jsx
import AnnouncementAttachmentPreview, { isAnnouncementImageFile } from '../components/announcementAttachment';

<AnnouncementAttachmentPreview url={viewingAnnouncement.attachment_url} />
<AnnouncementAttachmentPreview
  url={formData.attachment_url}
  localPreviewUrl={attachmentLocalPreviewUrl}
  compact
/>
```
