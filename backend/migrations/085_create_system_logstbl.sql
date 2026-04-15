-- System-wide activity / transaction log (audit trail)
-- Run after userstbl / branchestbl exist.

CREATE TABLE IF NOT EXISTS public.system_logstbl (
    system_log_id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id INTEGER NULL REFERENCES public.userstbl (user_id) ON DELETE SET NULL,
    user_full_name VARCHAR(255) NULL,
    user_type VARCHAR(50) NULL,
    branch_id INTEGER NULL REFERENCES public.branchestbl (branch_id) ON DELETE SET NULL,
    http_method VARCHAR(12) NOT NULL,
    http_status SMALLINT NULL,
    request_path TEXT NOT NULL,
    action VARCHAR(32) NOT NULL,
    entity_type VARCHAR(96) NULL,
    summary TEXT NOT NULL,
    details JSONB NULL,
    ip_address VARCHAR(64) NULL
);

CREATE INDEX IF NOT EXISTS idx_system_logstbl_created_at ON public.system_logstbl (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logstbl_user_id ON public.system_logstbl (user_id);
CREATE INDEX IF NOT EXISTS idx_system_logstbl_entity_type ON public.system_logstbl (entity_type);
CREATE INDEX IF NOT EXISTS idx_system_logstbl_action ON public.system_logstbl (action);

COMMENT ON TABLE public.system_logstbl IS 'Append-only API activity log for authenticated mutating requests';
