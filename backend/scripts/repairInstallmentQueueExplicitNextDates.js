/**
 * Set installmentinvoicestbl.next_generation_date and next_invoice_month for one queue row.
 * The Finance "Generate invoice" modal builds current/next issue-due-month from next_generation_date
 * (25th anchor + 1 month(s) frequency), and the list shows these two columns from the same row.
 *
 * Usage (from backend directory):
 *   node scripts/repairInstallmentQueueExplicitNextDates.js \
 *     --profile-id=323 \
 *     --next-generation-date=2026-07-25 \
 *     --next-invoice-month=2026-08-01
 *
 * Or resolve by student + class (must match exactly one active profile + one open queue row):
 *   node scripts/repairInstallmentQueueExplicitNextDates.js \
 *     --student-name="Princess Morianne" \
 *     --class-name="VMM_Nursery_MWF" \
 *     --next-generation-date=2026-07-25 \
 *     --next-invoice-month=2026-08-01
 *
 *   node scripts/repairInstallmentQueueExplicitNextDates.js ... --apply
 *
 * If several open rows exist for the same profile, the script updates the latest
 * (highest installmentinvoicedtl_id) and warns. To pick one row explicitly:
 *   --installmentinvoicedtl-id=316
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const APPLY = process.argv.includes('--apply');

const getArg = (prefix) => {
  const m = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return m ? m.slice(prefix.length + 1).trim() : null;
};

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function main() {
  const profileIdRaw = getArg('--profile-id');
  const studentName = getArg('--student-name');
  const className = getArg('--class-name');
  const dtlIdRaw = getArg('--installmentinvoicedtl-id');
  const nextGen = getArg('--next-generation-date');
  const nextMonth = getArg('--next-invoice-month');

  if (!isYmd(nextGen) || !isYmd(nextMonth)) {
    console.error('Required: --next-generation-date=YYYY-MM-DD and --next-invoice-month=YYYY-MM-DD');
    process.exit(1);
  }

  const dtlId =
    dtlIdRaw != null && String(dtlIdRaw).trim() !== ''
      ? parseInt(String(dtlIdRaw).trim(), 10)
      : null;
  if (dtlIdRaw != null && String(dtlIdRaw).trim() !== '' && (!Number.isInteger(dtlId) || dtlId <= 0)) {
    console.error('Invalid --installmentinvoicedtl-id');
    process.exit(1);
  }

  const hasProfile = profileIdRaw != null && String(profileIdRaw).trim() !== '';
  const hasStudentClass =
    studentName != null &&
    String(studentName).trim() !== '' &&
    className != null &&
    String(className).trim() !== '';

  if (dtlId == null && hasProfile === hasStudentClass) {
    console.error(
      'Provide exactly one of: --profile-id=N OR both --student-name=... and --class-name=... (or use --installmentinvoicedtl-id=N alone)'
    );
    process.exit(1);
  }

  const client = await getClient();
  try {
    let rows;
    if (dtlId != null) {
      rows = await client.query(
        `SELECT ii.installmentinvoicedtl_id,
                ii.installmentinvoiceprofiles_id,
                ii.next_generation_date::text AS next_generation_date,
                ii.next_invoice_month::text AS next_invoice_month,
                ii.status,
                u.full_name AS student_name,
                c.class_name
         FROM installmentinvoicestbl ii
         INNER JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = ii.installmentinvoiceprofiles_id
         LEFT JOIN userstbl u ON u.user_id = ip.student_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ii.installmentinvoicedtl_id = $1
           AND (ii.status IS NULL OR ii.status = '' OR ii.status = 'Pending')`,
        [dtlId]
      );
      if (rows.rows.length === 1 && hasProfile) {
        const pid = parseInt(String(profileIdRaw).trim(), 10);
        if (Number(rows.rows[0].installmentinvoiceprofiles_id) !== pid) {
          console.error(
            `Row ${dtlId} belongs to profile ${rows.rows[0].installmentinvoiceprofiles_id}, not ${pid}. Remove --profile-id or fix the id.`
          );
          process.exit(1);
        }
      }
    } else if (hasProfile) {
      const pid = parseInt(String(profileIdRaw).trim(), 10);
      if (!Number.isInteger(pid) || pid <= 0) {
        console.error('Invalid --profile-id');
        process.exit(1);
      }
      rows = await client.query(
        `SELECT ii.installmentinvoicedtl_id,
                ii.installmentinvoiceprofiles_id,
                ii.next_generation_date::text AS next_generation_date,
                ii.next_invoice_month::text AS next_invoice_month,
                ii.status,
                u.full_name AS student_name,
                c.class_name
         FROM installmentinvoicestbl ii
         INNER JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = ii.installmentinvoiceprofiles_id
         LEFT JOIN userstbl u ON u.user_id = ip.student_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ii.installmentinvoiceprofiles_id = $1
           AND (ii.status IS NULL OR ii.status = '' OR ii.status = 'Pending')
         ORDER BY ii.installmentinvoicedtl_id DESC`,
        [pid]
      );
    } else {
      rows = await client.query(
        `SELECT ii.installmentinvoicedtl_id,
                ii.installmentinvoiceprofiles_id,
                ii.next_generation_date::text AS next_generation_date,
                ii.next_invoice_month::text AS next_invoice_month,
                ii.status,
                u.full_name AS student_name,
                c.class_name
         FROM installmentinvoicestbl ii
         INNER JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = ii.installmentinvoiceprofiles_id
         LEFT JOIN userstbl u ON u.user_id = ip.student_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.is_active = true
           AND (ii.status IS NULL OR ii.status = '' OR ii.status = 'Pending')
           AND u.full_name ILIKE $1
           AND c.class_name ILIKE $2
         ORDER BY ii.installmentinvoicedtl_id DESC`,
        [`%${studentName.trim()}%`, `%${className.trim()}%`]
      );
    }

    if (rows.rows.length === 0) {
      console.error('No matching open installment queue row found.');
      process.exit(1);
    }

    if (dtlId != null && rows.rows.length !== 1) {
      console.error(
        `No open queue row with installmentinvoicedtl_id=${dtlId} (row missing or status is not open/Pending).`
      );
      process.exit(1);
    }

    if (rows.rows.length > 1) {
      console.warn(
        `\n${rows.rows.length} open queue row(s) matched; using the latest installmentinvoicedtl_id=${rows.rows[0].installmentinvoicedtl_id}. ` +
          `To update a different row, pass --installmentinvoicedtl-id=...\n`
      );
      console.table(
        rows.rows.map((r) => ({
          installmentinvoicedtl_id: r.installmentinvoicedtl_id,
          profile_id: r.installmentinvoiceprofiles_id,
          student_name: r.student_name,
          class_name: r.class_name,
          status: r.status,
        }))
      );
    }

    const row = rows.rows[0];
    const fromG = String(row.next_generation_date || '').slice(0, 10);
    const fromM = String(row.next_invoice_month || '').slice(0, 10);

    console.log('Target row:');
    console.log({
      installmentinvoicedtl_id: row.installmentinvoicedtl_id,
      installmentinvoiceprofiles_id: row.installmentinvoiceprofiles_id,
      student_name: row.student_name,
      class_name: row.class_name,
      status: row.status,
      next_generation_date: `${fromG} → ${nextGen}`,
      next_invoice_month: `${fromM} → ${nextMonth}`,
    });

    if (fromG === nextGen && fromM === nextMonth) {
      console.log('Already at requested values. Nothing to do.');
      process.exit(0);
    }

    if (!APPLY) {
      console.log('\nDry run only. Re-run with --apply to UPDATE installmentinvoicestbl.');
      process.exit(0);
    }

    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date
       WHERE installmentinvoicedtl_id = $3`,
      [nextGen, nextMonth, row.installmentinvoicedtl_id]
    );
    console.log('\nCommitted: installment queue row updated.');
  } finally {
    client.release();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
