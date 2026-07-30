/**
 * Matthaias Sabino De Chavez (Playgroup) —
 * remove duplicate Plan 1 (profile 279, Old Rate No DP) and keep Plan 2 (profile 281).
 *
 * Student history Plan 1 shows broken unpaid phases (INV 1929/2248/2335/2351).
 * Plan 2 has paid phases 1–4 + unpaid phase 5 (INV 2174) — keep that plan.
 *
 * Email: sabinomira000@gmail.com · user_id 147 · class VMM_Playgroup_SS_11:00-12:00PM
 *
 * Run (from backend/):
 *   node scripts/repairMatthaiasDeChavezRemovePlan1.js
 *   node scripts/repairMatthaiasDeChavezRemovePlan1.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_EMAIL = 'sabinomira000@gmail.com';
const STUDENT_ID = 147;
const REMOVE_PROFILE_ID = 279; // Plan 1 — Phase 1-8_Old Rate No DP
const KEEP_PROFILE_ID = 281; // Plan 2 — Phase 1-8_ Plan 1 No DP

const isApply = process.argv.includes('--apply');

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
  console.log(
    `\nMatthaias De Chavez — remove Plan 1 / keep Plan 2${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email FROM userstbl
         WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
        [STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student || Number(student.user_id) !== STUDENT_ID) {
      throw new Error(`Student ${STUDENT_EMAIL} (id ${STUDENT_ID}) not found`);
    }

    const removeProf = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.is_active,
                ip.generated_count, ip.total_phases, ip.phase_start,
                pkg.package_name, c.class_name
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN packagestbl pkg ON pkg.package_id = ip.package_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [REMOVE_PROFILE_ID]
      )
    ).rows[0];
    if (!removeProf || Number(removeProf.student_id) !== STUDENT_ID) {
      throw new Error(`Remove profile ${REMOVE_PROFILE_ID} not found for student`);
    }

    const keepProf = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.is_active,
                ip.generated_count, ip.total_phases, ip.phase_start,
                pkg.package_name, c.class_name
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN packagestbl pkg ON pkg.package_id = ip.package_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [KEEP_PROFILE_ID]
      )
    ).rows[0];
    if (!keepProf || Number(keepProf.student_id) !== STUDENT_ID) {
      throw new Error(`Keep profile ${KEEP_PROFILE_ID} not found for student`);
    }

    const invoiceIds = await collectInvoiceIds(client, REMOVE_PROFILE_ID);
    const invParam = invoiceIds.length ? invoiceIds : [-1];

    const paidOnRemove = (
      await client.query(
        `SELECT invoice_id, status, invoice_ar_number
         FROM invoicestbl
         WHERE invoice_id = ANY($1::int[])
           AND LOWER(TRIM(COALESCE(status, ''))) = 'paid'`,
        [invParam]
      )
    ).rows;
    if (paidOnRemove.length) {
      throw new Error(
        `Refuse to delete Plan 1: Paid invoices on profile ${REMOVE_PROFILE_ID}: ${paidOnRemove
          .map((r) => r.invoice_id)
          .join(', ')}`
      );
    }

    const removeInvoices = (
      await client.query(
        `SELECT invoice_id, status, invoice_ar_number,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
                amount::text AS amount
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY invoice_id`,
        [REMOVE_PROFILE_ID]
      )
    ).rows;

    const keepInvoices = (
      await client.query(
        `SELECT invoice_id, status, invoice_ar_number,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
                amount::text AS amount
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY invoice_id`,
        [KEEP_PROFILE_ID]
      )
    ).rows;

    console.log('Student:', student.full_name, student.email);
    console.log('\nREMOVE Plan 1 profile', REMOVE_PROFILE_ID, {
      package: removeProf.package_name,
      class: removeProf.class_name,
      generated_count: removeProf.generated_count,
      is_active: removeProf.is_active,
    });
    console.table(removeInvoices);

    console.log('\nKEEP Plan 2 profile', KEEP_PROFILE_ID, {
      package: keepProf.package_name,
      class: keepProf.class_name,
      generated_count: keepProf.generated_count,
      is_active: keepProf.is_active,
    });
    console.table(keepInvoices);

    const counts = {};
    const countOrDelete = async (key, drySql, applySql, params) => {
      if (!isApply) {
        const r = await client.query(drySql, params);
        counts[key] = Number(r.rows[0]?.count || 0);
      } else {
        const r = await client.query(applySql, params);
        counts[key] = r.rowCount || 0;
      }
    };

    if (isApply && invoiceIds.length) {
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

    await countOrDelete(
      'program_payment_statustbl',
      `SELECT COUNT(*)::int AS count FROM program_payment_statustbl
       WHERE installmentinvoiceprofiles_id = $1 OR invoice_id = ANY($2::int[])`,
      `DELETE FROM program_payment_statustbl
       WHERE installmentinvoiceprofiles_id = $1 OR invoice_id = ANY($2::int[])`,
      [REMOVE_PROFILE_ID, invParam]
    );

    await countOrDelete(
      'acknowledgement_receiptstbl',
      `SELECT COUNT(*)::int AS count FROM acknowledgement_receiptstbl
       WHERE invoice_id = ANY($1::int[])
          OR payment_id IN (SELECT payment_id FROM paymenttbl WHERE invoice_id = ANY($1::int[]))`,
      `DELETE FROM acknowledgement_receiptstbl
       WHERE invoice_id = ANY($1::int[])
          OR payment_id IN (SELECT payment_id FROM paymenttbl WHERE invoice_id = ANY($1::int[]))`,
      [invParam]
    );

    await countOrDelete(
      'paymenttbl',
      `SELECT COUNT(*)::int AS count FROM paymenttbl WHERE invoice_id = ANY($1::int[])`,
      `DELETE FROM paymenttbl WHERE invoice_id = ANY($1::int[])`,
      [invParam]
    );

    await countOrDelete(
      'installmentinvoicestbl',
      `SELECT COUNT(*)::int AS count FROM installmentinvoicestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      `DELETE FROM installmentinvoicestbl WHERE installmentinvoiceprofiles_id = $1`,
      [REMOVE_PROFILE_ID]
    );

    await countOrDelete(
      'invoicestudentstbl',
      `SELECT COUNT(*)::int AS count FROM invoicestudentstbl WHERE invoice_id = ANY($1::int[])`,
      `DELETE FROM invoicestudentstbl WHERE invoice_id = ANY($1::int[])`,
      [invParam]
    );

    await countOrDelete(
      'invoiceitemstbl',
      `SELECT COUNT(*)::int AS count FROM invoiceitemstbl WHERE invoice_id = ANY($1::int[])`,
      `DELETE FROM invoiceitemstbl WHERE invoice_id = ANY($1::int[])`,
      [invParam]
    );

    await countOrDelete(
      'invoicestbl',
      `SELECT COUNT(*)::int AS count FROM invoicestbl WHERE invoice_id = ANY($1::int[])`,
      `DELETE FROM invoicestbl WHERE invoice_id = ANY($1::int[])`,
      [invParam]
    );

    if (isApply) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl SET downpayment_invoice_id = NULL
         WHERE downpayment_invoice_id = ANY($1::int[])`,
        [invParam]
      );
      const pr = await client.query(
        `DELETE FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [REMOVE_PROFILE_ID]
      );
      counts.installmentinvoiceprofilestbl = pr.rowCount || 0;

      // Ensure kept plan stays active for generation
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET is_active = true
         WHERE installmentinvoiceprofiles_id = $1`,
        [KEEP_PROFILE_ID]
      );
    } else {
      counts.installmentinvoiceprofilestbl = 1;
    }

    console.log('\nPlanned delete counts:');
    console.table([counts]);
    console.log('classstudentstbl: 0 (not modified — Plan 2 enrollment preserved)');
    console.log(
      `Invoices to remove: ${invoiceIds.join(', ') || '(none)'} (all unpaid on Plan 1)`
    );

    if (!isApply) {
      await client.query('ROLLBACK');
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    await client.query('COMMIT');

    const remaining = await client.query(
      `SELECT ip.installmentinvoiceprofiles_id AS pid, ip.is_active, ip.generated_count,
              pkg.package_name
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN packagestbl pkg ON pkg.package_id = ip.package_id
       WHERE ip.student_id = $1
       ORDER BY ip.installmentinvoiceprofiles_id`,
      [STUDENT_ID]
    );
    console.log('\nRemaining profiles:');
    console.table(remaining.rows);
    console.log('Done. Refresh Student history → Invoices for this student.');
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
