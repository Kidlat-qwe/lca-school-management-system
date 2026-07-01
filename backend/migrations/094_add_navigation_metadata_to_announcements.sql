BEGIN;

ALTER TABLE public.announcementstbl
ADD COLUMN IF NOT EXISTS navigation_key character varying(100),
ADD COLUMN IF NOT EXISTS navigation_query text;

COMMENT ON COLUMN public.announcementstbl.navigation_key
IS 'Optional logical destination for notification clicks (e.g. payment-logs, merchandise, daily-summary-sales, announcements).';

COMMENT ON COLUMN public.announcementstbl.navigation_query
IS 'Optional query string appended on notification click (e.g. notificationTab=return).';

COMMIT;
