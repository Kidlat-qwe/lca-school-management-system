/**
 * Diagnose installment profile vs installment invoice schedule rows for one student.
 * Use when Invoice shows Phase/installment text but Installment Invoice page has no rows.
 *
 * Requires backend/.env (or .env.production per loadEnv) with DB_* credentials.
 *
 * Usage (from repo root):
 *   cd backend && node scripts/diagnoseStudentInstallment.js --user-id 12345
 *   cd backend && node scripts/diagnoseStudentInstallment.js --email student@example.com
 *   cd backend && node scripts/diagnoseStudentInstallment.js --name "Penelope"
 *   cd backend && node scripts/diagnoseStudentInstallment.js --name Cudia --json
 */

import '../config/loadEnv.js';
import pool from '../config/database.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let userId = null;
  let email = null;
  let name = null;
  let asJson = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') asJson = true;
    else if (a === '--user-id' && argv[i + 1]) userId = parseInt(argv[++i], 10);
    else if (a === '--email' && argv[i + 1]) email = String(argv[++i]).trim();
    else if (a === '--name' && argv[i + 1]) name = String(argv[++i]).trim();
    else if (a === '--help' || a === '-h') {
      console.log(`
Usage: node scripts/diagnoseStudentInstallment.js [options]

Exactly one lookup is required:

  --user-id <id>     userstbl.user_id
  --email <email>    Exact match on userstbl.email (case-insensitive trim)
  --name <text>      ILIKE %%text%% on userstbl.full_name (if multiple matches, lists all)

  --json             Print JSON only (for piping)

Reads database from backend/.env (same as the API).
`);
      process.exit(0);
    }
  }

  const modes = [userId != null && !Number.isNaN(userId), !!email, !!name].filter(Boolean);
  if (modes.length !== 1) {
    console.error('Provide exactly one of: --user-id, --email, or --name');
    process.exit(1);
  }

  return { userId, email, name, asJson };
}

async function findStudents({ userId, email, name }) {
  if (userId != null && !Number.isNaN(userId)) {
    const r = await pool.query(
      `SELECT user_id, full_name, email, branch_id, level_tag, user_type
       FROM userstbl WHERE user_id = $1`,
      [userId]
    );
    return r.rows;
  }
  if (email) {
    const r = await pool.query(
      `SELECT user_id, full_name, email, branch_id, level_tag, user_type
       FROM userstbl WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`,
      [email]
    );
    return r.rows;
  }
  if (name) {
    const r = await pool.query(
      `SELECT user_id, full_name, email, branch_id, level_tag, user_type
       FROM userstbl
       WHERE LOWER(full_name) LIKE LOWER($1)
       ORDER BY user_id DESC
       LIMIT 20`,
      [`%${name}%`]
    );
    return r.rows;
  }
  return [];
}

async function branchLabel(branchId) {
  if (branchId == null) return null;
  const r = await pool.query(
    `SELECT COALESCE(branch_nickname, branch_name) AS nm FROM branchestbl WHERE branch_id = $1`,
    [branchId]
  );
  return r.rows[0]?.nm || String(branchId);
}

