/**
 * Trace why Dacia's INV-564 payment enrolled phase 4 instead of phase 3.
 */
import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { getCanonicalInstallmentPhaseCounts } from '../utils/balanceInvoice.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';

const STUDENT_ID = 48;
const PROFILE_ID = 9;
const INV564 = 564;
const INV1005 = 1005;

const profileRes = await query(
  `SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
  [PROFILE_ID]
);
const profile = profileRes.rows[0];
console.log('=== Profile ===');
console.log({
  id: profile.installmentinvoiceprofiles_id,
  generated_count: profile.generated_count,
  total_phases: profile.total_phases,
  phase_start: profile.phase_start,
  downpayment_invoice_id: profile.downpayment_invoice_id,
});

const invRes = await query(
  `SELECT i.invoice_id, i.status, i.amount, i.issue_date,
          TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_ymd,
          i.remarks, i.installmentinvoiceprofiles_id
   FROM invoicestbl i
   JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
   WHERE ist.student_id = $1 AND i.installmentinvoiceprofiles_id = $2
   ORDER BY i.issue_date, i.invoice_id`,
  [STUDENT_ID, PROFILE_ID]
);
console.log('\n=== Profile invoices (chronological) ===');
for (const r of invRes.rows) console.log(r);

const payRes = await query(
  `SELECT p.payment_id, p.invoice_id, p.payable_amount, p.status, p.approval_status,
          TO_CHAR(p.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS paid_manila,
          i.issue_date
   FROM paymenttbl p
   JOIN invoicestbl i ON i.invoice_id = p.invoice_id
   WHERE p.student_id = $1 AND i.installmentinvoiceprofiles_id = $2
   ORDER BY p.created_at`,
  [STUDENT_ID, PROFILE_ID]
);
console.log('\n=== Payments (chronological) ===');
for (const r of payRes.rows) console.log(r);

const { phaseChains } = await loadInstallmentProfilePhaseChains(query, PROFILE_ID);
const chainByLocal = mapPhaseChainsToLocalSlots(phaseChains, profile);
console.log('\n=== Invoice chain → local phase mapping ===');
for (const [local, chain] of [...chainByLocal.entries()].sort((a, b) => a[0] - b[0])) {
  const rep = chain.representative;
  console.log({
    local_phase: local,
    absolute_phase: (profile.phase_start || 1) + local - 1,
    chain_root_id: chain.chain_root_id,
    invoice_id: rep?.invoice_id,
    issue_ymd: rep?.issue_date?.toString?.().slice?.(0, 10) || rep?.issue_date,
    status: rep?.status,
  });
}

// Simulate OLD enrollment sync formula at time INV-564 was paid (May 25)
// At that moment: phases 1-2 paid, phase 3 being paid; was phase 4 invoice already generated?
const invsBeforePay = invRes.rows.filter((r) => r.issue_ymd <= '2026-05-25');
const paidBefore564 = payRes.rows.filter((p) => p.paid_manila < '2026-05-25 21:31');
const paidIncluding564 = payRes.rows.filter((p) => p.paid_manila <= '2026-05-25 21:32');

console.log('\n=== At INV-564 payment time (~2026-05-25 21:31 Manila) ===');
console.log('Invoices that existed:', invsBeforePay.map((i) => i.invoice_id));
console.log('Paid before INV-564:', paidBefore564.map((p) => p.invoice_id));
console.log('Paid including INV-564:', paidIncluding564.map((p) => p.invoice_id));

const countsBefore = await query(
  `SELECT COUNT(DISTINCT CASE WHEN i.status = 'Paid' THEN COALESCE(i.invoice_chain_root_id, i.invoice_id) END) AS paid_phase_count,
          COUNT(DISTINCT COALESCE(i.invoice_chain_root_id, i.invoice_id)) AS generated_phase_count
   FROM invoicestbl i
   WHERE i.installmentinvoiceprofiles_id = $1
     AND i.invoice_id NOT IN (SELECT invoice_id FROM paymenttbl WHERE student_id = $2 AND created_at >= $3::timestamptz)
     AND COALESCE(i.invoice_chain_root_id, i.invoice_id) != $4`,
  [PROFILE_ID, STUDENT_ID, '2026-05-25 13:31:47+00', profile.downpayment_invoice_id]
);
// Simpler: use getCanonicalInstallmentPhaseCounts as of now vs simulate

const { paidPhaseCount, generatedPhaseCount } = await getCanonicalInstallmentPhaseCounts(
  { query: (...args) => query(...args) },
  PROFILE_ID,
  profile.downpayment_invoice_id
);
console.log('\n=== Current canonical counts ===', { paidPhaseCount, generatedPhaseCount });

const phaseStart = profile.phase_start != null ? parseInt(profile.phase_start, 10) : 1;
const oldFormulaAtPay = {
  paidInstallmentCount: 2, // INV-17, INV-182 paid before May 25
  storedGeneratedCount: invsBeforePay.filter((i) => i.invoice_id !== profile.downpayment_invoice_id).length,
};
oldFormulaAtPay.effectiveProgressCount = Math.max(
  oldFormulaAtPay.paidInstallmentCount + 1, // +1 for payment being recorded
  oldFormulaAtPay.storedGeneratedCount
);
oldFormulaAtPay.targetPhase_OLD = phaseStart + oldFormulaAtPay.effectiveProgressCount - 1;

console.log('\n=== OLD sync formula simulation at INV-564 pay ===');
console.log(oldFormulaAtPay);
console.log('→ Would enroll at absolute phase', oldFormulaAtPay.targetPhase_OLD, '(WRONG if 4)');

const correctLocal = [...chainByLocal.entries()].find(([, c]) => Number(c.chain_root_id) === INV564)?.[0];
console.log('\n=== CORRECT target from chain mapping ===');
console.log('INV-564 maps to local phase', correctLocal, '→ absolute phase', phaseStart + (correctLocal || 0) - 1);

// When was INV-1005 created vs INV-564 paid?
const inv1005 = invRes.rows.find((r) => r.invoice_id === INV1005);
const inv564 = invRes.rows.find((r) => r.invoice_id === INV564);
console.log('\n=== Generation timing ===');
console.log('INV-564 issued:', inv564?.issue_ymd);
console.log('INV-1005 issued:', inv1005?.issue_ymd);

const schedRes = await query(
  `SELECT installmentinvoicedtl_id, next_generation_date, next_invoice_month, frequency
   FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1 ORDER BY installmentinvoicedtl_id DESC LIMIT 3`,
  [PROFILE_ID]
);
console.log('\n=== Installment schedule rows ===');
for (const r of schedRes.rows) console.log(r);

process.exit(0);
