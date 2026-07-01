BEGIN;

-- Create class_merge_historytbl table to track class merge operations
-- This table stores complete snapshots of original classes before merge for undo functionality
CREATE TABLE IF NOT EXISTS public.class_merge_historytbl
(
    merge_history_id serial NOT NULL,
    merged_class_id integer NOT NULL,
    merged_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    merged_by integer,
    merge_data jsonb NOT NULL,
    is_undone boolean DEFAULT false,
    undone_at timestamp without time zone,
    undone_by integer,
    CONSTRAINT class_merge_historytbl_pkey PRIMARY KEY (merge_history_id)
);

COMMENT ON TABLE public.class_merge_historytbl
    IS 'Stores complete snapshots of class merge operations for undo functionality. Contains original classes, enrollments, schedules, reservations, and teacher associations.';

COMMENT ON COLUMN public.class_merge_historytbl.merged_class_id
    IS 'The resulting merged class ID after merge operation';

COMMENT ON COLUMN public.class_merge_historytbl.merged_by
    IS 'User ID who performed the merge operation';

COMMENT ON COLUMN public.class_merge_historytbl.merge_data
    IS 'JSONB snapshot containing: original_classes, original_enrollments, original_schedules, original_reservations, original_teacher_associations';

COMMENT ON COLUMN public.class_merge_historytbl.is_undone
    IS 'Whether this merge has been undone';

COMMENT ON COLUMN public.class_merge_historytbl.undone_by
    IS 'User ID who undid the merge operation';

-- Add foreign key constraints
ALTER TABLE IF EXISTS public.class_merge_historytbl
    ADD CONSTRAINT class_merge_historytbl_merged_class_id_fkey FOREIGN KEY (merged_class_id)
    REFERENCES public.classestbl (class_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.class_merge_historytbl
    ADD CONSTRAINT class_merge_historytbl_merged_by_fkey FOREIGN KEY (merged_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.class_merge_historytbl
    ADD CONSTRAINT class_merge_historytbl_undone_by_fkey FOREIGN KEY (undone_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_merge_history_merged_class_id
    ON public.class_merge_historytbl(merged_class_id);

CREATE INDEX IF NOT EXISTS idx_merge_history_undone
    ON public.class_merge_historytbl(is_undone);

CREATE INDEX IF NOT EXISTS idx_merge_history_merged_at
    ON public.class_merge_historytbl(merged_at DESC);

COMMIT;

