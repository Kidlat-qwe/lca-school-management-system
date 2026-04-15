/**
 * Repair installment-related due dates after class session schedules were corrected
 * (e.g. fixPhaseSessionDates.js / month boundary between phases).
 *
 * Business alignment (matches current backend code paths):
 * - Downpayment (Unpaid): due = enrollment date + 7 days, or issue_date + 7 if not yet in classstudentstbl.
 * - Phase installment (Unpaid, remarks contain TARGET_PHASE:N): due = first session of phase N
 *   minus PHASE_DUE_DAYS_BEFORE (default 1), same as buildPhaseInstallmentSchedule in phaseInstallmentUtils.js.
 * - Standard monthly installment (Unpaid, auto-generated, no TARGET_PHASE): due = 5th of month after issue
 *   (same pattern as installmentInvoiceGenerator non-phase branch).
 * - Pending installmentinvoicestbl rows + bill/next fields on installmentinvoiceprofilestbl for phase packages:
 *   rebuilt via buildPhaseInstallmentSchedule from current classsessionstbl MIN(scheduled_date) per phase.
 *
 * Run: node backend/scripts/repairInstallmentDatesAfterClassSessionFix.js [--dry-run]
 *
 * Safe defaults: only updates rows that need a change; use --dry-run to preview.
 */

import '../config/loadEnv.js';
import { query, getClient } from '../config/database.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
} from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal, parseYmdToLocalNoon } from '../utils/dateUtils.js';

/** Keep in sync with backend/utils/phaseInstallmentUtils.js PHASE_INSTALLMENT_DUE_DAYS_BEFORE */
const PHASE_DUE_DAYS_BEFORE = 1;

const addDaysYmd = (ymd, deltaDays) => {
  const d = parseYmdToLocalNoon(String(ymd).slice(0, 10));
  if (!d) return null;
  d.setDate(d.getDate() + deltaDays);
  return formatYmdLocal(d);
};

const monthPlusOneDayFiveDue = (issueYmd) => {
  const d = parseYmdToLocalNoon(String(issueYmd).slice(0, 10));
  if (!d) return null;
  d.setMonth(d.getMonth() + 1);
  d.setDate(5);
  return formatYmdLocal(d);
};

async function getPhaseMinDate(client, classId, phaseNumber) {
  const r = await client.query(
    `SELECT MIN(scheduled_date)::text AS d
     FROM classsessionstbl
     WHERE class_id = $1 AND phase_number = $2
       AND COALESCE(status, 'Scheduled') != 'Cancelled'`,
    [classId, phaseNumber]
  );
  const raw = r.rows[0]?.d;
  if (!raw) return null;
  return String(raw).slice(0, 10);
}

async function repairDownpayments(client, dryRun) {
  const res = await client.query(
    `SELECT i.invoice_id, i.issue_date::text AS issue_date, i.due_date::text AS due_date,
            p.installmentinvoiceprofiles_id, p.class_id, p.student_id
     FROM invoicestbl i
     INNER JOIN installmentinvoiceprofilestbl p ON p.downpayment_invoice_id = i.invoice_id
     WHERE i.status = 'Unpaid'
       AND p.class_id IS NOT NULL`
  );

  let n = 0;
  for (const row of res.rows) {
    const enroll = await client.query(
      `SELECT MIN(enrolled_at::date)::text AS d
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
         AND COALESCE(enrollment_status, 'Active') = 'Active'`,
      [row.student_id, row.class_id]
    );
    let baseYmd = enroll.rows[0]?.d ? String(enroll.rows[0].d).slice(0, 10) : row.issue_date;
    if (!baseYmd) baseYmd = row.issue_date;

    const newDue = addDaysYmd(baseYmd, 7);
    if (!newDue || newDue === row.due_date) continue;

    console.log(
      `  Downpayment invoice ${row.invoice_id}: due ${row.due_date} → ${newDue} (base enrollment/issue: ${baseYmd})`
    );
    n++;
    if (!dryRun) {
      await client.query(`UPDATE invoicestbl SET due_date = $1::date WHERE invoice_id = $2`, [
        newDue,
        row.invoice_id,
      ]);
    }
  }
  return n;
}

async function repairPhaseTargetInvoices(client, dryRun) {
  const res = await client.query(
    `SELECT i.invoice_id, i.due_date::text AS due_date, i.remarks,
            p.installmentinvoiceprofiles_id, p.class_id, p.phase_start
     FROM invoicestbl i
     INNER JOIN installmentinvoiceprofilestbl p ON i.installmentinvoiceprofiles_id = p.installmentinvoiceprofiles_id
     WHERE i.status = 'Unpaid'
       AND p.class_id IS NOT NULL
       AND p.phase_start IS NOT NULL
       AND i.remarks LIKE '%TARGET_PHASE:%'`
  );

  let n = 0;
  for (const row of res.rows) {
    const m = String(row.remarks || '').match(/TARGET_PHASE:(\d+)/);
    if (!m) continue;
    const phaseNum = parseInt(m[1], 10);
    if (!Number.isInteger(phaseNum)) continue;

    const phaseMin = await getPhaseMinDate(client, row.class_id, phaseNum);
    if (!phaseMin) {
      console.warn(`  Skip invoice ${row.invoice_id}: no sessions for class ${row.class_id} phase ${phaseNum}`);
      continue;
    }

    const newDue = addDaysYmd(phaseMin, -PHASE_DUE_DAYS_BEFORE);
    if (!newDue || newDue === row.due_date) continue;

    console.log(
      `  Phase invoice ${row.invoice_id} (P${phaseMin}): due ${row.due_date} → ${newDue}`
    );
    n++;
    if (!dryRun) {
      await client.query(`UPDATE invoicestbl SET due_date = $1::date WHERE invoice_id = $2`, [
        newDue,
        row.invoice_id,
      ]);
    }
  }
  return n;
}

