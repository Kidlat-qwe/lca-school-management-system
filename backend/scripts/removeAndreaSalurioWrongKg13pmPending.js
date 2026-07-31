/**
 * Andrea Claire Salurio — remove wrong pending enrollment on KG_1-3PM only.
 *
 * Context (production UI: Class Students → KG_1-3PM · Kindergarten):
 *   user_id 640 · deegurrolajanine123@gmail.com
 *   Shows as Pending / Not verified / Pending Enrollment — NOT a classstudent row.
 *   Source: active installment profile on class 166 (KG_1-3PM) + unpaid
 *   downpayment INV-2368 (AR 262033, remarks CLASS_ID:166).
 *
 * Keep untouched:
 *   Active VMP_Pre-Kindergarten_MWF 4PM (class 162) phases 1–9
 *   Prior soft-removed VMP rows on classes 65 / 66
 *
 * Apply (soft cancel — no hard deletes):
 *   1. Soft-remove any active classstudent rows on class 166 for this student
 *   2. Cancel unpaid invoices on the KG profile (refuse if any Paid)
 *   3. Deactivate installment profile (is_active = false) so she leaves the
 *      class Students pending list
 *
 * Usage (from backend/):
 *   node scripts/removeAndreaSalurioWrongKg13pmPending.js
 *   node scripts/removeAndreaSalurioWrongKg13pmPending.js --apply
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';

const STUDENT_ID = 640;
const STUDENT_EMAIL = 'deegurrolajanine123@gmail.com';
const REMOVE_CLASS_ID = 166;
const REMOVE_CLASS_NAME = 'KG_1-3PM';
/** Expected unpaid downpayment (sanity check; script still discovers by profile). */
const EXPECTED_DOWNPAYMENT_INVOICE_ID = 2368;
/** Must never be touched. */
const KEEP_CLASS_ID = 162;

const REPAIR_NOTE =
  'Ops repair — Andrea Salurio: remove wrong pending enrollment on KG_1-3PM (166); keep VMP 4PM (162)';

const isApply = process.argv.includes('--apply');

