/**
 * Repair class-linked installment billing that used the monthly 25th/5th cycle
 * because installmentinvoiceprofilestbl.phase_start was NULL (legacy rows).
 *
 * Actions per profile:
 *  1. Set phase_start = COALESCE(phase_start, 1) when class_id is set
 *  2. Remove Unpaid auto-generated phase invoices whose due_date does not match
 *     the class session schedule for that phase index (premature monthly bills)
 *  3. Reset generated_count to the number of remaining phase invoices
 *  4. Realign installmentinvoicestbl queue dates via buildPhaseInstallmentSchedule
 *
 * Usage (from backend/):
 *   node scripts/repairClassLinkedInstallmentBilling.js --dry-run
 *   node scripts/repairClassLinkedInstallmentBilling.js --email lucasgab03162020@gmail.com --dry-run
 *   node scripts/repairClassLinkedInstallmentBilling.js --email lucasgab03162020@gmail.com --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import {
  buildPhaseInstallmentSchedule,
  isPhaseInstallmentProfile,
  resolveProfilePhaseStart,
} from '../utils/phaseInstallmentUtils.js';
import { formatYmdLocal, parseYmdToLocalNoon } from '../utils/dateUtils.js';

const PHASE_DUE_DAYS_BEFORE = 1;

function parseArgs() {
  const argv = process.argv.slice(2);
  let email = null;
  let userId = null;
  let apply = false;
  let dryRun = true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') {
      apply = true;
      dryRun = false;
    } else if (a === '--dry-run') dryRun = true;
    else if (a === '--email' && argv[i + 1]) email = String(argv[++i]).trim();
    else if (a === '--user-id' && argv[i + 1]) userId = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') {
      console.log(`
Usage: node scripts/repairClassLinkedInstallmentBilling.js [options]

  --dry-run          Preview only (default)
  --apply            Commit changes
  --email <email>    Limit to one student
  --user-id <id>     Limit to one student
`);
      process.exit(0);
    }
  }

  return { email, userId, dryRun: dryRun && !apply, apply };
}

async function getPhaseDueYmd(client, classId, phaseNumber) {
  const r = await client.query(
    `SELECT MIN(scheduled_date)::text AS d
     FROM classsessionstbl
     WHERE class_id = $1 AND phase_number = $2
       AND COALESCE(status, 'Scheduled') != 'Cancelled'`,
    [classId, phaseNumber]
  );
  const raw = r.rows[0]?.d;
  if (!raw) return null;
  const d = parseYmdToLocalNoon(String(raw).slice(0, 10));
  if (!d) return null;
  d.setDate(d.getDate() - PHASE_DUE_DAYS_BEFORE);
  return formatYmdLocal(d);
}

async function deleteInvoice(client, invoiceId) {
  await client.query('DELETE FROM paymenttbl WHERE invoice_id = $1', [invoiceId]);
  await client.query('DELETE FROM promousagetbl WHERE invoice_id = $1', [invoiceId]);
  await client.query('DELETE FROM invoicestudentstbl WHERE invoice_id = $1', [invoiceId]);
  await client.query('DELETE FROM invoiceitemstbl WHERE invoice_id = $1', [invoiceId]);
  await client.query('DELETE FROM invoicestbl WHERE invoice_id = $1', [invoiceId]);
}

async function main() {
  const { email, userId, dryRun } = parseArgs();
  console.log(`\nRepair class-linked installment billing${dryRun ? ' (DRY RUN)' : ' (APPLY)'}\n`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    let studentFilter = '';
    const params = [];
    if (userId) {
      params.push(userId);
      studentFilter = ` AND ip.student_id = $${params.length}`;
    } else if (email) {
      params.push(email);
      studentFilter = ` AND ip.student_id = (SELECT user_id FROM userstbl WHERE LOWER(TRIM(email)) = LOWER(TRIM($${params.length})) LIMIT 1)`;
    }

    const profilesRes = await client.query(
      `SELECT ip.*, u.full_name, u.email
       FROM installmentinvoiceprofilestbl ip
       JOIN userstbl u ON u.user_id = ip.student_id
       WHERE ip.class_id IS NOT NULL
         AND ip.is_active = true
         ${studentFilter}
       ORDER BY ip.installmentinvoiceprofiles_id`,
      params
    );

    let profilesTouched = 0;
    let invoicesDeleted = 0;

    for (const profile of profilesRes.rows) {
      if (!isPhaseInstallmentProfile(profile)) continue;

      const phaseStart = resolveProfilePhaseStart(profile);
      const needsPhaseStart = profile.phase_start == null;

      const invRes = await client.query(
        `SELECT invoice_id, issue_date::text AS issue_date, due_date::text AS due_date,
                status, remarks
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND ($2::int IS NULL OR invoice_id <> $2)
           AND remarks LIKE 'Auto-generated from installment invoice:%'
         ORDER BY invoice_id ASC`,
        [profile.installmentinvoiceprofiles_id, profile.downpayment_invoice_id]
      );

      const toDelete = [];

      for (let index = 0; index < invRes.rows.length; index++) {
        const inv = invRes.rows[index];
        const phaseNum = phaseStart + index;
        const expectedDue = await getPhaseDueYmd(client, profile.class_id, phaseNum);
        const actualDue = String(inv.due_date || '').slice(0, 10);
        const match = expectedDue && actualDue === expectedDue;

        if (!match && inv.status === 'Unpaid') {
          toDelete.push(inv);
          console.log(
            `  [${profile.full_name}] DELETE invoice ${inv.invoice_id} phase ${phaseNum}: due ${actualDue} expected ${expectedDue || '(no sessions)'}`
          );
        } else if (!match) {
          console.log(
            `  [${profile.full_name}] KEEP (not Unpaid) invoice ${inv.invoice_id} phase ${phaseNum}: due ${actualDue} expected ${expectedDue || '(no sessions)'}`
          );
        } else {
          console.log(
            `  [${profile.full_name}] OK invoice ${inv.invoice_id} phase ${phaseNum} due ${actualDue}`
          );
        }
      }

      const remainingCount = invRes.rows.length - toDelete.length;

      if (needsPhaseStart) {
        console.log(
          `  [${profile.full_name}] profile ${profile.installmentinvoiceprofiles_id}: phase_start NULL → ${phaseStart}`
        );
        if (!dryRun) {
          await client.query(
            `UPDATE installmentinvoiceprofilestbl SET phase_start = $1 WHERE installmentinvoiceprofiles_id = $2`,
            [phaseStart, profile.installmentinvoiceprofiles_id]
          );
        }
      }

      if (toDelete.length > 0 || needsPhaseStart || profile.generated_count !== remainingCount) {
        profilesTouched++;
      }

      for (const inv of toDelete) {
        invoicesDeleted++;
        if (!dryRun) {
          await deleteInvoice(client, inv.invoice_id);
        }
      }

      if (profile.generated_count !== remainingCount) {
        console.log(
          `  [${profile.full_name}] generated_count ${profile.generated_count} → ${remainingCount}`
        );
        if (!dryRun) {
          await client.query(
            `UPDATE installmentinvoiceprofilestbl SET generated_count = $1 WHERE installmentinvoiceprofiles_id = $2`,
            [remainingCount, profile.installmentinvoiceprofiles_id]
          );
        }
      }

      const profileForSched = {
        ...profile,
        phase_start: phaseStart,
        generated_count: remainingCount,
      };

      let schedule;
      try {
        schedule = await buildPhaseInstallmentSchedule({
          db: client,
          profile: profileForSched,
          generatedCountOverride: remainingCount,
        });
      } catch (e) {
        console.warn(`  [${profile.full_name}] schedule skip: ${e.message}`);
        continue;
      }

      if (!schedule || schedule.is_last_phase) continue;

      const queueRes = await client.query(
        `SELECT installmentinvoicedtl_id, scheduled_date::text, next_generation_date::text,
                next_invoice_month::text, status
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND COALESCE(status, '') != 'Generated'
         ORDER BY installmentinvoicedtl_id DESC
         LIMIT 1`,
        [profile.installmentinvoiceprofiles_id]
      );
      const queueRow = queueRes.rows[0];
      if (!queueRow) continue;

      const sDue = schedule.current_due_date;
      const sGen = schedule.current_generation_date;
      const sMonth = schedule.current_invoice_month;

      console.log(
        `  [${profile.full_name}] queue ${queueRow.installmentinvoicedtl_id}: next_gen ${String(queueRow.next_generation_date).slice(0, 10)} → ${sGen}, scheduled ${String(queueRow.scheduled_date).slice(0, 10)} → ${sDue}`
      );

      if (!dryRun) {
        await client.query(
          `UPDATE installmentinvoicestbl
           SET scheduled_date = $1::date,
               next_generation_date = $2::date,
               next_invoice_month = $3::date
           WHERE installmentinvoicedtl_id = $4`,
          [sDue, sGen, sMonth, queueRow.installmentinvoicedtl_id]
        );
        if (sDue && sGen) {
          await client.query(
            `UPDATE installmentinvoiceprofilestbl
             SET bill_invoice_due_date = $1::date,
                 next_invoice_due_date = $2::date,
                 first_billing_month = COALESCE($3::date, first_billing_month),
                 first_generation_date = COALESCE($4::date, first_generation_date)
             WHERE installmentinvoiceprofiles_id = $5`,
            [
              sDue,
              schedule.next_due_date || sDue,
              sMonth,
              sGen,
              profile.installmentinvoiceprofiles_id,
            ]
          );
        }
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDry run complete (rolled back).');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    }

    console.log(`\nSummary: profiles touched ${profilesTouched}, invoices deleted ${invoicesDeleted}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

main();