async function repairFirstClassInstallmentUnpaid(client, dryRun) {
  const res = await client.query(
    `WITH first_non_downpayment AS (
       SELECT
         i.installmentinvoiceprofiles_id,
         MIN(i.invoice_id) AS first_invoice_id
       FROM invoicestbl i
       INNER JOIN installmentinvoiceprofilestbl ip
         ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE i.installmentinvoiceprofiles_id IS NOT NULL
         AND ip.class_id IS NOT NULL
         AND ip.phase_start IS NULL
         AND (ip.downpayment_invoice_id IS NULL OR i.invoice_id <> ip.downpayment_invoice_id)
         AND i.remarks LIKE 'Auto-generated from installment invoice:%'
       GROUP BY i.installmentinvoiceprofiles_id
     )
     SELECT
       i.invoice_id,
       i.due_date::text AS due_date,
       ip.class_id
     FROM first_non_downpayment f
     INNER JOIN invoicestbl i ON i.invoice_id = f.first_invoice_id
     INNER JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = f.installmentinvoiceprofiles_id
     WHERE i.status = 'Unpaid'`
  );

  let n = 0;
  for (const row of res.rows) {
    const phaseOneStart = await getPhaseMinDate(client, row.class_id, 1);
    if (!phaseOneStart) continue;
    const newDue = addDaysYmd(phaseOneStart, -PHASE_DUE_DAYS_BEFORE);
    if (!newDue || newDue === row.due_date) continue;

    console.log(
      `  First class-installment invoice ${row.invoice_id}: due ${row.due_date} → ${newDue} (phase 1 start ${phaseOneStart})`
    );
    n++;
    if (!dryRun) {
      await client.query(`UPDATE invoicestbl SET due_date = $1::date WHERE invoice_id = $2`, [
        newDue,
        row.invoice_id,
      ]);
    }
  }
  return n;
}

async function repairStandardMonthlyUnpaid(client, dryRun) {
  const res = await client.query(
    `WITH first_non_downpayment AS (
       SELECT
         i.installmentinvoiceprofiles_id,
         MIN(i.invoice_id) AS first_invoice_id
       FROM invoicestbl i
       INNER JOIN installmentinvoiceprofilestbl ip
         ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE i.installmentinvoiceprofiles_id IS NOT NULL
         AND ip.phase_start IS NULL
         AND (ip.downpayment_invoice_id IS NULL OR i.invoice_id <> ip.downpayment_invoice_id)
         AND i.remarks LIKE 'Auto-generated from installment invoice:%'
         AND i.remarks NOT LIKE '%TARGET_PHASE:%'
       GROUP BY i.installmentinvoiceprofiles_id
     )
     SELECT i.invoice_id, i.issue_date::text AS issue_date, i.due_date::text AS due_date,
            p.phase_start, p.class_id
     FROM invoicestbl i
     INNER JOIN installmentinvoiceprofilestbl p ON i.installmentinvoiceprofiles_id = p.installmentinvoiceprofiles_id
     LEFT JOIN first_non_downpayment f ON f.installmentinvoiceprofiles_id = p.installmentinvoiceprofiles_id
     WHERE i.status = 'Unpaid'
       AND (p.phase_start IS NULL)
       AND i.remarks LIKE 'Auto-generated from installment invoice:%'
       AND i.remarks NOT LIKE '%TARGET_PHASE:%'
       AND (f.first_invoice_id IS NULL OR i.invoice_id <> f.first_invoice_id)`
  );

  let n = 0;
  for (const row of res.rows) {
    const newDue = monthPlusOneDayFiveDue(row.issue_date);
    if (!newDue || newDue === row.due_date) continue;

    console.log(`  Monthly invoice ${row.invoice_id}: due ${row.due_date} → ${newDue} (issue ${row.issue_date})`);
    n++;
    if (!dryRun) {
      await client.query(`UPDATE invoicestbl SET due_date = $1::date WHERE invoice_id = $2`, [
        newDue,
        row.invoice_id,
      ]);
    }
  }
  return n;
}

