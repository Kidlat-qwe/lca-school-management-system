-- Add level_tag to acknowledgement_receiptstbl (e.g. Pre-Kindergarten, Grade 1)
ALTER TABLE public.acknowledgement_receiptstbl
  ADD COLUMN IF NOT EXISTS level_tag VARCHAR(100);

COMMENT ON COLUMN public.acknowledgement_receiptstbl.level_tag
  IS 'Level/program tag for the prospect (e.g. from package or manual).';
