-- 058_create_system_settingstbl.sql
-- Adds a general-purpose system settings table to store configurable parameters.
-- Supports per-branch overrides with global defaults.
BEGIN;

CREATE TABLE IF NOT EXISTS public.system_settingstbl
(
    setting_id serial NOT NULL,
    setting_key character varying(100) COLLATE pg_catalog."default" NOT NULL,
    setting_value text COLLATE pg_catalog."default",
    setting_type character varying(50) COLLATE pg_catalog."default" NOT NULL DEFAULT 'string'::character varying,
    category character varying(50) COLLATE pg_catalog."default",
    description text COLLATE pg_catalog."default",
    branch_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_by integer,
    CONSTRAINT system_settingstbl_pkey PRIMARY KEY (setting_id),
    CONSTRAINT system_settingstbl_unique_key_per_branch UNIQUE (setting_key, branch_id)
);

COMMENT ON TABLE public.system_settingstbl
    IS 'Stores configurable system parameters. Supports per-branch overrides and global defaults (branch_id NULL).';

COMMENT ON COLUMN public.system_settingstbl.setting_key
    IS 'Unique identifier for the setting (e.g., installment_penalty_rate).';

COMMENT ON COLUMN public.system_settingstbl.setting_value
    IS 'Value stored as text, parsed by setting_type.';

COMMENT ON COLUMN public.system_settingstbl.setting_type
    IS 'Type hint for parsing/validation (string, int, number, boolean, json).';

COMMENT ON COLUMN public.system_settingstbl.branch_id
    IS 'NULL = global default. Non-NULL = per-branch override.';

-- Ensure only one global default row per setting_key (UNIQUE with NULL branch_id would otherwise allow duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS system_settingstbl_unique_global_key
    ON public.system_settingstbl(setting_key)
    WHERE branch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_system_settings_branch_id
    ON public.system_settingstbl(branch_id);

CREATE INDEX IF NOT EXISTS idx_system_settings_category
    ON public.system_settingstbl(category);

ALTER TABLE IF EXISTS public.system_settingstbl
    ADD CONSTRAINT system_settingstbl_branch_id_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.system_settingstbl
    ADD CONSTRAINT system_settingstbl_updated_by_fkey FOREIGN KEY (updated_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- Seed global defaults (only if missing)
INSERT INTO public.system_settingstbl (setting_key, setting_value, setting_type, category, description, branch_id)
SELECT 'installment_penalty_rate', '0.10', 'number', 'billing',
       'Installment late payment penalty rate (decimal: 0.10 = 10%).', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_settingstbl WHERE setting_key = 'installment_penalty_rate' AND branch_id IS NULL
);

INSERT INTO public.system_settingstbl (setting_key, setting_value, setting_type, category, description, branch_id)
SELECT 'installment_penalty_grace_days', '0', 'int', 'billing',
       'Number of grace days after due_date before applying installment late penalty.', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_settingstbl WHERE setting_key = 'installment_penalty_grace_days' AND branch_id IS NULL
);

INSERT INTO public.system_settingstbl (setting_key, setting_value, setting_type, category, description, branch_id)
SELECT 'installment_final_dropoff_days', '30', 'int', 'billing',
       'Number of days after due_date before auto-removing student for installment delinquency.', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_settingstbl WHERE setting_key = 'installment_final_dropoff_days' AND branch_id IS NULL
);

COMMIT;

