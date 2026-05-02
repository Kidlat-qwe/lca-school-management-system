-- Finance/superadmin "reject" for EOD and cash deposit summaries is stored as Returned (was Rejected).
-- Align existing rows so filters and badges stay consistent.

UPDATE daily_summary_salestbl
SET status = 'Returned'
WHERE status = 'Rejected';

UPDATE cash_deposit_summarytbl
SET status = 'Returned'
WHERE status = 'Rejected';
