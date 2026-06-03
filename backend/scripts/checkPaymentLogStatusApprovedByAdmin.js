/**
 * Audit Payment Logs status columns and list payments approved by Admin users.
 *
 * Payment Logs uses two approval sources (UI shows both as "Approved by …"):
 *   1) paymenttbl — status, approval_status, approved_by (Finance/Admin payment verify)
 *   2) Unapplied Acknowledgement Receipt rows — verified_by_user_id on acknowledgement_receiptstbl
 *      (shown in Payment Logs as payment_method = Acknowledgement Receipt, invoice "-")
 *
 * Usage:
 *   node scripts/checkPaymentLogStatusApprovedByAdmin.js
 *   node scripts/checkPaymentLogStatusApprovedByAdmin.js --detail
 *   node scripts/checkPaymentLogStatusApprovedByAdmin.js --admin-only --detail
 *   node scripts/checkPaymentLogStatusApprovedByAdmin.js --branch-id=1 --from=2026-01-01 --to=2026-06-30
 */

import '../config/loadEnv.js';

function readArg(prefix) {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1).trim() : '';
}

const SHOW_DETAIL = process.argv.includes('--detail');
const ADMIN_ONLY = process.argv.includes('--admin-only');
const BRANCH_ID = readArg('--branch-id');
const DATE_FROM = readArg('--from');
const DATE_TO = readArg('--to');
const LIMIT_ARG = readArg('--limit');
const DETAIL_LIMIT = LIMIT_ARG ? Math.max(1, parseInt(LIMIT_ARG, 10) || 200) : 200;

