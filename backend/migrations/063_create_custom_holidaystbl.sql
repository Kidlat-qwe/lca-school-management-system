-- Custom (non-national) holidays: school-specific or branch-specific days off.
-- National holidays remain from date-holidays (Philippines); this table is for additional holidays.
CREATE TABLE IF NOT EXISTS public.custom_holidaystbl
(
    holiday_id serial NOT NULL,
    name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    holiday_date date NOT NULL,
    branch_id integer,
    description text COLLATE pg_catalog."default",
    created_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT custom_holidaystbl_pkey PRIMARY KEY (holiday_id)
);

COMMENT ON TABLE public.custom_holidaystbl
    IS 'School/branch-specific holidays (non-national). National holidays are provided by date-holidays (PH).';

COMMENT ON COLUMN public.custom_holidaystbl.branch_id
    IS 'NULL = applies to all branches; non-NULL = branch-specific holiday.';

ALTER TABLE IF EXISTS public.custom_holidaystbl
    ADD CONSTRAINT custom_holidaystbl_branch_id_fkey FOREIGN KEY (branch_id)
    REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.custom_holidaystbl
    ADD CONSTRAINT custom_holidaystbl_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_custom_holiday_date
    ON public.custom_holidaystbl(holiday_date);

CREATE INDEX IF NOT EXISTS idx_custom_holiday_branch_id
    ON public.custom_holidaystbl(branch_id);
