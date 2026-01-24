-- Add image_url to merchandisestbl to store merchandise images from Supabase
-- This allows each merchandise item to have an associated image

ALTER TABLE merchandisestbl 
ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);

-- Add index for better query performance (optional, but helpful for filtering)
CREATE INDEX IF NOT EXISTS idx_merchandise_image_url 
ON merchandisestbl(image_url) 
WHERE image_url IS NOT NULL;

COMMENT ON COLUMN merchandisestbl.image_url 
IS 'URL to merchandise image stored in Supabase storage. Used for displaying merchandise in card-based UI.';