async function runForUserId(sid, asJson) {
  const out = {
    student: null,
    profiles: [],
    installmentScheduleRows: [],
    linkedInvoices: [],
    notes: [],
  };

  const u = await pool.query(
    `SELECT user_id, full_name, email, branch_id, level_tag, user_type FROM userstbl WHERE user_id = $1`,
    [sid]
  );
  if (u.rows.length === 0) {
    out.notes.push('Student user_id not found.');
    return out;
  }

  const st = u.rows[0];
  out.student = {
    ...st,
    branch_name: await branchLabel(st.branch_id),
  };

  const profiles = await pool.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.branch_id, ip.package_id, ip.class_id,
            ip.amount, ip.frequency, ip.is_active, ip.phase_start, ip.total_phases, ip.generated_count,
            ip.downpayment_paid, ip.downpayment_invoice_id, ip.description,
            pkg.package_name, pkg.package_type, pkg.level_tag AS package_level_tag
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN packagestbl pkg ON pkg.package_id = ip.package_id
     WHERE ip.student_id = $1
     ORDER BY ip.installmentinvoiceprofiles_id DESC`,
    [sid]
  );

  out.profiles = await Promise.all(
    (profiles.rows || []).map(async (p) => ({
      ...p,
      profile_branch_name: await branchLabel(p.branch_id),
    }))
  );

  const pids = out.profiles.map((p) => p.installmentinvoiceprofiles_id);
  if (pids.length === 0) {
    out.notes.push('No rows in installmentinvoiceprofilestbl for this student.');
    return out;
  }

  const sched = await pool.query(
    `SELECT ii.installmentinvoicedtl_id, ii.installmentinvoiceprofiles_id, ii.scheduled_date, ii.status,
            ii.student_name, ii.next_generation_date, ii.next_invoice_month, ii.frequency
     FROM installmentinvoicestbl ii
     WHERE ii.installmentinvoiceprofiles_id = ANY($1::int[])
     ORDER BY ii.installmentinvoiceprofiles_id DESC, ii.installmentinvoicedtl_id DESC`,
    [pids]
  );
  out.installmentScheduleRows = sched.rows || [];

  const inv = await pool.query(
    `SELECT i.invoice_id, i.branch_id, i.installmentinvoiceprofiles_id, i.status, i.amount,
            i.invoice_description, TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
            i.invoice_ar_number
     FROM invoicestbl i
     WHERE i.installmentinvoiceprofiles_id = ANY($1::int[])
     ORDER BY i.invoice_id DESC`,
    [pids]
  );
  out.linkedInvoices = inv.rows || [];

  // Diagnosis
  const hasDownpaymentId = out.profiles.some((p) => p.downpayment_invoice_id != null);
  const downpaymentPaid = out.profiles.some((p) => p.downpayment_paid === true);
  const scheduleCount = out.installmentScheduleRows.length;

  if (scheduleCount === 0) {
    out.notes.push(
      'No rows in installmentinvoicestbl — the Installment Invoice page lists this table. ' +
        'Typical causes: (1) package had a downpayment and it is not paid / payment did not trigger schedule creation; ' +
        '(2) enrollment created the profile but failed to insert the first schedule row; ' +
        '(3) non-phase profile error was swallowed during enrollment.'
    );
    if (hasDownpaymentId && !downpaymentPaid) {
      out.notes.push('Profile has downpayment_invoice_id but downpayment_paid is false — pay/complete the downpayment invoice first.');
    }
  } else {
    out.notes.push(`Found ${scheduleCount} installment schedule row(s) — student should appear on Installment Invoice (subject to branch filter).`);
  }

  const pidBranches = new Set(out.profiles.map((p) => p.branch_id).filter((b) => b != null));
  if (pidBranches.size > 1) {
    out.notes.push('Multiple profiles use different branch_id values — Finance users only see their own branch.');
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  console.log('\n=== Student ===');
  console.log(JSON.stringify(out.student, null, 2));

  console.log('\n=== Installment profiles (installmentinvoiceprofilestbl) ===');
  console.table(
    out.profiles.map((p) => ({
      installmentinvoiceprofiles_id: p.installmentinvoiceprofiles_id,
      branch_id: p.branch_id,
      profile_branch_name: p.profile_branch_name,
      package_id: p.package_id,
      package_name: p.package_name,
      package_type: p.package_type,
      class_id: p.class_id,
      phase_start: p.phase_start,
      total_phases: p.total_phases,
      generated_count: p.generated_count,
      downpayment_paid: p.downpayment_paid,
      downpayment_invoice_id: p.downpayment_invoice_id,
      is_active: p.is_active,
    }))
  );

  console.log('\n=== Installment schedule rows (installmentinvoicestbl) — drives Finance list ===');
  if (out.installmentScheduleRows.length === 0) {
    console.log('(none)');
  } else {
    console.table(
      out.installmentScheduleRows.map((r) => ({
        installmentinvoicedtl_id: r.installmentinvoicedtl_id,
        installmentinvoiceprofiles_id: r.installmentinvoiceprofiles_id,
        scheduled_date: r.scheduled_date,
        status: r.status,
        next_generation_date: r.next_generation_date,
      }))
    );
  }

  console.log('\n=== Invoices linked to profile (invoicestbl.installmentinvoiceprofiles_id) ===');
  if (out.linkedInvoices.length === 0) {
    console.log('(none)');
  } else {
    console.table(
      out.linkedInvoices.map((i) => ({
        invoice_id: i.invoice_id,
        installmentinvoiceprofiles_id: i.installmentinvoiceprofiles_id,
        branch_id: i.branch_id,
        status: i.status,
        amount: i.amount,
        issue_date: i.issue_date,
      }))
    );
  }

  console.log('\n=== Notes ===');
  out.notes.forEach((n) => console.log(`- ${n}`));

  return out;
}

async function main() {
  const { userId, email, name, asJson } = parseArgs();

  try {
    const students = await findStudents({ userId, email, name });
    if (students.length === 0) {
      console.error('No matching student.');
      process.exit(2);
    }
    if (students.length > 1 && name) {
      if (!asJson) {
        console.error(`Multiple matches (${students.length}). Refine --name or use --user-id:\n`);
        students.forEach((s) => console.error(`  user_id=${s.user_id}  ${s.full_name}  <${s.email}>`));
      } else {
        console.log(JSON.stringify({ error: 'multiple_matches', students }, null, 2));
      }
      process.exit(3);
    }

    const sid = students[0].user_id;
    await runForUserId(sid, asJson);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
