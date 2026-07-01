import '../config/loadEnv.js';
import { query } from '../config/database.js';
import {
  attachEnrollmentToInstallmentPhaseRows,
  annotateInstallmentPhasePlanSlots,
  isAdvancePaymentInvoice,
  loadEnrollmentStatusByAbsolutePhase,
  mapPhaseChainsToLocalSlots,
  normalizeAdjacentPhaseDisplayDates,
} from '../utils/installmentPhaseRowMapping.js';
import { computeInstallmentPhaseDisplayStatus, resolveInstallmentGraceDays } from '../utils/programPaymentStatusService.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';
import { todayManilaYmd } from '../utils/templateRenderService.js';
import pool from '../config/database.js';

const profileId = 97;
const profileRes = await query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`, [profileId]);
const profile = profileRes.rows[0];
const phaseStart = resolveProfilePhaseStart(profile);
const graceDays = await resolveInstallmentGraceDays(pool, profile.branch_id);
const todayYmd = todayManilaYmd();
const computeStatus = (invoiceStatus, dueDate) =>
  computeInstallmentPhaseDisplayStatus({ invoiceStatus, dueDateYmd: dueDate, graceDays, todayYmd });

const invoicesResult = await query(
  `SELECT i.invoice_id, i.status, i.amount, i.remarks, i.invoice_ar_number,
          TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
          TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date,
          COALESCE(i.invoice_chain_root_id, i.invoice_id) AS chain_root_id,
          COALESCE((
            SELECT SUM(COALESCE(p.payable_amount, 0) + COALESCE(p.discount_amount, 0))
            FROM paymenttbl p WHERE p.invoice_id = i.invoice_id AND p.status = 'Completed'
              AND COALESCE(p.approval_status, 'Pending') <> 'Rejected'
          ), 0)::numeric AS paid_total_for_invoice,
          (SELECT TO_CHAR(MAX(p.issue_date), 'YYYY-MM-DD') FROM paymenttbl p
           WHERE p.invoice_id = i.invoice_id AND p.status = 'Completed'
             AND COALESCE(p.approval_status, 'Pending') <> 'Rejected') AS latest_payment_date_for_invoice
   FROM invoicestbl i WHERE i.installmentinvoiceprofiles_id = $1 ORDER BY i.issue_date, i.invoice_id`,
  [profileId]
);

const chainMap = new Map();
for (const inv of invoicesResult.rows) {
  const chainRoot = Number(inv.chain_root_id);
  if (!chainMap.has(chainRoot)) {
    chainMap.set(chainRoot, { representative: inv, paid_amount: 0, latest_payment_date: null });
  }
  const chain = chainMap.get(chainRoot);
  chain.paid_amount += Number(inv.paid_total_for_invoice || 0);
  if (inv.latest_payment_date_for_invoice) chain.latest_payment_date = inv.latest_payment_date_for_invoice;
}

const phaseChains = [...chainMap.values()].filter((c) => Number(c.representative.chain_root_id) !== 278);
const targetMapped = mapPhaseChainsToLocalSlots(phaseChains, profile);

const phases = [];
for (let localPhase = 1; localPhase <= 5; localPhase += 1) {
  const chain = targetMapped.get(localPhase);
  if (!chain) {
    phases.push({ phase_number: localPhase, status: 'Not Generated', is_generated: false, paid_amount: 0, amount: Number(profile.amount) });
    continue;
  }
  const rep = chain.representative;
  const amount = rep.amount != null ? Number(rep.amount) : null;
  const paidAmount = Number(chain.paid_amount || 0);
  const expectedAmount = amount != null ? amount : Number(profile.amount);
  let displayStatus = computeStatus(rep.status, rep.due_date);
  if (Math.max(0, expectedAmount - paidAmount) <= 0.009 || (paidAmount > 0.009 && expectedAmount <= 0.009)) {
    displayStatus = 'Paid';
  }
  phases.push({
    phase_number: localPhase,
    status: displayStatus,
    is_generated: true,
    amount,
    paid_amount: paidAmount,
    payment_date: chain.latest_payment_date,
    invoice_id: rep.invoice_id,
  });
}

let normalized = annotateInstallmentPhasePlanSlots(normalizeAdjacentPhaseDisplayDates(phases, computeStatus));
const enrollmentByPhase = await loadEnrollmentStatusByAbsolutePhase(query, profile.student_id, profile.class_id);
normalized = attachEnrollmentToInstallmentPhaseRows(normalized, { phaseStart, enrollmentByAbsolutePhase: enrollmentByPhase });

for (const p of normalized) {
  console.log(
    `Local P${p.phase_number} abs P${p.absolute_phase_number}: status=${p.status} enrollment=${p.program_enrollment_status} paid=${p.paid_amount}`
  );
}
process.exit(0);
