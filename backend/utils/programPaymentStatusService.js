import { formatYmdLocal, parseYmdToLocalNoon } from './dateUtils.js';
import { getEffectiveSettings, SETTINGS_DEFINITIONS } from './settingsService.js';

export const PROGRAM_PAYMENT_STATUS = Object.freeze({
  WAIT_FOR_PAYMENT: 'wait_for_payment',
  PAID: 'paid',
  UNDER_GRACE_PERIOD: 'under_grace_period',
  DUE_DATE: 'due_date',
});

const parseClassIdFromRemarks = (remarks) => {
  const match = String(remarks || '').match(/CLASS_ID:(\d+)/);
  return match ? Number(match[1]) : null;
};

const addDaysYmd = (ymd, days) => {
  if (!ymd) return null;
  const base = parseYmdToLocalNoon(ymd);
  if (!base) return null;
  base.setDate(base.getDate() + (Number(days) || 0));
  return formatYmdLocal(base);
};

const getGraceDays = async (client, branchId) => {
  try {
    const settings = await getEffectiveSettings(
      client,
      ['installment_penalty_grace_days'],
      branchId == null ? null : Number(branchId)
    );
    const graceDays = Number(settings.installment_penalty_grace_days?.value);
    return Number.isFinite(graceDays)
      ? Math.max(0, Math.floor(graceDays))
      : SETTINGS_DEFINITIONS.installment_penalty_grace_days.defaultValue;
  } catch {
    return SETTINGS_DEFINITIONS.installment_penalty_grace_days.defaultValue;
  }
};

const getInvoiceStudents = async (client, invoiceId) => {
  const result = await client.query(
    `SELECT student_id
     FROM invoicestudentstbl
     WHERE invoice_id = $1
       AND student_id IS NOT NULL`,
    [invoiceId]
  );
  return result.rows.map((row) => Number(row.student_id)).filter((id) => Number.isFinite(id));
};

const getReservationClassId = async (client, invoiceId, chainRootId) => {
  const result = await client.query(
    `SELECT class_id
     FROM reservedstudentstbl
     WHERE invoice_id = $1 OR invoice_id = $2
     ORDER BY reserved_id DESC
     LIMIT 1`,
    [invoiceId, chainRootId || invoiceId]
  );
  const classId = result.rows[0]?.class_id;
  return classId != null ? Number(classId) : null;
};

const resolveInvoiceClassId = async (client, invoice) => {
  if (invoice.installment_class_id != null) return Number(invoice.installment_class_id);

  const remarksClassId = parseClassIdFromRemarks(invoice.remarks);
  if (remarksClassId) return remarksClassId;

  // Balance/re-billed invoices may not carry CLASS_ID in their own remarks.
  const parentId = invoice.invoice_chain_root_id || invoice.parent_invoice_id;
  if (parentId) {
    const parentResult = await client.query(
      `SELECT remarks
       FROM invoicestbl
       WHERE invoice_id = $1`,
      [parentId]
    );
    const parentClassId = parseClassIdFromRemarks(parentResult.rows[0]?.remarks);
    if (parentClassId) return parentClassId;
  }

  return getReservationClassId(client, invoice.invoice_id, invoice.invoice_chain_root_id);
};

const getPaidAt = async (client, invoiceId) => {
  const result = await client.query(
    `SELECT TO_CHAR(MAX(issue_date), 'YYYY-MM-DD') AS paid_at
     FROM paymenttbl
     WHERE invoice_id = $1
       AND status = 'Completed'
       AND COALESCE(approval_status, 'Pending') <> 'Rejected'`,
    [invoiceId]
  );
  return result.rows[0]?.paid_at || null;
};

const computeStatus = ({ invoiceStatus, dueDateYmd, graceUntilYmd, todayYmd }) => {
  const normalizedStatus = String(invoiceStatus || '').trim().toLowerCase();
  if (normalizedStatus === 'paid') return PROGRAM_PAYMENT_STATUS.PAID;

  if (!dueDateYmd || todayYmd <= dueDateYmd) {
    return PROGRAM_PAYMENT_STATUS.WAIT_FOR_PAYMENT;
  }

  if (graceUntilYmd && todayYmd <= graceUntilYmd) {
    return PROGRAM_PAYMENT_STATUS.UNDER_GRACE_PERIOD;
  }

  return PROGRAM_PAYMENT_STATUS.DUE_DATE;
};

