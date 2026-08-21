/**
 * Repair wrong student name on Psalm-David E. Awoyemi installment descriptions.
 *
 * Receipt No. 261955 (INV-2290, Cavite) shows:
 *   "Installment plan for Psalm Daniel Awoyemi - Nursery"
 * Correct student (user_id 610):
 *   "Psalm-David E. Awoyemi"
 *
 * Updates:
 *   - installmentinvoiceprofilestbl.description (profile 427 — source for future phases)
 *   - invoiceitemstbl.description (line items that drive AR/PDF DESCRIPTION)
 *   - invoicestbl.invoice_description / remarks (legacy copies of the wrong name)
 *
 * Run (dry-run default):
 *   node backend/scripts/repairPsalmDavidAwoyemiInstallmentDescription.js
 *   node backend/scripts/repairPsalmDavidAwoyemiInstallmentDescription.js --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const STUDENT_USER_ID = 610;
const STUDENT_EMAIL = 'lindauwagbale@yahoo.com';
const EXPECTED_FULL_NAME = 'Psalm-David E. Awoyemi';
const WRONG_NAME = 'Psalm Daniel Awoyemi';
const CORRECT_NAME = 'Psalm-David E. Awoyemi';
const PROFILE_ID = 427;
const TARGET_AR_NUMBER = '261955';
const TARGET_INVOICE_ID = 2290;
const REPAIR_NOTE =
  'Ops repair 2026-08-21 — fix installment description name Psalm Daniel → Psalm-David E. Awoyemi (AR 261955)';

const isApply = process.argv.includes('--apply');

function replaceWrongName(text) {
  if (text == null) return text;
  const s = String(text);
  if (!s.includes(WRONG_NAME)) return s;
  return s.split(WRONG_NAME).join(CORRECT_NAME);
}

async function main() {
  console.log(
    `\nRepair Psalm-David E. Awoyemi installment description` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production (current .env target).');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE user_id = $1`,
        [STUDENT_USER_ID]
      )
    ).rows[0];

    if (!student) {
      throw new Error(`Student user_id ${STUDENT_USER_ID} not found`);
    }
    if (String(student.email || '').toLowerCase() !== STUDENT_EMAIL.toLowerCase()) {
      throw new Error(
        `Email mismatch for user_id ${STUDENT_USER_ID}: got ${student.email}, expected ${STUDENT_EMAIL}`
      );
    }
    if (String(student.full_name || '').trim() !== EXPECTED_FULL_NAME) {
      throw new Error(
        `Full name mismatch for user_id ${STUDENT_USER_ID}: got "${student.full_name}", expected "${EXPECTED_FULL_NAME}"`
      );
    }
    console.log(`Student OK: ${student.full_name} <${student.email}> (user_id ${student.user_id})`);

    const profile = (
      await client.query(
        `SELECT installmentinvoiceprofiles_id, student_id, description, generated_count, is_active
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    if (!profile) {
      throw new Error(`Installment profile ${PROFILE_ID} not found`);
    }
    if (Number(profile.student_id) !== STUDENT_USER_ID) {
      throw new Error(
        `Profile ${PROFILE_ID} student_id=${profile.student_id}, expected ${STUDENT_USER_ID}`
      );
    }
    console.log(`\nProfile ${PROFILE_ID}:`);
    console.log(`  before: ${profile.description}`);
    console.log(`  after:  ${replaceWrongName(profile.description)}`);

    const targetInv = (
      await client.query(
        `SELECT invoice_id, invoice_ar_number, invoice_description, remarks,
                installmentinvoiceprofiles_id, status
         FROM invoicestbl
         WHERE invoice_id = $1 OR invoice_ar_number = $2`,
        [TARGET_INVOICE_ID, TARGET_AR_NUMBER]
      )
    ).rows[0];

    if (!targetInv) {
      throw new Error(`Target invoice AR ${TARGET_AR_NUMBER} / INV-${TARGET_INVOICE_ID} not found`);
    }
    if (Number(targetInv.invoice_id) !== TARGET_INVOICE_ID) {
      throw new Error(
        `AR ${TARGET_AR_NUMBER} maps to INV-${targetInv.invoice_id}, expected INV-${TARGET_INVOICE_ID}`
      );
    }
    if (Number(targetInv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
      throw new Error(
        `INV-${TARGET_INVOICE_ID} profile=${targetInv.installmentinvoiceprofiles_id}, expected ${PROFILE_ID}`
      );
    }
    console.log(
      `\nTarget receipt AR ${targetInv.invoice_ar_number} = INV-${targetInv.invoice_id} (${targetInv.status})`
    );

    const invoices = (
      await client.query(
        `SELECT invoice_id, invoice_ar_number, invoice_description, remarks, status
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
            OR invoice_description ILIKE '%' || $2 || '%'
            OR remarks ILIKE '%' || $2 || '%'
         ORDER BY invoice_id`,
        [PROFILE_ID, WRONG_NAME]
      )
    ).rows;

    const invoiceIds = invoices.map((r) => r.invoice_id);
    const items = (
      await client.query(
        `SELECT invoice_item_id, invoice_id, description, amount
         FROM invoiceitemstbl
         WHERE invoice_id = ANY($1::int[])
            OR description ILIKE '%' || $2 || '%'
         ORDER BY invoice_id, invoice_item_id`,
        [invoiceIds.length ? invoiceIds : [0], WRONG_NAME]
      )
    ).rows;

    const profileNeedsUpdate = String(profile.description || '').includes(WRONG_NAME);
    const invoiceUpdates = invoices
      .map((inv) => {
        const nextDesc = replaceWrongName(inv.invoice_description);
        const nextRemarks = replaceWrongName(inv.remarks);
        const changed =
          nextDesc !== inv.invoice_description || nextRemarks !== inv.remarks;
        return changed
          ? {
              invoice_id: inv.invoice_id,
              ar: inv.invoice_ar_number,
              before_desc: inv.invoice_description,
              after_desc: nextDesc,
              before_remarks: inv.remarks,
              after_remarks: nextRemarks,
            }
          : null;
      })
      .filter(Boolean);

    const itemUpdates = items
      .map((item) => {
        const next = replaceWrongName(item.description);
        return next !== item.description
          ? {
              invoice_item_id: item.invoice_item_id,
              invoice_id: item.invoice_id,
              before: item.description,
              after: next,
              amount: item.amount,
            }
          : null;
      })
      .filter(Boolean);

    console.log(`\nPlanned updates:`);
    console.log(`  profile description: ${profileNeedsUpdate ? 1 : 0}`);
    console.log(`  invoices (desc/remarks): ${invoiceUpdates.length}`);
    console.log(`  invoice items (description): ${itemUpdates.length}`);

    if (itemUpdates.length) {
      console.log('\nInvoice items:');
      for (const u of itemUpdates) {
        console.log(
          `  item ${u.invoice_item_id} (INV-${u.invoice_id}):\n    ${u.before}\n -> ${u.after}`
        );
      }
    }
    if (invoiceUpdates.length) {
      console.log('\nInvoices:');
      for (const u of invoiceUpdates) {
        if (u.before_desc !== u.after_desc) {
          console.log(`  INV-${u.invoice_id} (${u.ar}) description:\n    ${u.before_desc}\n -> ${u.after_desc}`);
        }
        if (u.before_remarks !== u.after_remarks) {
          console.log(`  INV-${u.invoice_id} (${u.ar}) remarks:\n    ${u.before_remarks}\n -> ${u.after_remarks}`);
        }
      }
    }

    if (!profileNeedsUpdate && !invoiceUpdates.length && !itemUpdates.length) {
      console.log('\nNothing to update (already corrected).');
      await client.query('ROLLBACK');
      return;
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to write changes.');
      await client.query('ROLLBACK');
      return;
    }

    if (profileNeedsUpdate) {
      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET description = $1
         WHERE installmentinvoiceprofiles_id = $2
           AND student_id = $3`,
        [replaceWrongName(profile.description), PROFILE_ID, STUDENT_USER_ID]
      );
    }

    for (const u of invoiceUpdates) {
      await client.query(
        `UPDATE invoicestbl
         SET invoice_description = $1,
             remarks = $2
         WHERE invoice_id = $3`,
        [u.after_desc, u.after_remarks, u.invoice_id]
      );
    }

    for (const u of itemUpdates) {
      await client.query(
        `UPDATE invoiceitemstbl
         SET description = $1
         WHERE invoice_item_id = $2
           AND invoice_id = $3`,
        [u.after, u.invoice_item_id, u.invoice_id]
      );
    }

    const verifyItem = (
      await client.query(
        `SELECT description FROM invoiceitemstbl
         WHERE invoice_id = $1
         ORDER BY invoice_item_id
         LIMIT 1`,
        [TARGET_INVOICE_ID]
      )
    ).rows[0];
    const verifyProfile = (
      await client.query(
        `SELECT description FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];

    if (!String(verifyItem?.description || '').includes(CORRECT_NAME)) {
      throw new Error(
        `Post-apply check failed: INV-${TARGET_INVOICE_ID} item still "${verifyItem?.description}"`
      );
    }
    if (!String(verifyProfile?.description || '').includes(CORRECT_NAME)) {
      throw new Error(
        `Post-apply check failed: profile ${PROFILE_ID} still "${verifyProfile?.description}"`
      );
    }
    if (String(verifyItem?.description || '').includes(WRONG_NAME)) {
      throw new Error('Post-apply check failed: wrong name still present on target item');
    }

    await client.query('COMMIT');
    console.log('\nApplied successfully.');
    console.log(`  Profile ${PROFILE_ID}: ${verifyProfile.description}`);
    console.log(`  INV-${TARGET_INVOICE_ID} (AR ${TARGET_AR_NUMBER}) item: ${verifyItem.description}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('\nFAILED:', err.message || err);
  process.exit(1);
});
