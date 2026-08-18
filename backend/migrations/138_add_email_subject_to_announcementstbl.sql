ALTER TABLE public.announcementstbl
  ADD COLUMN IF NOT EXISTS email_subject text;

COMMENT ON COLUMN public.announcementstbl.email_subject
  IS 'Optional email subject line. When empty, outbound mail uses the announcement title.';