export const syncProgramPaymentStatusForInvoice = async (client, invoiceId) => {
  if (!invoiceId) return { synced: 0, skipped: true };

  const invoiceResult = await client.query(
    `SELECT
       i.invoice_id,
       i.branch_id,
       i.status,
       i.remarks,
       i.installmentinvoiceprofiles_id,
       i.invoice_chain_root_id,
       i.parent_invoice_id,
       TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date,
       ip.class_id AS installment_class_id
     FROM invoicestbl i
     LEFT JOIN installmentinvoiceprofilestbl ip
       ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     WHERE i.invoice_id = $1`,
    [invoiceId]
  );

  if (invoiceResult.rows.length === 0) return { synced: 0, skipped: true };
  const invoice = invoiceResult.rows[0];
  const normalizedStatus = String(invoice.status || '').trim().toLowerCase();

  if (normalizedStatus === 'cancelled' || normalizedStatus === 'canceled') {
    await client.query('DELETE FROM program_payment_statustbl WHERE invoice_id = $1', [invoiceId]);
    return { synced: 0, deleted: true };
  }

  const studentIds = await getInvoiceStudents(client, invoiceId);
  if (studentIds.length === 0) return { synced: 0, skipped: true };

  const branchId = invoice.branch_id != null ? Number(invoice.branch_id) : null;
  const graceDays = await getGraceDays(client, branchId);
  const dueDateYmd = invoice.due_date || null;
  const graceUntilYmd = dueDateYmd ? addDaysYmd(dueDateYmd, graceDays) : null;
  const todayYmd = formatYmdLocal(new Date());
  const paidAt = normalizedStatus === 'paid' ? await getPaidAt(client, invoiceId) : null;
  const classId = await resolveInvoiceClassId(client, invoice);
  const status = computeStatus({
    invoiceStatus: invoice.status,
    dueDateYmd,
    graceUntilYmd,
    todayYmd,
  });

  let synced = 0;
  for (const studentId of studentIds) {
    await client.query(
      `INSERT INTO program_payment_statustbl (
         student_id,
         class_id,
         invoice_id,
         branch_id,
         installmentinvoiceprofiles_id,
         status,
         invoice_status_snapshot,
         invoice_due_date,
         grace_until,
         paid_at,
         computed_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10::date, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (invoice_id, student_id)
       DO UPDATE SET
         class_id = EXCLUDED.class_id,
         branch_id = EXCLUDED.branch_id,
         installmentinvoiceprofiles_id = EXCLUDED.installmentinvoiceprofiles_id,
         status = EXCLUDED.status,
         invoice_status_snapshot = EXCLUDED.invoice_status_snapshot,
         invoice_due_date = EXCLUDED.invoice_due_date,
         grace_until = EXCLUDED.grace_until,
         paid_at = EXCLUDED.paid_at,
         computed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [
        studentId,
        classId || null,
        Number(invoiceId),
        branchId,
        invoice.installmentinvoiceprofiles_id || null,
        status,
        invoice.status || null,
        dueDateYmd,
        graceUntilYmd,
        paidAt,
      ]
    );
    synced += 1;
  }

  return { synced, status };
};

/**
 * Upsert program_payment_statustbl for all invoices that have at least one
 * row in invoicestudentstbl (skipped invoices return synced: 0 from the helper).
 *
 * @param {object} client - pg PoolClient
 * @param {{ branchId?: number|null }} [options] - If branchId is set, only that branch's invoices.
 */
export const syncAllProgramPaymentStatuses = async (client, options = {}) => {
  const { branchId } = options;
  const params = [];
  let sql = `
    SELECT invoice_id
    FROM invoicestbl
    WHERE status IS DISTINCT FROM 'Cancelled'`;
  if (branchId != null && Number.isFinite(Number(branchId))) {
    sql += ` AND branch_id = $1`;
    params.push(Number(branchId));
  }
  sql += ` ORDER BY invoice_id`;

  const result = await client.query(sql, params);

  let synced = 0;
  for (const row of result.rows) {
    const summary = await syncProgramPaymentStatusForInvoice(client, row.invoice_id);
    synced += summary.synced || 0;
  }
  return { invoices: result.rows.length, synced, branchId: branchId ?? null };
};
