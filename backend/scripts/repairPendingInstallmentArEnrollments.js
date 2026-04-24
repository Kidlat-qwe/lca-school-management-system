/**
 * Repair pending installment AR enrollments where Phase 1 is already paid.
 *
 * Default mode is DRY RUN.
 * Usage:
 *   node backend/scripts/repairPendingInstallmentArEnrollments.js
 *   node backend/scripts/repairPendingInstallmentArEnrollments.js --dry-run
 *   node backend/scripts/repairPendingInstallmentArEnrollments.js --apply
 */
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const isDryRun = !isApply || args.has('--dry-run');

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const candidatesRes = await client.query(
      `SELECT
         ip.installmentinvoiceprofiles_id,
         ip.student_id,
         ip.class_id,
         COALESCE(ip.phase_start, 1) AS target_phase,
         u.full_name AS student_name
       FROM installmentinvoiceprofilestbl ip
       INNER JOIN userstbl u ON u.user_id = ip.student_id
       WHERE ip.is_active = true
         AND ip.class_id IS NOT NULL
         AND ip.downpayment_paid = true
         AND EXISTS (
           SELECT 1
           FROM invoicestbl i
           INNER JOIN paymenttbl p ON p.invoice_id = i.invoice_id
           WHERE i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
             AND p.status = 'Completed'
             AND (ip.downpayment_invoice_id IS NULL OR i.invoice_id <> ip.downpayment_invoice_id)
         )`
    );

    const candidates = candidatesRes.rows || [];
    const actions = [];

    for (const row of candidates) {
      const { student_id, class_id, target_phase } = row;

      const activeRes = await client.query(
        `SELECT classstudent_id
         FROM classstudentstbl
         WHERE student_id = $1
           AND class_id = $2
           AND phase_number = $3
           AND COALESCE(enrollment_status, 'Active') = 'Active'
           AND removed_at IS NULL
         LIMIT 1`,
        [student_id, class_id, target_phase]
      );
      if (activeRes.rows.length > 0) continue;

      const removedRes = await client.query(
        `SELECT classstudent_id
         FROM classstudentstbl
         WHERE student_id = $1
           AND class_id = $2
           AND phase_number = $3
           AND COALESCE(enrollment_status, 'Active') = 'Removed'
         ORDER BY removed_at DESC NULLS LAST, classstudent_id DESC
         LIMIT 1`,
        [student_id, class_id, target_phase]
      );

      if (removedRes.rows.length > 0) {
        const classstudentId = removedRes.rows[0].classstudent_id;
        actions.push({
          type: 'reactivate',
          classstudent_id: classstudentId,
          student_id,
          class_id,
          phase_number: target_phase,
          student_name: row.student_name,
        });
        if (!isDryRun) {
          await client.query(
            `UPDATE classstudentstbl
             SET enrollment_status = 'Active',
                 removed_at = NULL,
                 removed_reason = NULL,
                 removed_by = NULL,
                 enrolled_by = 'System (Repair script: installment AR paid phase)',
                 enrolled_at = CURRENT_TIMESTAMP
             WHERE classstudent_id = $1`,
            [classstudentId]
          );
        }
      } else {
        actions.push({
          type: 'insert',
          student_id,
          class_id,
          phase_number: target_phase,
          student_name: row.student_name,
        });
        if (!isDryRun) {
          await client.query(
            `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number)
             VALUES ($1, $2, 'System (Repair script: installment AR paid phase)', $3)`,
            [student_id, class_id, target_phase]
          );
        }
      }
    }

    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('DRY RUN: repairPendingInstallmentArEnrollments');
      console.log(`Candidates scanned: ${candidates.length}`);
      console.log(`Would repair: ${actions.length}`);
      for (const a of actions) {
        console.log(
          ` - ${a.type.toUpperCase()} student_id=${a.student_id} class_id=${a.class_id} phase=${a.phase_number} (${a.student_name})`
        );
      }
      console.log('No data changed. Re-run with --apply to execute.');
    } else {
      await client.query('COMMIT');
      console.log('APPLY MODE: repairPendingInstallmentArEnrollments');
      console.log(`Candidates scanned: ${candidates.length}`);
      console.log(`Repaired: ${actions.length}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Repair failed. Transaction rolled back.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