function printUsage() {
  console.log('Check paymenttbl status columns and Admin-approved Payment Logs rows.');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/checkPaymentLogStatusApprovedByAdmin.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --admin-only          Only show Admin approvers and their payments (skip global breakdown)');
  console.log('  --detail              List each Admin-approved payment (up to --limit)');
  console.log('  --branch-id=<id>      Filter by payment branch_id');
  console.log('  --from=YYYY-MM-DD     Filter payment issue_date (Manila) from');
  console.log('  --to=YYYY-MM-DD       Filter payment issue_date (Manila) to (inclusive)');
  console.log('  --limit=<n>           Max rows for --detail (default 200)');
  console.log('  --help, -h            Show help');
  console.log('');
  console.log('Revoke all Admin approvals: node scripts/revokeAdminPaymentLogApprovals.js [--apply]');
  console.log('See also: node scripts/listPaymentLogApprovers.js --user-type=Admin');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

function buildDateBranchScope(alias, baseParts = []) {
  const params = [];
  let idx = 1;
  const parts = [...baseParts];

  if (BRANCH_ID) {
    parts.push(`${alias}.branch_id = $${idx}`);
    params.push(parseInt(BRANCH_ID, 10));
    idx += 1;
  }
  if (DATE_FROM) {
    parts.push(`${alias}.issue_date >= $${idx}::date`);
    params.push(DATE_FROM);
    idx += 1;
  }
  if (DATE_TO) {
    parts.push(`${alias}.issue_date <= $${idx}::date`);
    params.push(DATE_TO);
    idx += 1;
  }

  return { scopeSql: parts.join('\n        AND '), params };
}

function buildPaymentScopeParts() {
  return buildDateBranchScope('p', [`p.status = 'Completed'`]);
}

function buildArScopeParts() {
  return buildDateBranchScope('ar', [
    `ar.ar_type = 'Package'`,
    `ar.status = 'Verified'`,
    `ar.verified_by_user_id IS NOT NULL`,
  ]);
}

async function main() {
  const { query } = await import('../config/database.js');
  const { scopeSql, params } = buildPaymentScopeParts();

  const { scopeSql: arScopeSql, params: arParams } = buildArScopeParts();

  console.log('');
  console.log('=== Payment Logs — status column audit ===');
  console.log(
    'Note: Unapplied AR rows on Payment Logs use finance-unified API. Admin verifiers show Pending Approval; AR stays Verified in acknowledgement_receiptstbl.'
  );
  if (BRANCH_ID) console.log(`Payment branch filter: ${BRANCH_ID}`);
  if (DATE_FROM || DATE_TO) {
    console.log(`Payment issue_date (Manila): ${DATE_FROM || '…'} → ${DATE_TO || '…'}`);
  }
  console.log('');

  const statusBreakdown = await query(
    `
      SELECT
        COALESCE(p.status, '(null)') AS status,
        COALESCE(p.approval_status, 'Pending') AS approval_status,
        COUNT(*)::bigint AS row_count
      FROM paymenttbl p
      WHERE ${scopeSql}
      GROUP BY COALESCE(p.status, '(null)'), COALESCE(p.approval_status, 'Pending')
      ORDER BY row_count DESC, status, approval_status
    `,
    params
  );

  console.log('--- status × approval_status (Completed payments in scope) ---');
  if (!statusBreakdown.rows.length) {
    console.log('(none)');
  } else {
    for (const row of statusBreakdown.rows) {
      console.log(
        `  status=${row.status} | approval_status=${row.approval_status} → ${row.row_count} row(s)`
      );
    }
  }
  console.log('');

  const allAdmins = await query(
    `
      SELECT
        u.user_id,
        u.full_name,
        u.email,
        u.user_type,
        u.branch_id,
        COALESCE(b.branch_nickname, b.branch_name) AS branch_name
      FROM userstbl u
      LEFT JOIN branchestbl b ON u.branch_id = b.branch_id
      WHERE LOWER(TRIM(u.user_type)) = 'admin'
      ORDER BY u.full_name ASC NULLS LAST, u.user_id ASC
    `
  );

  console.log('--- All Admin users in system (user_type = Admin) ---');
  if (!allAdmins.rows.length) {
    console.log('(no Admin users found)');
  } else {
    for (const row of allAdmins.rows) {
      const branchLabel = row.branch_name
        ? `${row.branch_name} (id=${row.branch_id})`
        : row.branch_id != null
          ? `branch_id=${row.branch_id}`
          : 'no branch';
      console.log(`  ${row.full_name || '(no name)'} — user_id=${row.user_id}`);
      console.log(`    email: ${row.email || '—'} | branch: ${branchLabel}`);
    }
  }
  console.log(`Total Admin accounts: ${allAdmins.rows.length}`);
  console.log('');

  const adminApproved = await query(
    `
      SELECT
        approver.user_id,
        approver.full_name,
        approver.email,
        approver.branch_id AS approver_branch_id,
        COALESCE(ab.branch_nickname, ab.branch_name) AS approver_branch_name,
        COUNT(*)::bigint AS approval_count,
        MIN(TIMEZONE('Asia/Manila', p.approved_at)) AS first_approved_manila,
        MAX(TIMEZONE('Asia/Manila', p.approved_at)) AS last_approved_manila
      FROM paymenttbl p
      INNER JOIN userstbl approver ON p.approved_by = approver.user_id
      LEFT JOIN branchestbl ab ON approver.branch_id = ab.branch_id
      WHERE ${scopeSql}
        AND COALESCE(p.approval_status, 'Pending') = 'Approved'
        AND p.approved_by IS NOT NULL
        AND LOWER(TRIM(approver.user_type)) = 'admin'
      GROUP BY
        approver.user_id,
        approver.full_name,
        approver.email,
        approver.branch_id,
        ab.branch_nickname,
        ab.branch_name
      ORDER BY approval_count DESC, approver.full_name ASC
    `,
    params
  );

  const adminApprovedTotal = await query(
    `
      SELECT COUNT(*)::bigint AS total
      FROM paymenttbl p
      INNER JOIN userstbl approver ON p.approved_by = approver.user_id
      WHERE ${scopeSql}
        AND COALESCE(p.approval_status, 'Pending') = 'Approved'
        AND p.approved_by IS NOT NULL
        AND LOWER(TRIM(approver.user_type)) = 'admin'
    `,
    params
  );

  console.log('--- Admin users who approved paymenttbl rows (approved_by) ---');
  console.log(`Total paymenttbl rows approved by Admin: ${adminApprovedTotal.rows[0]?.total ?? 0}`);
  console.log(`Distinct Admin approvers (payments only): ${adminApproved.rows.length}`);
  console.log('');

  if (!adminApproved.rows.length) {
    console.log('(no paymenttbl rows in scope were approved by an Admin user)');
  } else {
    console.log('Admin names (approvers):');
    for (const row of adminApproved.rows) {
      const branchLabel = row.approver_branch_name
        ? row.approver_branch_name
        : row.approver_branch_id != null
          ? `branch_id=${row.approver_branch_id}`
          : 'no branch';
      console.log('');
      console.log(`  • ${row.full_name || '(no name)'} (user_id=${row.user_id})`);
      console.log(`    email: ${row.email || '—'} | branch: ${branchLabel}`);
      console.log(`    approvals in scope: ${row.approval_count}`);
      if (row.first_approved_manila) {
        console.log(
          `    first approved (Manila): ${new Date(row.first_approved_manila).toISOString().slice(0, 19).replace('T', ' ')}`
        );
      }
      if (row.last_approved_manila) {
        console.log(
          `    last approved (Manila):  ${new Date(row.last_approved_manila).toISOString().slice(0, 19).replace('T', ' ')}`
        );
      }
    }
  }
  console.log('');

  if (!ADMIN_ONLY) {
    const nonAdminApproved = await query(
      `
        SELECT
          COALESCE(approver.user_type, '(missing user)') AS user_type,
          COUNT(DISTINCT approver.user_id)::bigint AS distinct_users,
          COUNT(*)::bigint AS approval_count
        FROM paymenttbl p
        INNER JOIN userstbl approver ON p.approved_by = approver.user_id
        WHERE ${scopeSql}
          AND COALESCE(p.approval_status, 'Pending') = 'Approved'
          AND p.approved_by IS NOT NULL
          AND LOWER(TRIM(approver.user_type)) <> 'admin'
        GROUP BY COALESCE(approver.user_type, '(missing user)')
        ORDER BY approval_count DESC
      `,
      params
    );

    console.log('--- Non-Admin approvers (for comparison) ---');
    if (!nonAdminApproved.rows.length) {
      console.log('(none in scope)');
    } else {
      for (const row of nonAdminApproved.rows) {
        console.log(
          `  ${row.user_type}: ${row.distinct_users} user(s), ${row.approval_count} approval(s)`
        );
      }
    }
    console.log('');
  }

  const adminArVerified = await query(
    `
      SELECT
        verifier.user_id,
        verifier.full_name,
        verifier.email,
        verifier.user_type,
        verifier.branch_id AS verifier_branch_id,
        COALESCE(vb.branch_nickname, vb.branch_name) AS verifier_branch_name,
        COUNT(*)::bigint AS verify_count,
        COUNT(*) FILTER (
          WHERE ar.payment_id IS NULL AND ar.invoice_id IS NULL
        )::bigint AS unapplied_ar_count,
        MIN(TIMEZONE('Asia/Manila', ar.verified_at)) AS first_verified_manila,
        MAX(TIMEZONE('Asia/Manila', ar.verified_at)) AS last_verified_manila
      FROM acknowledgement_receiptstbl ar
      INNER JOIN userstbl verifier ON ar.verified_by_user_id = verifier.user_id
      LEFT JOIN branchestbl vb ON verifier.branch_id = vb.branch_id
      WHERE ${arScopeSql}
        AND LOWER(TRIM(verifier.user_type)) = 'admin'
      GROUP BY
        verifier.user_id,
        verifier.full_name,
        verifier.email,
        verifier.user_type,
        verifier.branch_id,
        vb.branch_nickname,
        vb.branch_name
      ORDER BY verify_count DESC, verifier.full_name ASC
    `,
    arParams
  );

  const adminArTotal = await query(
    `
      SELECT
        COUNT(*)::bigint AS total_verified_ar,
        COUNT(*) FILTER (
          WHERE ar.payment_id IS NULL AND ar.invoice_id IS NULL
        )::bigint AS unapplied_in_payment_logs
      FROM acknowledgement_receiptstbl ar
      INNER JOIN userstbl verifier ON ar.verified_by_user_id = verifier.user_id
      WHERE ${arScopeSql}
        AND LOWER(TRIM(verifier.user_type)) = 'admin'
    `,
    arParams
  );

  console.log('--- Admin users who verified ARs (Payment Logs: Acknowledgement Receipt rows) ---');
  console.log(
    `Verified package AR rows by Admin: ${adminArTotal.rows[0]?.total_verified_ar ?? 0} ` +
      `(unapplied shown in Payment Logs: ${adminArTotal.rows[0]?.unapplied_in_payment_logs ?? 0})`
  );
  console.log(`Distinct Admin AR verifiers: ${adminArVerified.rows.length}`);
  console.log('');

  if (!adminArVerified.rows.length) {
    console.log('(no verified package AR rows in scope were verified by an Admin user)');
  } else {
    console.log('Admin names (AR verifiers — matches UI for unapplied AR):');
    for (const row of adminArVerified.rows) {
      const branchLabel = row.verifier_branch_name
        ? row.verifier_branch_name
        : row.verifier_branch_id != null
          ? `branch_id=${row.verifier_branch_id}`
          : 'no branch';
      console.log('');
      console.log(`  • ${row.full_name || '(no name)'} [${row.user_type}] (user_id=${row.user_id})`);
      console.log(`    email: ${row.email || '—'} | branch: ${branchLabel}`);
      console.log(
        `    verified ARs in scope: ${row.verify_count} (unapplied in Payment Logs: ${row.unapplied_ar_count})`
      );
    }
  }
  console.log('');

  if (SHOW_DETAIL && adminArVerified.rows.length) {
    const arDetail = await query(
      `
        SELECT
          ar.ack_receipt_id,
          ar.ack_receipt_number,
          ar.status,
          ar.branch_id,
          COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
          ar.prospect_student_name,
          ar.package_name_snapshot,
          ar.reference_number,
          COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0) AS line_total,
          TO_CHAR(ar.issue_date, 'YYYY-MM-DD') AS issue_date,
          TO_CHAR(TIMEZONE('Asia/Manila', ar.verified_at), 'YYYY-MM-DD HH24:MI:SS') AS verified_at_manila,
          verifier.full_name AS verifier_name,
          verifier.user_type AS verifier_user_type,
          (ar.payment_id IS NULL AND ar.invoice_id IS NULL) AS is_unapplied
        FROM acknowledgement_receiptstbl ar
        INNER JOIN userstbl verifier ON ar.verified_by_user_id = verifier.user_id
        LEFT JOIN branchestbl b ON ar.branch_id = b.branch_id
        WHERE ${arScopeSql}
          AND LOWER(TRIM(verifier.user_type)) = 'admin'
        ORDER BY ar.verified_at DESC NULLS LAST, ar.ack_receipt_id DESC
        LIMIT $${arParams.length + 1}
      `,
      [...arParams, DETAIL_LIMIT]
    );

    console.log(`--- Admin-verified AR detail (max ${DETAIL_LIMIT}) ---`);
    for (const row of arDetail.rows) {
      console.log('');
      console.log(
        `  AR-${row.ack_receipt_id} #${row.ack_receipt_number || '—'} | status=${row.status} | unapplied=${row.is_unapplied}`
      );
      console.log(
        `    ${row.branch_name || 'branch ' + row.branch_id} | ${row.prospect_student_name || '—'} | ${row.package_name_snapshot || '—'}`
      );
      console.log(
        `    amount: ${Number(row.line_total || 0).toFixed(2)} | issue: ${row.issue_date || '—'} | ref: ${row.reference_number || '—'}`
      );
      console.log(
        `    verified (Manila): ${row.verified_at_manila || '—'} by ${row.verifier_name} [${row.verifier_user_type}]`
      );
    }
    console.log('');
  }

  if (SHOW_DETAIL && adminApproved.rows.length) {
    const detail = await query(
      `
        SELECT
          p.payment_id,
          p.status,
          p.approval_status,
          p.invoice_id,
          p.branch_id,
          COALESCE(pb.branch_nickname, pb.branch_name) AS payment_branch_name,
          p.payment_method,
          p.reference_number,
          p.finance_verified_reference_number,
          COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0) AS line_total,
          TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS issue_date,
          TO_CHAR(TIMEZONE('Asia/Manila', p.approved_at), 'YYYY-MM-DD HH24:MI:SS') AS approved_at_manila,
          approver.user_id AS approver_user_id,
          approver.full_name AS approver_name,
          approver.email AS approver_email,
          pay_student.full_name AS student_name
        FROM paymenttbl p
        INNER JOIN userstbl approver ON p.approved_by = approver.user_id
        LEFT JOIN branchestbl pb ON p.branch_id = pb.branch_id
        LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
        LEFT JOIN invoicestudentstbl ist ON i.invoice_id = ist.invoice_id
        LEFT JOIN userstbl pay_student ON ist.student_id = pay_student.user_id
        WHERE ${scopeSql}
          AND COALESCE(p.approval_status, 'Pending') = 'Approved'
          AND LOWER(TRIM(approver.user_type)) = 'admin'
        ORDER BY p.approved_at DESC NULLS LAST, p.payment_id DESC
        LIMIT $${params.length + 1}
      `,
      [...params, DETAIL_LIMIT]
    );

    console.log(`--- Admin-approved payment detail (max ${DETAIL_LIMIT}) ---`);
    for (const row of detail.rows) {
      console.log('');
      console.log(
        `  PAY-${row.payment_id} | status=${row.status} | approval_status=${row.approval_status}`
      );
      console.log(
        `    INV-${row.invoice_id ?? '?'} | ${row.payment_branch_name || 'branch ' + row.branch_id} | ${row.payment_method || '—'}`
      );
      console.log(
        `    student: ${row.student_name || '—'} | amount: ${Number(row.line_total || 0).toFixed(2)} | issue: ${row.issue_date || '—'}`
      );
      console.log(
        `    ref: ${row.reference_number || '—'} | finance ref: ${row.finance_verified_reference_number || '—'}`
      );
      console.log(
        `    approved (Manila): ${row.approved_at_manila || '—'} by ${row.approver_name} (user_id=${row.approver_user_id})`
      );
    }
    console.log('');
  }

  console.log('Done.');
  console.log('');
}

main().catch((err) => {
  console.error('Script failed:', err.message || err);
  process.exit(1);
});
