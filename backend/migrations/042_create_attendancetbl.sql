BEGIN;

-- Create attendancetbl table to track student attendance for class sessions
CREATE TABLE IF NOT EXISTS public.attendancetbl
(
    attendance_id serial NOT NULL,
    classsession_id integer NOT NULL,
    student_id integer NOT NULL,
    status character varying(50) COLLATE pg_catalog."default" DEFAULT 'Present'::character varying,
    notes text COLLATE pg_catalog."default",
    marked_by integer,
    marked_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT attendancetbl_pkey PRIMARY KEY (attendance_id),
    CONSTRAINT attendancetbl_unique_session_student UNIQUE (classsession_id, student_id)
);

COMMENT ON TABLE public.attendancetbl IS 'Tracks student attendance for individual class sessions. One record per student per session.';
COMMENT ON COLUMN public.attendancetbl.classsession_id IS 'Reference to the specific class session';
COMMENT ON COLUMN public.attendancetbl.student_id IS 'Reference to the student';
COMMENT ON COLUMN public.attendancetbl.status IS 'Attendance status: Present, Absent, Late, Excused';
COMMENT ON COLUMN public.attendancetbl.notes IS 'Optional notes about the attendance (e.g., reason for absence)';
COMMENT ON COLUMN public.attendancetbl.marked_by IS 'User ID who marked the attendance';
COMMENT ON COLUMN public.attendancetbl.marked_at IS 'Timestamp when attendance was marked';

-- Add foreign key constraints
ALTER TABLE IF EXISTS public.attendancetbl
    ADD CONSTRAINT attendancetbl_classsession_id_fkey FOREIGN KEY (classsession_id)
    REFERENCES public.classsessionstbl (classsession_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.attendancetbl
    ADD CONSTRAINT attendancetbl_student_id_fkey FOREIGN KEY (student_id)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.attendancetbl
    ADD CONSTRAINT attendancetbl_marked_by_fkey FOREIGN KEY (marked_by)
    REFERENCES public.userstbl (user_id) MATCH SIMPLE
    ON UPDATE NO ACTION
    ON DELETE SET NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_attendance_classsession_id
    ON public.attendancetbl(classsession_id);

CREATE INDEX IF NOT EXISTS idx_attendance_student_id
    ON public.attendancetbl(student_id);

CREATE INDEX IF NOT EXISTS idx_attendance_status
    ON public.attendancetbl(status);

CREATE INDEX IF NOT EXISTS idx_attendance_marked_by
    ON public.attendancetbl(marked_by);

COMMIT;