async function refreshPhaseProfilesAndQueue(client, dryRun) {
  const res = await client.query(
    `SELECT ip.*
     FROM installmentinvoiceprofilestbl ip
     WHERE ip.is_active = true
       AND ip.class_id IS NOT NULL
       AND ip.phase_start IS NOT NULL`
  );

  let profiles = 0;
  let queueRows = 0;

  for (const profile of res.rows) {
    if (!isPhaseInstallmentProfile(profile)) continue;

    const ii = await client.query(
      `SELECT installmentinvoicedtl_id, scheduled_date::text, next_generation_date::text, next_invoice_month::text, status
       FROM installmentinvoicestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND COALESCE(status, '') != 'Generated'
       ORDER BY installmentinvoicedtl_id DESC
       LIMIT 1`,
      [profile.installmentinvoiceprofiles_id]
    );

    const queueRow = ii.rows[0];
    const issueOverrideYmd =
      (queueRow?.next_generation_date && String(queueRow.next_generation_date).slice(0, 10)) ||
      (profile.first_generation_date && formatYmdLocal(parseYmdToLocalNoon(profile.first_generation_date))) ||
      formatYmdLocal(new Date());

    let schedule;
    try {
      schedule = await buildPhaseInstallmentSchedule({
        db: client,
        profile: {
          class_id: profile.class_id,
          phase_start: profile.phase_start,
          total_phases: profile.total_phases,
          generated_count: profile.generated_count || 0,
        },
        generatedCountOverride: profile.generated_count || 0,
        issueDateOverride: issueOverrideYmd,
      });
    } catch (e) {
      console.warn(`  Profile ${profile.installmentinvoiceprofiles_id}: ${e.message}`);
      continue;
    }

    if (!schedule || schedule.is_last_phase) {
      continue;
    }

    const bill = schedule.current_due_date;
    const nextBill = schedule.next_due_date;
    const needProfileUpdate =
      bill &&
      (String(profile.bill_invoice_due_date || '').slice(0, 10) !== bill ||
        String(profile.next_invoice_due_date || '').slice(0, 10) !== (nextBill || ''));

    if (needProfileUpdate) {
      console.log(
        `  Profile ${profile.installmentinvoiceprofiles_id}: bill_due ${profile.bill_invoice_due_date} → ${bill}, next ${profile.next_invoice_due_date} → ${nextBill}`
      );
      profiles++;
      if (!dryRun) {
        await client.query(
          `UPDATE installmentinvoiceprofilestbl
           SET bill_invoice_due_date = $1::date,
               next_invoice_due_date = $2::date,
               first_billing_month = COALESCE($3::date, first_billing_month),
               first_generation_date = COALESCE($4::date, first_generation_date)
           WHERE installmentinvoiceprofiles_id = $5`,
          [
            bill,
            nextBill,
            schedule.current_invoice_month,
            schedule.current_generation_date,
            profile.installmentinvoiceprofiles_id,
          ]
        );
      }
    }

    if (!queueRow) continue;

    const sDue = schedule.current_due_date;
    const sGen = schedule.current_generation_date;
    const sMonth = schedule.current_invoice_month;

    const needQueue =
      sDue &&
      (String(queueRow.scheduled_date || '').slice(0, 10) !== String(sDue).slice(0, 10) ||
        String(queueRow.next_generation_date || '').slice(0, 10) !== String(sGen).slice(0, 10) ||
        String(queueRow.next_invoice_month || '').slice(0, 10) !== String(sMonth).slice(0, 10));

    if (needQueue) {
      console.log(
        `  Installment queue ${queueRow.installmentinvoicedtl_id} (profile ${profile.installmentinvoiceprofiles_id}): scheduled ${queueRow.scheduled_date} → ${sDue}, next_gen ${queueRow.next_generation_date} → ${sGen}, month ${queueRow.next_invoice_month} → ${sMonth}`
      );
      queueRows++;
      if (!dryRun) {
        await client.query(
          `UPDATE installmentinvoicestbl
           SET scheduled_date = $1::date,
               next_generation_date = $2::date,
               next_invoice_month = $3::date
           WHERE installmentinvoicedtl_id = $4`,
          [sDue, sGen, sMonth, queueRow.installmentinvoicedtl_id]
        );
      }
    }
  }

  return { profiles, queueRows };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\nRepair installment dates${dryRun ? ' (DRY RUN — no DB writes)' : ''}\n`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const dp = await repairDownpayments(client, dryRun);
    const ph = await repairPhaseTargetInvoices(client, dryRun);
    const firstClassInstallment = await repairFirstClassInstallmentUnpaid(client, dryRun);
    const mo = await repairStandardMonthlyUnpaid(client, dryRun);
    const { profiles, queueRows } = await refreshPhaseProfilesAndQueue(client, dryRun);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDry run complete (rolled back).');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    }

    console.log('\nSummary:');
    console.log(`  Downpayment due dates updated: ${dp}`);
    console.log(`  Phase (TARGET_PHASE) invoice due dates updated: ${ph}`);
    console.log(`  First class-installment due dates updated: ${firstClassInstallment}`);
    console.log(`  Standard monthly unpaid due dates updated: ${mo}`);
    console.log(`  Phase profile billing fields touched: ${profiles}`);
    console.log(`  Installment queue rows touched: ${queueRows}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Failed:', e);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();
