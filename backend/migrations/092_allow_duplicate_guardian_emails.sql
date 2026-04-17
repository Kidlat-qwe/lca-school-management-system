-- Allow duplicate guardian emails across students.
-- Some deployments have a UNIQUE constraint/index on guardianstbl.email
-- (or composite unique constraints including email), which blocks valid
-- parent/guardian reuse scenarios (siblings sharing one parent email).

BEGIN;

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Drop UNIQUE constraints on guardianstbl that include the email column.
  FOR rec IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'guardianstbl'
      AND tc.constraint_type = 'UNIQUE'
      AND ccu.column_name = 'email'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.guardianstbl DROP CONSTRAINT IF EXISTS %I',
      rec.constraint_name
    );
  END LOOP;

  -- Drop standalone UNIQUE indexes on guardianstbl that include email.
  FOR rec IN
    SELECT i.indexname
    FROM pg_indexes i
    JOIN pg_class c ON c.relname = i.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE i.schemaname = 'public'
      AND i.tablename = 'guardianstbl'
      AND i.indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND i.indexdef ILIKE '%(email%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', rec.indexname);
  END LOOP;
END $$;

COMMIT;
