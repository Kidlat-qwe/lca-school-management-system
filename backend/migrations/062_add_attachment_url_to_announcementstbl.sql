-- Add optional attachment file URL to announcements (stored in S3 psms/announcement_files/)
ALTER TABLE public.announcementstbl
ADD COLUMN IF NOT EXISTS attachment_url text;

COMMENT ON COLUMN public.announcementstbl.attachment_url
IS 'Optional S3 URL for attached file (e.g. PDF, document). Stored under psms/announcement_files/ in bucket.';
