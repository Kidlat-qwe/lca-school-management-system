/**
 * Remove a duplicate / erroneous installment plan for one student.
 *
 * Use case (Ryan Sebastian Quienday): student completed Plan 1 only; Plan 2
 * (duplicate profile + unpaid phase invoice) should not appear in Student history.
 *
 * Removes ONLY the targeted installmentinvoiceprofiles_id and its billing:
 * - program_payment_statustbl (profile + linked invoices)
 * - acknowledgement_receiptstbl (linked to those invoices/payments)
 * - paymenttbl (invoices on this profile only)
 * - installmentinvoicestbl
 * - invoicestudentstbl / invoiceitemstbl
 * - invoicestbl (+ balance/chain siblings)
 * - installmentinvoiceprofilestbl
 *
 * Does NOT delete classstudentstbl rows (same class may be used by the kept plan).
 *
 * Ryan Sebastian Quienday (verified via diagnoseStudentInstallment.js):
 *   user_id: 225
 *   email:   geneveivgeronca@yahoo.com
 *   REMOVE Plan 2 → profile 265, invoice 515 (Unpaid)
 *   KEEP   Plan 1 → profile 282, invoice 539 (Paid)
 *
 * Usage (from backend folder):
 *   node scripts/removeDuplicateInstallmentPlan.js --dry-run
 *   node scripts/removeDuplicateInstallmentPlan.js --apply
 *
 * Options:
 *   --name "Ryan Sebastian Quienday"
 *   --email geneveivgeronca@yahoo.com
 *   --user-id 225
 *   --profile-id 265          profile to remove (Plan 2)
 *   --keep-profile-id 282     safety check — refuse if mismatch
 *   --force                   allow removal even if profile has Paid invoices
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const args = new Set(process.argv.slice(2));
const isDryRun = args.has('--dry-run') || !args.has('--apply');
const isForce = args.has('--force');

function readArg(flag) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(flag);
  if (i === -1 || !argv[i + 1]) return null;
  return argv[i + 1];
}

const lookup = {
  userId: readArg('--user-id') ? parseInt(readArg('--user-id'), 10) : 225,
  email: readArg('--email') || 'geneveivgeronca@yahoo.com',
  name: readArg('--name') || 'Ryan Sebastian Quienday',
};

const REMOVE_PROFILE_ID = readArg('--profile-id')
  ? parseInt(readArg('--profile-id'), 10)
  : 265;
const KEEP_PROFILE_ID = readArg('--keep-profile-id')
  ? parseInt(readArg('--keep-profile-id'), 10)
  : 282;

async function findStudent(client) {
  if (lookup.userId && Number.isFinite(lookup.userId)) {
    const r = await client.query(
      `SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1 AND user_type = 'Student'`,
      [lookup.userId]
    );
    if (r.rows.length) return r.rows[0];
  }
  if (lookup.email) {
    const r = await client.query(
      `SELECT user_id, full_name, email FROM userstbl
       WHERE user_type = 'Student' AND LOWER(TRIM(email)) = LOWER(TRIM($1))`,
      [lookup.email]
    );
    if (r.rows.length) return r.rows[0];
  }
  if (lookup.name) {
    const r = await client.query(
      `SELECT user_id, full_name, email FROM userstbl
       WHERE user_type = 'Student' AND LOWER(full_name) LIKE LOWER($1)
       ORDER BY user_id DESC LIMIT 1`,
      [`%${lookup.name.trim()}%`]
    );
    if (r.rows.length) return r.rows[0];
  }
  return null;
}

async function collectInvoiceIds(client, profileId) {
  const base = await client.query(
    `SELECT invoice_id FROM invoicestbl WHERE installmentinvoiceprofiles_id = $1`,
    [profileId]
  );
  const baseIds = base.rows.map((r) => r.invoice_id);
  if (baseIds.length === 0) return [];

  const chain = await client.query(
    `SELECT DISTINCT i.invoice_id
     FROM invoicestbl i
     WHERE i.invoice_id = ANY($1::int[])
        OR i.invoice_chain_root_id = ANY($1::int[])
        OR i.parent_invoice_id = ANY($1::int[])
        OR i.balance_invoice_id = ANY($1::int[])`,
    [baseIds]
  );
  return chain.rows.map((r) => r.invoice_id);
}

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = await findStudent(client);
    if (!student) {
      throw new Error('Student not found. Adjust --user-id, --email, or --name.');
    }

    const removeProf = await client.query(
      `SELECT ip.*, c.class_name, pkg.package_name
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN classestbl c ON c.class_id = ip.class_id
       LEFT JOIN packagestbl pkg ON pkg.package_id = ip.package_id
       WHERE ip.installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );
    if (removeProf.rows.length === 0) {
      throw new Error(`Profile ${REMOVE_PROFILE_ID} not found.`);
    }
    const removeProfile = removeProf.rows[0];
    if (Number(removeProfile.student_id) !== Number(student.user_id)) {
      throw new Error(
        `Profile ${REMOVE_PROFILE_ID} belongs to student ${removeProfile.student_id}, not ${student.user_id}.`
      );
    }

    const keepProf = await client.query(
      `SELECT installmentinvoiceprofiles_id, student_id, class_id, phase_start, total_phases, generated_count, is_active
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [KEEP_PROFILE_ID]
    );
    if (keepProf.rows.length === 0) {
      throw new Error(`Keep profile ${KEEP_PROFILE_ID} not found — aborting.`);
    }
    if (Number(keepProf.rows[0].student_id) !== Number(student.user_id)) {
      throw new Error(`Keep profile ${KEEP_PROFILE_ID} is not for this student.`);
    }
    if (REMOVE_PROFILE_ID === KEEP_PROFILE_ID) {
      throw new Error('Remove and keep profile IDs must differ.');
    }

    const invoiceIds = await collectInvoiceIds(client, REMOVE_PROFILE_ID);

    const paidCheck = await client.query(
      `SELECT invoice_id, status, amount, invoice_description
       FROM invoicestbl
       WHERE invoice_id = ANY($1::int[])
         AND LOWER(TRIM(COALESCE(status, ''))) = 'paid'`,
      [invoiceIds.length ? invoiceIds : [0]]
    );
    if (paidCheck.rows.length > 0 && !isForce) {
      throw new Error(
        `Profile ${REMOVE_PROFILE_ID} has Paid invoice(s): ${paidCheck.rows
          .map((r) => r.invoice_id)
          .join(', ')}. Use --force if you still want to delete.`
      );
    }

    const schedRows = await client.query(
      `SELECT installmentinvoicedtl_id, status, scheduled_date::text
       FROM installmentinvoicestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );

    console.log('============================================================');
    console.log(isDryRun ? 'DRY RUN — no data will change' : 'APPLY — removing duplicate plan');
    console.log('============================================================');
    console.log(`Student: ${student.full_name} <${student.email}> (user_id=${student.user_id})`);
    console.log(`REMOVE profile ${REMOVE_PROFILE_ID}: ${removeProfile.class_name || '—'} | ${removeProfile.package_name || removeProfile.description || '—'}`);
    console.log(`  phase_start=${removeProfile.phase_start} total_phases=${removeProfile.total_phases} generated_count=${removeProfile.generated_count}`);
    console.log(`KEEP   profile ${KEEP_PROFILE_ID}: phase_start=${keepProf.rows[0].phase_start} total_phases=${keepProf.rows[0].total_phases}`);
    console.log(`Invoices to delete (${invoiceIds.length}): ${invoiceIds.join(', ') || '(none)'}`);
    console.log(`Schedule rows: ${schedRows.rows.length}`);
    schedRows.rows.forEach((r) => {
      console.log(`  - installmentinvoicedtl_id=${r.installmentinvoicedtl_id} status=${r.status} scheduled=${r.scheduled_date}`);
    });
    console.log('------------------------------------------------------------');

    const profileId = REMOVE_PROFILE_ID;
    const invParam = invoiceIds.length ? invoiceIds : [-1];

    // Unlink balance pointers on invoices outside this delete set
    if (!isDryRun && invoiceIds.length) {
      await client.query(
        `UPDATE invoicestbl SET balance_invoice_id = NULL
         WHERE balance_invoice_id = ANY($1::int[])
           AND invoice_id <> ALL($1::int[])`,
        [invoiceIds]
      );
      await client.query(
        `UPDATE invoicestbl SET parent_invoice_id = NULL
         WHERE parent_invoice_id = ANY($1::int[])
           AND invoice_id <> ALL($1::int[])`,
        [invoiceIds]
      );
    }

    let delProgramStatusCount = 0;
    if (isDryRun) {
      const ps = await client.query(
        `SELECT COUNT(*)::int AS count FROM program_payment_statustbl
         WHERE installmentinvoiceprofiles_id = $1 OR invoice_id = ANY($2::int[])`,
        [profileId, invParam]
      );
      delProgramStatusCount = parseInt(ps.rows[0]?.count || 0, 10);
    } else {
      const ps = await client.query(
        `DELETE FROM program_payment_statustbl
         WHERE installmentinvoiceprofiles_id = $1 OR invoice_id = ANY($2::int[])`,
        [profileId, invParam]
      );
      delProgramStatusCount = ps.rowCount || 0;
    }

    let delAck = 0;
    if (isDryRun) {
      const ack = await client.query(
        `SELECT COUNT(*)::int AS count FROM acknowledgement_receiptstbl
         WHERE invoice_id = ANY($1::int[])
            OR payment_id IN (SELECT payment_id FROM paymenttbl WHERE invoice_id = ANY($1::int[]))`,
        [invParam]
      );
      delAck = parseInt(ack.rows[0]?.count || 0, 10);
    } else {
      const ack = await client.query(
        `DELETE FROM acknowledgement_receiptstbl
         WHERE invoice_id = ANY($1::int[])
            OR payment_id IN (SELECT payment_id FROM paymenttbl WHERE invoice_id = ANY($1::int[]))`,
        [invParam]
      );
      delAck = ack.rowCount || 0;
    }

    let delPayments = 0;
    if (isDryRun) {
      const p = await client.query(
        `SELECT COUNT(*)::int AS count FROM paymenttbl WHERE invoice_id = ANY($1::int[])`,
        [invParam]
      );
      delPayments = parseInt(p.rows[0]?.count || 0, 10);
    } else {
      const p = await client.query(`DELETE FROM paymenttbl WHERE invoice_id = ANY($1::int[])`, [invParam]);
      delPayments = p.rowCount || 0;
    }

    let delSched = 0;
    if (isDryRun) {
      const s = await client.query(
        `SELECT COUNT(*)::int AS count FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`,
        [profileId]
      );
      delSched = parseInt(s.rows[0]?.count || 0, 10);
    } else {
      const s = await client.query(
        `DELETE FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`,
        [profileId]
      );
      delSched = s.rowCount || 0;
    }

    let delInvStudents = 0;
    let delInvItems = 0;
    let delInvoices = 0;
    if (invoiceIds.length) {
      if (isDryRun) {
        const a = await client.query(
          `SELECT COUNT(*)::int AS count FROM invoicestudentstbl WHERE invoice_id = ANY($1::int[])`,
          [invParam]
        );
        delInvStudents = parseInt(a.rows[0]?.count || 0, 10);
        const b = await client.query(
          `SELECT COUNT(*)::int AS count FROM invoiceitemstbl WHERE invoice_id = ANY($1::int[])`,
          [invParam]
        );
        delInvItems = parseInt(b.rows[0]?.count || 0, 10);
        const c = await client.query(
          `SELECT COUNT(*)::int AS count FROM invoicestbl WHERE invoice_id = ANY($1::int[])`,
          [invParam]
        );
        delInvoices = parseInt(c.rows[0]?.count || 0, 10);
      } else {
        const a = await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = ANY($1::int[])`, [invParam]);
        delInvStudents = a.rowCount || 0;
        const b = await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = ANY($1::int[])`, [invParam]);
        delInvItems = b.rowCount || 0;
        const c = await client.query(`DELETE FROM invoicestbl WHERE invoice_id = ANY($1::int[])`, [invParam]);
        delInvoices = c.rowCount || 0;
      }
    }

    let delProfile = 0;
    if (isDryRun) {
      delProfile = 1;
    } else {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET downpayment_invoice_id = NULL
         WHERE downpayment_invoice_id = ANY($1::int[])`,
        [invParam]
      );
      const pr = await client.query(
        `DELETE FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [profileId]
      );
      delProfile = pr.rowCount || 0;
    }

    console.log(`program_payment_statustbl: ${delProgramStatusCount}`);
    console.log(`acknowledgement_receiptstbl: ${delAck}`);
    console.log(`paymenttbl: ${delPayments}`);
    console.log(`installmentinvoicestbl: ${delSched}`);
    console.log(`invoicestudentstbl: ${delInvStudents}`);
    console.log(`invoiceitemstbl: ${delInvItems}`);
    console.log(`invoicestbl: ${delInvoices}`);
    console.log(`installmentinvoiceprofilestbl: ${delProfile}`);
    console.log('classstudentstbl: 0 (not modified — kept plan enrollment preserved)');

    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('============================================================');
      console.log('Dry run complete. Re-run with --apply to execute.');
      console.log('============================================================');
    } else {
      await client.query('COMMIT');
      console.log('============================================================');
      console.log('Done. Refresh Student history → Invoices for this student.');
      console.log('============================================================');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
