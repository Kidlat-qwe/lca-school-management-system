BEGIN;

-- Add optional targeted-recipient support for in-app notifications.
ALTER TABLE public.announcementstbl
ADD COLUMN IF NOT EXISTS target_user_id integer NULL;

ALTER TABLE public.announcementstbl
DROP CONSTRAINT IF EXISTS announcementstbl_target_user_id_fkey;

ALTER TABLE public.announcementstbl
ADD CONSTRAINT announcementstbl_target_user_id_fkey
FOREIGN KEY (target_user_id)
REFERENCES public.userstbl (user_id)
ON UPDATE NO ACTION
ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_announcement_target_user_id
ON public.announcementstbl (target_user_id);

COMMENT ON COLUMN public.announcementstbl.target_user_id
IS 'Optional direct recipient user ID. If set, only this user receives the announcement in notifications.';

COMMIT;
