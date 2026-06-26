/**
 * Pilot repair — Aadam June Cawili installment generation queue (June 25, 2026 miss).
 *
 * Fixes installmentinvoicestbl queue dates for profile #142 only, then optionally
 * generates the missed phase invoice (issue June 25, due July 5).
 *
 * Run:
 *   node backend/scripts/repairAadamCawiliInstallmentGenerationQueue.js
 *   node backend/scripts/repairAadamCawiliInstallmentGenerationQueue.js --apply
 *   node backend/scripts/repairAadamCawiliInstallmentGenerationQueue.js --apply --generate
 *
 * If --generate stored next_generation_date one month too far (generator bug, fixed in
 * installmentInvoiceGenerator.js), re-run --apply only to sync the queue to Jul 25 / Aug 1.
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal } from '../utils/dateUtils.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';

const STUDENT_EMAIL = 'may778848@gmail.com';
const STUDENT_NAME = 'Aadam June Cawili';
const PROFILE_ID = 142;

const REPAIR_NOTE = 'Ops pilot — Aadam Cawili installment queue repair (June 25)';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const isGenerate = args.has('--generate');

const ymd = (value) => {
  if (!value) return null;
  return formatYmdLocal(value).slice(0, 10);
};

async function loadProfileRow(client) {
  const res = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id, ip.branch_id,
            ip.phase_start, ip.total_phases, ip.generated_count, ip.is_active,
            ip.downpayment_paid, ip.downpayment_invoice_id, ip.amount, ip.frequency,
            ip.description,
            ii.installmentinvoicedtl_id, ii.next_generation_date, ii.next_invoice_month,
            ii.status AS ii_status, ii.frequency AS ii_frequency,
            ii.total_amount_including_tax, ii.total_amount_excluding_tax,
            u.full_name AS student_name, u.email AS student_email,
            c.class_name
     FROM installmentinvoiceprofilestbl ip
     INNER JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     INNER JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     WHERE ip.installmentinvoiceprofiles_id = $1`,
    [PROFILE_ID]
  );
  return res.rows[0] || null;
}

async function loadJunePhaseInvoice(client, profileId) {
  const res = await client.query(
    `SELECT i.invoice_id, i.status,
            TO_CHAR(TIMEZONE('Asia/Manila', i.issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', i.due_date), 'YYYY-MM-DD') AS due_ymd,
            i.remarks
     FROM invoicestbl i
     INNER JOIN installmentinvoiceprofilestbl ip
       ON ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
     WHERE i.installmentinvoiceprofiles_id = $1
       AND TIMEZONE('Asia/Manila', i.issue_date)::date >= '2026-06-01'::date
       AND TIMEZONE('Asia/Manila', i.issue_date)::date < '2026-07-01'::date
       AND (
         ip.downpayment_invoice_id IS NULL
         OR COALESCE(i.invoice_chain_root_id, i.invoice_id) <> ip.downpayment_invoice_id::integer
       )
     ORDER BY i.invoice_id DESC
     LIMIT 1`,
    [profileId]
  );
  return res.rows[0] || null;
}

function printState(label, row, sched) {
  console.log(`\n${label}:`);
  console.table([
    {
      profile_id: row.installmentinvoiceprofiles_id,
      student: row.student_name,
      email: row.student_email,
      class: row.class_name,
      generated_count: row.generated_count,
      total_phases: row.total_phases,
      queue_status: row.ii_status ?? '—',
      stored_next_gen: ymd(row.next_generation_date),
      stored_next_month: ymd(row.next_invoice_month),
      expected_next_gen: sched?.current_generation_date ?? '—',
      expected_next_month: sched?.current_invoice_month ?? '—',
      next_phase: sched?.current_phase_number ?? '—',
      expected_issue: sched?.current_issue_date ?? '—',
      expected_due: sched?.current_due_date ?? '—',
    },
  ]);
}

async function main() {
  console.log(
    `\nAadam Cawili — installment queue repair${isApply ? ' (APPLY)' : ' (DRY RUN)'}${
      isGenerate ? ' + GENERATE' : ''
    }\n`
  );

  const client = await getClient();

  try {
    const row = await loadProfileRow(client);
    if (!row) {
      throw new Error(`Profile ${PROFILE_ID} not found`);
    }
    if (row.student_email?.toLowerCase() !== STUDENT_EMAIL.toLowerCase()) {
      throw new Error(
        `Profile ${PROFILE_ID} email mismatch (expected ${STUDENT_EMAIL}, got ${row.student_email})`
      );
    }

    const profile = {
      installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
      class_id: row.class_id,
      phase_start: row.phase_start,
      total_phases: row.total_phases,
      generated_count: row.generated_count,
    };

    if (!isPhaseInstallmentProfile(profile)) {
      throw new Error('Profile is not class-linked');
    }

    const sched = await buildPhaseInstallmentSchedule({
      db: client,
      profile,
      generatedCountOverride: parseInt(row.generated_count || 0, 10),
    });

    const juneInvoiceBefore = await loadJunePhaseInvoice(client, PROFILE_ID);
    printState('BEFORE', row, sched);

    if (juneInvoiceBefore) {
      console.log('\nExisting phase invoice in June 2026:');
      console.table([juneInvoiceBefore]);
    } else {
      console.log('\nNo phase invoice issued in June 2026 yet.');
    }

    const storedGen = ymd(row.next_generation_date);
    const storedMonth = ymd(row.next_invoice_month);
    const expectedGen = sched?.current_generation_date || null;
    const expectedMonth = sched?.current_invoice_month || null;
    const needsStatusFix =
      parseInt(row.generated_count || 0, 10) < parseInt(row.total_phases || 0, 10) &&
      row.ii_status === 'Generated';
    const needsGenFix = Boolean(expectedGen && storedGen !== expectedGen);
    const needsMonthFix = Boolean(expectedMonth && storedMonth !== expectedMonth);
    const needsRepair = needsStatusFix || needsGenFix || needsMonthFix;

    console.log('\nPlanned queue repair:');
    if (!needsRepair) {
      console.log('  • Queue already matches schedule — no date repair needed.');
    } else {
      if (needsStatusFix) console.log(`  • status: ${row.ii_status} → NULL`);
      if (needsGenFix) console.log(`  • next_generation_date: ${storedGen} → ${expectedGen}`);
      if (needsMonthFix) console.log(`  • next_invoice_month: ${storedMonth} → ${expectedMonth}`);
    }

    if (isGenerate) {
      console.log('\nAfter repair, generator will create:');
      console.log(`  • Phase ${sched?.current_phase_number} invoice`);
      console.log(`  • Issue: ${sched?.current_issue_date} | Due: ${sched?.current_due_date}`);
      console.log(`  • Then next_generation_date → ${sched?.current_generation_date ?? '—'}`);
    }

    if (!isApply) {
      console.log('\nRe-run with --apply to write queue fixes.');
      if (needsRepair) {
        console.log('Then add --generate to create the missed June 25 invoice for this student only.');
      }
      return;
    }

    await client.query('BEGIN');

    if (needsRepair) {
      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL, next_generation_date = $1, next_invoice_month = $2
         WHERE installmentinvoicedtl_id = $3`,
        [expectedGen, expectedMonth, row.installmentinvoicedtl_id]
      );
      console.log('\n✅ Queue dates updated.');
    }

    let generated = null;
    if (isGenerate) {
      const fresh = await loadProfileRow(client);
      const installmentInvoice = {
        installmentinvoicedtl_id: fresh.installmentinvoicedtl_id,
        installmentinvoiceprofiles_id: fresh.installmentinvoiceprofiles_id,
        next_generation_date: fresh.next_generation_date,
        next_invoice_month: fresh.next_invoice_month,
        frequency: fresh.ii_frequency || fresh.frequency,
        total_amount_including_tax: fresh.total_amount_including_tax,
        total_amount_excluding_tax: fresh.total_amount_excluding_tax,
        status: fresh.ii_status,
      };
      const profilePayload = {
        student_id: fresh.student_id,
        branch_id: fresh.branch_id,
        package_id: null,
        amount: fresh.amount,
        frequency: fresh.frequency,
        description: fresh.description,
        generated_count: fresh.generated_count,
        class_id: fresh.class_id,
        total_phases: fresh.total_phases,
        phase_start: fresh.phase_start,
      };

      generated = await generateInvoiceFromInstallment(installmentInvoice, profilePayload);
      console.log('\n✅ Invoice generated:');
      console.table([
        {
          invoice_id: generated.invoice_id,
          phase: generated.phase_number,
          issue_date: generated.issue_date,
          due_date: generated.due_date,
          amount: generated.amount,
          next_generation_date: generated.next_generation_date,
        },
      ]);
    }

    await client.query('COMMIT');

    const rowAfter = await loadProfileRow(client);
    const schedAfter = await buildPhaseInstallmentSchedule({
      db: client,
      profile: {
        installmentinvoiceprofiles_id: rowAfter.installmentinvoiceprofiles_id,
        class_id: rowAfter.class_id,
        phase_start: rowAfter.phase_start,
        total_phases: rowAfter.total_phases,
        generated_count: rowAfter.generated_count,
      },
      generatedCountOverride: parseInt(rowAfter.generated_count || 0, 10),
    });
    printState('AFTER', rowAfter, schedAfter);

    const juneInvoiceAfter = await loadJunePhaseInvoice(client, PROFILE_ID);
    if (juneInvoiceAfter) {
      console.log('\nPhase invoice in June 2026 after run:');
      console.table([juneInvoiceAfter]);
    }

    console.log(`\n${REPAIR_NOTE}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFailed:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  });
