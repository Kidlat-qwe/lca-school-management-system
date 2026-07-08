import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { loadInstallmentProfilePhaseChains } from '../lib/installmentPaymentEligibility.js';
import { mapPhaseChainsToLocalSlots } from '../utils/installmentPhaseRowMapping.js';
import { resolveProfilePhaseStart } from '../utils/phaseInstallmentUtils.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

const client = await getClient();
try {
  const profile = (
    await client.query(`SELECT * FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = 400`)
  ).rows[0];
  const { phaseChains } = await loadInstallmentProfilePhaseChains(client, 400);
  const mapped = mapPhaseChainsToLocalSlots(phaseChains, profile);
  console.log('profile', {
    generated_count: profile.generated_count,
    phase_start: profile.phase_start,
    is_active: profile.is_active,
  });
  for (const [local, chain] of [...mapped.entries()].sort((a, b) => a[0] - b[0])) {
    const rep = chain.representative;
    console.log({
      local,
      absolute: local + resolveProfilePhaseStart(profile) - 1,
      invoice_id: rep.invoice_id,
      status: rep.status,
      target: parseTargetPhase(rep.remarks),
      issue: rep.issue_date,
      due: rep.due_date,
      amount: rep.amount,
    });
  }
  const items = await client.query(
    `SELECT invoice_id, amount, penalty_amount, description FROM invoiceitemstbl WHERE invoice_id IN (1354, 1948)`
  );
  console.log('items', items.rows);
} finally {
  client.release();
}
