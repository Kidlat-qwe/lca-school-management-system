-- Per-user allowlist for announcement creation (Settings → Announcements → Specific users).
-- Superadmins always may create; not stored here.

CREATE TABLE IF NOT EXISTS public.announcement_creatorstbl (
    user_id INTEGER NOT NULL PRIMARY KEY
        REFERENCES public.userstbl (user_id) ON DELETE CASCADE,
    created_by INTEGER NULL
        REFERENCES public.userstbl (user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcement_creatorstbl_created_at
    ON public.announcement_creatorstbl (created_at DESC);

COMMENT ON TABLE public.announcement_creatorstbl IS
    'Users explicitly allowed to create announcements when announcement_creator_mode = specific';
