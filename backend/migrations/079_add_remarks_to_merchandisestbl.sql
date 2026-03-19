-- Add remarks column to merchandisestbl for additional notes on merchandise items
ALTER TABLE public.merchandisestbl
  ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT NULL;

COMMENT ON COLUMN public.merchandisestbl.remarks
  IS 'Optional remarks or notes for the merchandise item';