async function loadSnapshot(queryFn = query) {
  const student = (
    await queryFn(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1`,
      [STUDENT_ID]
    )
  ).rows[0];

  const removeClass = (
    await queryFn(
      `SELECT class_id, class_name, status, branch_id,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_ymd
       FROM classestbl WHERE class_id = $1`,
      [REMOVE_CLASS_ID]
    )
  ).rows[0];

  const keepClass = (
    await queryFn(
      `SELECT class_id, class_name, status
       FROM classestbl WHERE class_id = $1`,
      [KEEP_CLASS_ID]
    )
  ).rows[0];

  const profiles = (
    await queryFn(
      `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.class_id,
              ip.package_id, ip.is_active, ip.downpayment_paid,
              ip.downpayment_invoice_id, ip.generated_count, ip.total_phases,
              ip.phase_start, pkg.package_name
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN packagestbl pkg ON pkg.package_id = ip.package_id
       WHERE ip.student_id = $1 AND ip.class_id = $2
       ORDER BY ip.installmentinvoiceprofiles_id DESC`,
      [STUDENT_ID, REMOVE_CLASS_ID]
    )
  ).rows;

  const profileIds = profiles.map((p) => Number(p.installmentinvoiceprofiles_id));
  const profileParam = profileIds.length ? profileIds : [-1];

  const invoices = (
    await queryFn(
      `SELECT i.invoice_id, i.status, i.invoice_ar_number, i.amount::text AS amount,
              i.installmentinvoiceprofiles_id, i.invoice_chain_root_id,
              i.invoice_description,
              LEFT(COALESCE(i.remarks, ''), 140) AS remarks,
              TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_ymd
       FROM invoicestbl i
       JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       WHERE ist.student_id = $1
         AND (
           i.installmentinvoiceprofiles_id = ANY($2::int[])
           OR COALESCE(i.remarks, '') LIKE $3
           OR i.invoice_id = $4
         )
       ORDER BY i.invoice_id`,
      [
        STUDENT_ID,
        profileParam,
        `%CLASS_ID:${REMOVE_CLASS_ID}%`,
        EXPECTED_DOWNPAYMENT_INVOICE_ID,
      ]
    )
  ).rows;

  const invoiceIds = invoices.map((i) => Number(i.invoice_id));
  const invParam = invoiceIds.length ? invoiceIds : [-1];

  const payments = (
    await queryFn(
      `SELECT payment_id, invoice_id, status, payment_method
       FROM paymenttbl
       WHERE invoice_id = ANY($1::int[])
       ORDER BY payment_id`,
      [invParam]
    )
  ).rows;

  const classstudents = (
    await queryFn(
      `SELECT cs.classstudent_id, cs.class_id, cs.phase_number,
              cs.program_enrollment_status,
              TO_CHAR(TIMEZONE('Asia/Manila', cs.enrolled_at), 'YYYY-MM-DD HH24:MI') AS enrolled,
              TO_CHAR(TIMEZONE('Asia/Manila', cs.removed_at), 'YYYY-MM-DD HH24:MI') AS removed
       FROM classstudentstbl cs
       WHERE cs.student_id = $1 AND cs.class_id = $2
       ORDER BY cs.phase_number, cs.classstudent_id`,
      [STUDENT_ID, REMOVE_CLASS_ID]
    )
  ).rows;

  const keepEnrollments = (
    await queryFn(
      `SELECT COUNT(*)::int AS active_rows
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2 AND removed_at IS NULL`,
      [STUDENT_ID, KEEP_CLASS_ID]
    )
  ).rows[0];

  return {
    student,
    removeClass,
    keepClass,
    profiles,
    invoices,
    payments,
    classstudents,
    keepEnrollments,
  };
}

async function main() {
  console.log(
    `\nAndrea Salurio — remove wrong KG_1-3PM pending enrollment${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}\n`);

  const before = await loadSnapshot();

  if (!before.student || Number(before.student.user_id) !== STUDENT_ID) {
    throw new Error(`Student ${STUDENT_ID} not found`);
  }
  if (
    String(before.student.email || '').toLowerCase() !== STUDENT_EMAIL.toLowerCase()
  ) {
    throw new Error(
      `Email mismatch: expected ${STUDENT_EMAIL}, got ${before.student.email}`
    );
  }
  if (!before.removeClass || before.removeClass.class_name !== REMOVE_CLASS_NAME) {
    throw new Error(
      `Class ${REMOVE_CLASS_ID} name mismatch: expected ${REMOVE_CLASS_NAME}, got ${before.removeClass?.class_name}`
    );
  }

  const activeProfiles = before.profiles.filter((p) => p.is_active === true);
  const paidInvoices = before.invoices.filter(
    (i) => String(i.status || '').toLowerCase() === 'paid'
  );
  if (paidInvoices.length) {
    throw new Error(
      `Refuse to remove: Paid invoices on KG profile/class — ${paidInvoices
        .map((i) => `INV-${i.invoice_id} (${i.status})`)
        .join(', ')}. Investigate before apply.`
    );
  }

  const activeClassstudents = before.classstudents.filter((r) => !r.removed);
  const unpaidToCancel = before.invoices.filter(
    (i) => String(i.status || '').toLowerCase() !== 'cancelled'
  );

  console.log('Student:', before.student.full_name, before.student.email);
  console.log('\nREMOVE class:', before.removeClass);
  console.log('\nProfiles on KG_1-3PM (166):');
  console.table(before.profiles);
  console.log('\nRelated invoices:');
  console.table(before.invoices);
  console.log('\nPayments on those invoices:');
  console.table(before.payments.length ? before.payments : [{ note: '(none)' }]);
  console.log('\nclassstudent rows on class 166:');
  console.table(
    before.classstudents.length ? before.classstudents : [{ note: '(none)' }]
  );
  console.log(
    `\nKEEP class ${KEEP_CLASS_ID} (${before.keepClass?.class_name}): ${before.keepEnrollments?.active_rows ?? 0} active enrollment row(s) — untouched`
  );

  console.log('\nPlanned changes:');
  console.table([
    {
      step: '1_soft_remove_classstudents',
      detail:
        activeClassstudents.length === 0
          ? 'none (no active classstudent on 166)'
          : `soft-remove ${activeClassstudents.map((r) => r.classstudent_id).join(', ')}`,
    },
    {
      step: '2_cancel_unpaid_invoices',
      detail:
        unpaidToCancel.length === 0
          ? 'none'
          : `cancel ${unpaidToCancel.map((i) => `INV-${i.invoice_id}`).join(', ')}`,
    },
    {
      step: '3_deactivate_profiles',
      detail:
        activeProfiles.length === 0
          ? before.profiles.length
            ? 'profiles already inactive'
            : 'WARNING: no profile found on class 166'
          : `is_active=false on ${activeProfiles
              .map((p) => p.installmentinvoiceprofiles_id)
              .join(', ')}`,
    },
    {
      step: '4_keep_vmp',
      detail: `class ${KEEP_CLASS_ID} unchanged`,
    },
  ]);

  if (!before.profiles.length && !before.invoices.length && !activeClassstudents.length) {
    console.log(
      '\nNothing to change — already removed from KG_1-3PM pending/enrollment.'
    );
    return;
  }

  if (!isApply) {
    console.log('\nDry run complete. Re-run with --apply to write changes.');
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const row of activeClassstudents) {
      const rem = await client.query(
        `UPDATE classstudentstbl
         SET removed_at = TIMEZONE('Asia/Manila', NOW()),
             removed_reason = $1
         WHERE classstudent_id = $2
           AND student_id = $3
           AND class_id = $4
           AND removed_at IS NULL
         RETURNING classstudent_id, phase_number,
                   TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD HH24:MI') AS removed`,
        [REPAIR_NOTE, row.classstudent_id, STUDENT_ID, REMOVE_CLASS_ID]
      );
      if (!rem.rows.length) {
        throw new Error(`Failed to soft-remove classstudent ${row.classstudent_id}`);
      }
      console.log('✅ Soft-removed classstudent:', rem.rows[0]);
    }

    for (const inv of unpaidToCancel) {
      const upd = await client.query(
        `UPDATE invoicestbl
         SET status = 'Cancelled',
             remarks = TRIM(BOTH ';' FROM (
               COALESCE(remarks, '') || '; ' || $1
             ))
         WHERE invoice_id = $2
           AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('paid', 'cancelled')
         RETURNING invoice_id, status, LEFT(COALESCE(remarks, ''), 160) AS remarks`,
        [REPAIR_NOTE, inv.invoice_id]
      );
      if (!upd.rows.length) {
        throw new Error(`Failed to cancel INV-${inv.invoice_id} (status=${inv.status})`);
      }
      console.log('✅ Cancelled invoice:', upd.rows[0]);
    }

    for (const prof of before.profiles) {
      if (prof.is_active !== true) {
        console.log(
          `• Profile ${prof.installmentinvoiceprofiles_id} already inactive — skip`
        );
        continue;
      }
      const upd = await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET is_active = false
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3
           AND is_active = true
         RETURNING installmentinvoiceprofiles_id, is_active, class_id`,
        [prof.installmentinvoiceprofiles_id, STUDENT_ID, REMOVE_CLASS_ID]
      );
      if (!upd.rows.length) {
        throw new Error(
          `Failed to deactivate profile ${prof.installmentinvoiceprofiles_id}`
        );
      }
      console.log('✅ Deactivated profile:', upd.rows[0]);
    }

    await client.query('COMMIT');

    const after = await loadSnapshot();
    console.log('\nAfter — profiles:');
    console.table(after.profiles);
    console.log('After — invoices:');
    console.table(after.invoices);
    console.log('After — classstudents on 166:');
    console.table(
      after.classstudents.length ? after.classstudents : [{ note: '(none)' }]
    );
    console.log(
      `After — KEEP class ${KEEP_CLASS_ID} active rows: ${after.keepEnrollments?.active_rows ?? 0}`
    );
    console.log(
      '\nDone. Refresh Class Students for KG_1-3PM — Andrea should no longer appear as Pending.'
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
