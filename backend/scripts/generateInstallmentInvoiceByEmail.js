/**
 * Generate the next installment invoice for target student(s) by email.
 *
 * Intended for Coolify / local AutoPay MIT UAT:
 *   1) Make the installment queue due today (optional)
 *   2) Generate the next installment invoice
 *   3) Run the same AutoPay MIT hook as the daily generator
 *
 * Edit TARGET_STUDENT_EMAILS below (same pattern as hardDeleteStudentsFromClassesAndBilling.js).
 *
 * Run:
 *   node backend/scripts/generateInstallmentInvoiceByEmail.js
 *   node backend/scripts/generateInstallmentInvoiceByEmail.js --generate
 *   node backend/scripts/generateInstallmentInvoiceByEmail.js --force-due --generate
 *   node backend/scripts/generateInstallmentInvoiceByEmail.js --force-due --generate --profile-id=123
 *
 * Flags:
 *   (default)     Preview only — no writes
 *   --generate    Create the next installment invoice
 *   --force-due   Set next_generation_date to today (Manila) so generation is allowed
 *   --profile-id= ID of installmentinvoiceprofiles_id when the student has multiple plans
 *   --mit-invoice-id=<id>  Retry AutoPay MIT only for an existing unpaid invoice (no generate)
 *   --skip-mit    Generate invoice but skip AutoPay MIT attempt
 *   --skip-email  Skip monthly invoice notice email
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { todayYmdManila, coerceToManilaYmd } from '../utils/dateUtils.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';

const TARGET_STUDENT_EMAILS = [
  'it.kier@little-champion.com',
];

const args = process.argv.slice(2);
const doGenerate = args.includes('--generate');
const forceDue = args.includes('--force-due');
const skipMit = args.includes('--skip-mit');
const skipEmail = args.includes('--skip-email');
const mitInvoiceArg = args.find((a) => a.startsWith('--mit-invoice-id='));
const mitInvoiceId = mitInvoiceArg ? parseInt(mitInvoiceArg.split('=')[1], 10) : null;
const profileIdArg = args.find((a) => a.startsWith('--profile-id='));
const profileIdFilter = profileIdArg
  ? parseInt(profileIdArg.split('=')[1], 10)
  : null;

if (profileIdArg && (!Number.isFinite(profileIdFilter) || profileIdFilter <= 0)) {
  console.error('Invalid --profile-id value.');
  process.exit(1);
}
if (mitInvoiceArg && (!Number.isFinite(mitInvoiceId) || mitInvoiceId <= 0)) {
  console.error('Invalid --mit-invoice-id value.');
  process.exit(1);
}

if (!TARGET_STUDENT_EMAILS.length) {
  console.error('TARGET_STUDENT_EMAILS is empty. Add at least one student email in the script.');
  process.exit(1);
}

async function loadStudent(client, email) {
  const res = await client.query(
    `SELECT user_id, full_name, email, branch_id
     FROM userstbl
     WHERE user_type = 'Student'
       AND LOWER(TRIM(email)) = LOWER(TRIM($1))
     LIMIT 5`,
    [email]
  );
  return res.rows;
}

async function loadActiveProfiles(client, studentId) {
  const res = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id,
            ip.student_id,
            ip.branch_id,
            ip.class_id,
            ip.package_id,
            ip.amount,
            ip.frequency,
            ip.description,
            ip.is_active,
            ip.total_phases,
            ip.generated_count,
            ip.phase_start,
            ip.downpayment_paid,
            ip.downpayment_invoice_id,
            c.class_name,
            ii.installmentinvoicedtl_id,
            ii.status AS queue_status,
            ii.frequency AS queue_frequency,
            ii.total_amount_including_tax,
            ii.total_amount_excluding_tax,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.scheduled_date), 'YYYY-MM-DD') AS scheduled,
            EXISTS (
              SELECT 1 FROM fiuu_autodebit_consentstbl fac
              WHERE fac.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
                AND fac.status = 'active'
                AND fac.enabled = true
                AND fac.parent_opt_in = true
            ) AS has_active_autopay,
            EXISTS (
              SELECT 1 FROM fiuu_payment_tokenstbl fpt
              WHERE fpt.student_id = ip.student_id
                AND fpt.status = 'active'
            ) AS has_active_token
     FROM installmentinvoiceprofilestbl ip
     LEFT JOIN classestbl c ON c.class_id = ip.class_id
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
      AND COALESCE(ii.status, '') != 'Generated'
     WHERE ip.student_id = $1
       AND ip.is_active = true
     ORDER BY ip.installmentinvoiceprofiles_id`,
    [studentId]
  );
  return res.rows;
}

function printProfile(p, today) {
  const due =
    p.next_gen && p.next_gen <= today
      ? 'DUE (eligible for generate)'
      : p.next_gen
        ? `NOT DUE (next_gen ${p.next_gen} > today ${today}) — use --force-due`
        : 'NO QUEUE next_generation_date';
  console.log({
    profile_id: p.installmentinvoiceprofiles_id,
    class: p.class_name || p.class_id || null,
    amount: p.amount,
    generated_count: p.generated_count,
    total_phases: p.total_phases,
    queue_dtl_id: p.installmentinvoicedtl_id,
    next_gen: p.next_gen,
    next_month: p.next_month,
    queue_status: p.queue_status,
    downpayment_paid: p.downpayment_paid,
    has_active_autopay: p.has_active_autopay,
    has_active_token: p.has_active_token,
    eligibility: due,
  });
}

async function processStudent(client, email, today) {
  console.log(`\n========== ${email} ==========`);

  const students = await loadStudent(client, email);
  if (students.length === 0) {
    throw new Error(`Student not found for email: ${email}`);
  }
  if (students.length > 1) {
    console.warn('Multiple students matched email; using the first:', students);
  }
  const student = students[0];
  console.log('Student:', {
    user_id: student.user_id,
    full_name: student.full_name,
    email: student.email,
    branch_id: student.branch_id,
  });

  let profiles = await loadActiveProfiles(client, student.user_id);
  if (Number.isFinite(profileIdFilter)) {
    profiles = profiles.filter((p) => p.installmentinvoiceprofiles_id === profileIdFilter);
  }

  if (profiles.length === 0) {
    throw new Error(
      Number.isFinite(profileIdFilter)
        ? `No active installment profile ${profileIdFilter} for this student`
        : 'No active installment profile for this student'
    );
  }

  console.log(`Active installment profile(s): ${profiles.length}`);
  profiles.forEach((p) => printProfile(p, today));

  if (Number.isFinite(mitInvoiceId)) {
    if (profiles.length > 1 && !Number.isFinite(profileIdFilter)) {
      throw new Error(
        'Multiple active profiles. Pass --profile-id=<id> with --mit-invoice-id.'
      );
    }
    const profile = profiles[0];
    console.log(`\nRetrying AutoPay MIT for invoice_id=${mitInvoiceId}…`);
    const { tryAutopayInstallmentInvoice } = await import(
      '../services/fiuu/fiuuRecurringCharge.js'
    );
    const mitResult = await tryAutopayInstallmentInvoice({
      invoiceId: mitInvoiceId,
      profileId: profile.installmentinvoiceprofiles_id,
      studentId: student.user_id,
    });
    console.log('💳 AutoPay MIT result:', mitResult);
    if (mitResult?.reason === 'mit_disabled') {
      console.log(
        'ℹ️ MIT skipped: set FIUU_AUTOPAY_MIT_ENABLED=true in backend env to charge the stored token.'
      );
    }
    return {
      email,
      invoice_id: mitInvoiceId,
      profile_id: profile.installmentinvoiceprofiles_id,
      mit: mitResult,
    };
  }

  if (!doGenerate) {
    console.log('Preview only for this student. Re-run with --generate to create the next invoice.');
    console.log(
      'To retry MIT on an existing unpaid invoice (e.g. INV-736):\n' +
        '  node backend/scripts/generateInstallmentInvoiceByEmail.js --mit-invoice-id=736'
    );
    return { email, preview: true };
  }

  if (profiles.length > 1) {
    throw new Error(
      'Multiple active profiles. Pass --profile-id=<installmentinvoiceprofiles_id> to choose one.'
    );
  }

  const profile = profiles[0];
  if (!profile.installmentinvoicedtl_id) {
    throw new Error(
      `Profile ${profile.installmentinvoiceprofiles_id} has no open installment queue row (status != Generated).`
    );
  }
  if (profile.downpayment_invoice_id && !profile.downpayment_paid) {
    throw new Error('Downpayment is not paid yet — generator will skip this profile.');
  }
  if (
    profile.total_phases != null &&
    Number(profile.generated_count || 0) >= Number(profile.total_phases)
  ) {
    throw new Error('Phase limit reached (generated_count >= total_phases).');
  }

  const nextGen = coerceToManilaYmd(profile.next_gen);
  if (nextGen && nextGen > today && !forceDue) {
    throw new Error(
      `Queue is not due yet (next_gen=${nextGen}, today=${today}). Re-run with --force-due to set next_generation_date=today.`
    );
  }

  if (forceDue && (!nextGen || nextGen > today)) {
    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date
       WHERE installmentinvoicedtl_id = $2`,
      [today, profile.installmentinvoicedtl_id]
    );
    console.log(
      `✅ Forced queue due: dtl=${profile.installmentinvoicedtl_id} next_generation_date → ${today}`
    );
  }

  const queueRes = await client.query(
    `SELECT ii.*,
            ip.student_id, ip.branch_id, ip.package_id, ip.amount AS profile_amount,
            ip.frequency AS profile_frequency, ip.description, ip.is_active,
            ip.class_id, ip.total_phases, ip.generated_count, ip.phase_start,
            ip.downpayment_paid, ip.downpayment_invoice_id
     FROM installmentinvoicestbl ii
     JOIN installmentinvoiceprofilestbl ip
       ON ip.installmentinvoiceprofiles_id = ii.installmentinvoiceprofiles_id
     WHERE ii.installmentinvoicedtl_id = $1`,
    [profile.installmentinvoicedtl_id]
  );
  const installmentInvoice = queueRes.rows[0];
  if (!installmentInvoice) {
    throw new Error('Queue row disappeared after update');
  }

  console.log('Generating installment invoice…');
  const invoiceData = await generateInvoiceFromInstallment(installmentInvoice, {
    student_id: installmentInvoice.student_id,
    branch_id: installmentInvoice.branch_id,
    package_id: installmentInvoice.package_id,
    amount: installmentInvoice.profile_amount,
    frequency: installmentInvoice.profile_frequency || installmentInvoice.frequency,
    description: installmentInvoice.description,
    generated_count: installmentInvoice.generated_count || 0,
    class_id: installmentInvoice.class_id,
    total_phases: installmentInvoice.total_phases,
    phase_start: installmentInvoice.phase_start,
  });

  console.log('✅ Invoice generated:', {
    invoice_id: invoiceData.invoice_id,
    amount: invoiceData.amount,
    generated_count: invoiceData.generated_count,
    phase: invoiceData.current_phase_number,
    next_generation_date: invoiceData.next_generation_date,
    next_invoice_month: invoiceData.next_invoice_month,
  });

  if (!skipEmail) {
    try {
      const { sendMonthlyInvoiceGeneratedNotice } = await import(
        '../utils/monthlyInvoiceNoticeEmailService.js'
      );
      const emailResult = await sendMonthlyInvoiceGeneratedNotice({
        invoiceId: invoiceData.invoice_id,
      });
      console.log('📧 Monthly notice:', emailResult);
    } catch (emailErr) {
      console.error('⚠️ Monthly notice failed:', emailErr?.message || emailErr);
    }
  }

  if (!skipMit) {
    try {
      const { tryAutopayInstallmentInvoice } = await import(
        '../services/fiuu/fiuuRecurringCharge.js'
      );
      const mitResult = await tryAutopayInstallmentInvoice({
        invoiceId: invoiceData.invoice_id,
        profileId: profile.installmentinvoiceprofiles_id,
        studentId: student.user_id,
      });
      console.log('💳 AutoPay MIT result:', mitResult);
      if (mitResult?.reason === 'mit_disabled') {
        console.log(
          'ℹ️ MIT skipped: set FIUU_AUTOPAY_MIT_ENABLED=true in backend env to charge the stored token.'
        );
      }
      return {
        email,
        invoice_id: invoiceData.invoice_id,
        profile_id: profile.installmentinvoiceprofiles_id,
        mit: mitResult,
      };
    } catch (mitErr) {
      console.error('⚠️ AutoPay MIT failed:', mitErr?.message || mitErr);
    }
  }

  return {
    email,
    invoice_id: invoiceData.invoice_id,
    profile_id: profile.installmentinvoiceprofiles_id,
  };
}

async function main() {
  const client = await getClient();
  const today = todayYmdManila();

  try {
    console.log(`🔧 DB: ${process.env.DB_NAME || '(unknown)'} | today (Manila): ${today}`);
    console.log(`Mode: ${doGenerate ? 'GENERATE' : Number.isFinite(mitInvoiceId) ? `MIT-ONLY invoice ${mitInvoiceId}` : 'PREVIEW'} | force-due=${forceDue}`);
    console.log(
      `FIUU_AUTOPAY_MIT_ENABLED=${process.env.FIUU_AUTOPAY_MIT_ENABLED || '(unset → false)'}`
    );
    console.log('Target students:', TARGET_STUDENT_EMAILS);

    const results = [];
    for (const email of TARGET_STUDENT_EMAILS) {
      try {
        const result = await processStudent(client, email, today);
        results.push({ ok: true, ...result });
      } catch (err) {
        console.error(`❌ ${email}:`, err?.message || err);
        results.push({ ok: false, email, error: err?.message || String(err) });
      }
    }

    console.log('\nSummary:', results);
    if (!doGenerate && !Number.isFinite(mitInvoiceId)) {
      console.log('\nPreview only. For AutoPay MIT UAT:');
      console.log(
        '  node backend/scripts/generateInstallmentInvoiceByEmail.js --force-due --generate'
      );
      console.log('Retry MIT on unpaid INV-736:');
      console.log(
        '  node backend/scripts/generateInstallmentInvoiceByEmail.js --mit-invoice-id=736'
      );
    } else if (results.some((r) => !r.ok)) {
      process.exitCode = 1;
    }
  } finally {
    client.release?.();
  }
}

main().catch((err) => {
  console.error('❌', err?.message || err);
  process.exit(1);
});
