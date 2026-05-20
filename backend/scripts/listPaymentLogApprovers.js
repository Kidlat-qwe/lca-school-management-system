/**
 * List users who approved payments (Payment Logs finance approval).
 *
 * Data source: paymenttbl.approved_by + approval_status = 'Approved'
 * (same field shown as "Approved by …" on Payment Logs).
 *
 * Usage:
 *   node backend/scripts/listPaymentLogApprovers.js
 *   node backend/scripts/listPaymentLogApprovers.js --detail
 *   node backend/scripts/listPaymentLogApprovers.js --branch-id=1
 *   node backend/scripts/listPaymentLogApprovers.js --from=2026-01-01 --to=2026-05-31
 *   node backend/scripts/listPaymentLogApprovers.js --user-type=Admin
 *   node backend/scripts/listPaymentLogApprovers.js --detail --limit=100
 *
 * Revert Admin-approved payments back to Pending (preview unless --apply):
 *   node backend/scripts/listPaymentLogApprovers.js --revert-admin-approvals
 *   node backend/scripts/listPaymentLogApprovers.js --revert-admin-approvals --apply
 *   node backend/scripts/listPaymentLogApprovers.js --revert-admin-approvals --branch-id=1 --apply
 *
 * Without --branch-id, prints every branch (from branchestbl) with approval counts.
 */

import '../config/loadEnv.js';

function readArg(prefix) {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1).trim() : '';
}

const SHOW_DETAIL = process.argv.includes('--detail');
const REVERT_ADMIN_APPROVALS = process.argv.includes('--revert-admin-approvals');
const APPLY_REVERT = process.argv.includes('--apply');
const BRANCH_ID = readArg('--branch-id');
const DATE_FROM = readArg('--from');
const DATE_TO = readArg('--to');
const USER_TYPE = readArg('--user-type');
const LIMIT_ARG = readArg('--limit');
const DETAIL_LIMIT = LIMIT_ARG ? Math.max(1, parseInt(LIMIT_ARG, 10) || 200) : 200;

function printUsage() {
  console.log('List users who approved payments in Payment Logs (paymenttbl.approved_by).');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/listPaymentLogApprovers.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --detail              List each approved payment row (limited)');
  console.log('  --branch-id=<id>      Filter by payment branch_id only (skips all-branches list)');
  console.log('  --from=YYYY-MM-DD     Filter approved_at (Manila date) from');
  console.log('  --to=YYYY-MM-DD       Filter approved_at (Manila date) to (inclusive day)');
  console.log('  --user-type=<type>    Filter approver user_type (e.g. Admin, Finance, Superadmin)');
  console.log('  --limit=<n>           Max rows for --detail (default 200)');
  console.log('');
  console.log('Revert Admin approvals to Pending (same as revoke in Payment Logs API):');
  console.log('  --revert-admin-approvals   Preview payments approved by Admin user_type');
  console.log('  --apply                    Execute revert (omit for dry-run preview only)');
  console.log('  --help, -h            Show this help');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printUsage();
  process.exit(0);
}

function buildFilters() {
  const params = [];
  let idx = 1;

  const baseParts = [
    `COALESCE(p.approval_status, 'Pending') = 'Approved'`,
    `p.approved_by IS NOT NULL`,
    `p.status = 'Completed'`,
    `COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')`,
  ];
  const fullParts = [...baseParts];

  if (BRANCH_ID) {
    fullParts.push(`p.branch_id = $${idx}`);
    params.push(parseInt(BRANCH_ID, 10));
    idx += 1;
  }
  if (DATE_FROM) {
    fullParts.push(`TIMEZONE('Asia/Manila', p.approved_at)::date >= $${idx}::date`);
    params.push(DATE_FROM);
    idx += 1;
  }
  if (DATE_TO) {
    fullParts.push(`TIMEZONE('Asia/Manila', p.approved_at)::date <= $${idx}::date`);
    params.push(DATE_TO);
    idx += 1;
  }

  const paymentWhereSql = fullParts.join('\n        AND ');
  const paymentParams = [...params];

  if (USER_TYPE) {
    fullParts.push(`LOWER(TRIM(approver.user_type)) = LOWER(TRIM($${idx}))`);
    params.push(USER_TYPE);
  }

  return {
    paymentWhereSql,
    whereSql: fullParts.join('\n        AND '),
    paymentParams,
    params,
  };
}

/** Approved rows where approver.user_type is Admin (for revert). */
function buildAdminRevertFilters() {
  const params = [];
  let idx = 1;

  const parts = [
    `COALESCE(p.approval_status, 'Pending') = 'Approved'`,
    `p.approved_by IS NOT NULL`,
    `p.status = 'Completed'`,
    `COALESCE(p.approval_status, 'Pending') NOT IN ('Returned', 'Rejected')`,
    `LOWER(TRIM(approver.user_type)) = 'admin'`,
  ];

  if (BRANCH_ID) {
    parts.push(`p.branch_id = $${idx}`);
    params.push(parseInt(BRANCH_ID, 10));
    idx += 1;
  }
  if (DATE_FROM) {
    parts.push(`TIMEZONE('Asia/Manila', p.approved_at)::date >= $${idx}::date`);
    params.push(DATE_FROM);
    idx += 1;
  }
  if (DATE_TO) {
    parts.push(`TIMEZONE('Asia/Manila', p.approved_at)::date <= $${idx}::date`);
    params.push(DATE_TO);
    idx += 1;
  }

  return {
    whereSql: parts.join('\n        AND '),
    params,
  };
}

async function revertAdminApprovals(client) {
  const { whereSql, params } = buildAdminRevertFilters();

  const previewResult = await client.query(
    `
      SELECT
        p.payment_id,
        p.invoice_id,
        p.branch_id,
        COALESCE(pb.branch_nickname, pb.branch_name) AS payment_branch_name,
        p.payment_method,
        p.reference_number,
        COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0) AS line_total,
        TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS payment_issue_date,
        TO_CHAR(TIMEZONE('Asia/Manila', p.approved_at), 'YYYY-MM-DD HH24:MI:SS') AS approved_at_manila,
        approver.user_id AS approver_user_id,
        approver.full_name AS approver_name,
        approver.email AS approver_email,
        approver.user_type AS approver_user_type,
        pay_student.full_name AS student_name
      FROM paymenttbl p
      INNER JOIN userstbl approver ON p.approved_by = approver.user_id
      LEFT JOIN branchestbl pb ON p.branch_id = pb.branch_id
      LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
      LEFT JOIN invoicestudentstbl ist ON i.invoice_id = ist.invoice_id
      LEFT JOIN userstbl pay_student ON ist.student_id = pay_student.user_id
      WHERE ${whereSql}
      ORDER BY p.approved_at DESC NULLS LAST, p.payment_id DESC
    `,
    params
  );

  console.log('');
  console.log('=== Revert Admin-approved payments → Pending ===');
  console.log(`Mode: ${APPLY_REVERT ? 'APPLY (will update database)' : 'DRY RUN (preview only; pass --apply to execute)'}`);
  if (BRANCH_ID) console.log(`Branch filter (payment): ${BRANCH_ID}`);
  if (DATE_FROM || DATE_TO) {
    console.log(`Approved date (Manila): ${DATE_FROM || '…'} → ${DATE_TO || '…'}`);
  }
  console.log(`Payments to revert: ${previewResult.rows.length}`);
  console.log('');

  if (!previewResult.rows.length) {
    console.log('Nothing to revert.');
    console.log('');
    return;
  }

  for (const row of previewResult.rows) {
    console.log(
      `  payment_id=${row.payment_id} INV-${row.invoice_id ?? '?'} | ${row.payment_branch_name || 'branch ' + row.branch_id}`
    );
    console.log(
      `    student: ${row.student_name || '—'} | ${row.payment_method || '—'} | line ${Number(row.line_total || 0).toFixed(2)}`
    );
    console.log(
      `    approved_at (Manila): ${row.approved_at_manila || '—'} by ${row.approver_name} [${row.approver_user_type}] user_id=${row.approver_user_id}`
    );
  }
  console.log('');

  if (!APPLY_REVERT) {
    console.log('Dry run complete. Re-run with --apply to set approval_status = Pending and clear approved_by / approved_at / finance_verified_reference_number.');
    console.log('');
    return;
  }

  await client.query('BEGIN');
  try {
    const updateResult = await client.query(
      `
        UPDATE paymenttbl p
        SET approval_status = 'Pending',
            approved_by = NULL,
            approved_at = NULL,
            finance_verified_reference_number = NULL
        FROM userstbl approver
        WHERE p.approved_by = approver.user_id
          AND ${whereSql}
        RETURNING p.payment_id, p.invoice_id, p.branch_id
      `,
      params
    );

    await client.query('COMMIT');

    console.log(`Reverted ${updateResult.rowCount} payment(s) to Pending.`);
    console.log('');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  const { getClient } = await import('../config/database.js');
  const client = await getClient();

  try {
    if (REVERT_ADMIN_APPROVALS) {
      await revertAdminApprovals(client);
      return;
    }

    const { paymentWhereSql, whereSql, paymentParams, params } = buildFilters();

    const summaryResult = await client.query(
      `
        SELECT
          approver.user_id,
          approver.full_name,
          approver.email,
          approver.user_type,
          approver.branch_id AS approver_branch_id,
          COALESCE(ab.branch_nickname, ab.branch_name) AS approver_branch_name,
          COUNT(*)::bigint AS approval_count,
          MIN(TIMEZONE('Asia/Manila', p.approved_at)) AS first_approved_at_manila,
          MAX(TIMEZONE('Asia/Manila', p.approved_at)) AS last_approved_at_manila
        FROM paymenttbl p
        INNER JOIN userstbl approver ON p.approved_by = approver.user_id
        LEFT JOIN branchestbl ab ON approver.branch_id = ab.branch_id
        WHERE ${whereSql}
        GROUP BY
          approver.user_id,
          approver.full_name,
          approver.email,
          approver.user_type,
          approver.branch_id,
          ab.branch_nickname,
          ab.branch_name
        ORDER BY approval_count DESC, approver.full_name ASC
      `,
      params
    );

    const byTypeResult = await client.query(
      `
        SELECT
          COALESCE(approver.user_type, '(unknown)') AS user_type,
          COUNT(DISTINCT approver.user_id)::bigint AS distinct_approvers,
          COUNT(*)::bigint AS approval_count
        FROM paymenttbl p
        INNER JOIN userstbl approver ON p.approved_by = approver.user_id
        WHERE ${whereSql}
        GROUP BY COALESCE(approver.user_type, '(unknown)')
        ORDER BY approval_count DESC
      `,
      params
    );

    const totalResult = await client.query(
      `
        SELECT COUNT(*)::bigint AS total_approved_payments
        FROM paymenttbl p
        WHERE ${paymentWhereSql}
      `,
      paymentParams
    );

    const orphanResult = await client.query(
      `
        SELECT COUNT(*)::bigint AS orphan_count
        FROM paymenttbl p
        LEFT JOIN userstbl approver ON p.approved_by = approver.user_id
        WHERE ${paymentWhereSql}
          AND approver.user_id IS NULL
      `,
      paymentParams
    );

    let byBranchResult = { rows: [] };
    if (!BRANCH_ID) {
      const statsWhere = USER_TYPE
        ? `${paymentWhereSql}
          AND approver.user_id IS NOT NULL
          AND LOWER(TRIM(approver.user_type)) = LOWER(TRIM($${paymentParams.length + 1}))`
        : `${paymentWhereSql}
          AND approver.user_id IS NOT NULL`;
      const statsParams = USER_TYPE ? [...paymentParams, USER_TYPE] : paymentParams;

      byBranchResult = await client.query(
        `
          SELECT
            b.branch_id,
            COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
            COALESCE(stats.approval_count, 0)::bigint AS approval_count,
            COALESCE(stats.distinct_approvers, 0)::bigint AS distinct_approvers
          FROM branchestbl b
          LEFT JOIN (
            SELECT
              p.branch_id,
              COUNT(*)::bigint AS approval_count,
              COUNT(DISTINCT approver.user_id)::bigint AS distinct_approvers
            FROM paymenttbl p
            INNER JOIN userstbl approver ON p.approved_by = approver.user_id
            WHERE ${statsWhere}
            GROUP BY p.branch_id
          ) stats ON stats.branch_id = b.branch_id
          ORDER BY stats.approval_count DESC NULLS LAST, branch_name ASC, b.branch_id ASC
        `,
        statsParams
      );
    }

    console.log('');
    console.log('=== Payment log approvers (approved_by) ===');
    if (BRANCH_ID) console.log(`Branch filter (payment): ${BRANCH_ID}`);
    if (DATE_FROM || DATE_TO) {
      console.log(`Approved date (Manila): ${DATE_FROM || '…'} → ${DATE_TO || '…'}`);
    }
    if (USER_TYPE) console.log(`Approver user_type: ${USER_TYPE}`);
    console.log('');
    console.log(
      `Total approved payment rows: ${totalResult.rows[0]?.total_approved_payments ?? 0}`
    );
    if (Number(orphanResult.rows[0]?.orphan_count || 0) > 0) {
      console.log(
        `Warning: ${orphanResult.rows[0].orphan_count} approved row(s) have approved_by set but user record missing.`
      );
    }
    console.log('');

    if (!BRANCH_ID) {
      console.log('--- By payment branch (all branches) ---');
      if (!byBranchResult.rows.length) {
        console.log('(no branches in branchestbl)');
      } else {
        for (const row of byBranchResult.rows) {
          const label = row.branch_name || `branch_id=${row.branch_id}`;
          console.log(
            `  ${label} (id=${row.branch_id}): ${row.approval_count} approval(s), ${row.distinct_approvers} approver(s)`
          );
        }
      }
      console.log('');
    }

    console.log('--- By user type ---');
    if (!byTypeResult.rows.length) {
      console.log('(none)');
    } else {
      for (const row of byTypeResult.rows) {
        console.log(
          `  ${row.user_type}: ${row.distinct_approvers} user(s), ${row.approval_count} approval(s)`
        );
      }
    }
    console.log('');

    console.log('--- By approver (user) ---');
    if (!summaryResult.rows.length) {
      console.log('(none)');
    } else {
      for (const row of summaryResult.rows) {
        const branchLabel = row.approver_branch_name
          ? `${row.approver_branch_name} (branch_id=${row.approver_branch_id})`
          : row.approver_branch_id != null
            ? `branch_id=${row.approver_branch_id}`
            : 'no branch on user';
        console.log('');
        console.log(`  ${row.full_name || '(no name)'} [${row.user_type || '?'}]`);
        console.log(`    user_id: ${row.user_id}`);
        console.log(`    email:   ${row.email || '—'}`);
        console.log(`    branch:  ${branchLabel}`);
        console.log(`    approvals: ${row.approval_count}`);
        console.log(
          `    first: ${row.first_approved_at_manila ? new Date(row.first_approved_at_manila).toISOString().slice(0, 19) : '—'}`
        );
        console.log(
          `    last:  ${row.last_approved_at_manila ? new Date(row.last_approved_at_manila).toISOString().slice(0, 19) : '—'}`
        );
      }
    }
    console.log('');

    if (SHOW_DETAIL) {
      const detailResult = await client.query(
        `
          SELECT
            p.payment_id,
            p.invoice_id,
            p.branch_id,
            COALESCE(pb.branch_nickname, pb.branch_name) AS payment_branch_name,
            p.payment_method,
            p.reference_number,
            COALESCE(p.payable_amount, 0) + COALESCE(p.tip_amount, 0) AS line_total,
            TO_CHAR(p.issue_date, 'YYYY-MM-DD') AS payment_issue_date,
            TO_CHAR(TIMEZONE('Asia/Manila', p.approved_at), 'YYYY-MM-DD HH24:MI:SS') AS approved_at_manila,
            approver.user_id AS approver_user_id,
            approver.full_name AS approver_name,
            approver.email AS approver_email,
            approver.user_type AS approver_user_type,
            pay_student.full_name AS student_name
          FROM paymenttbl p
          INNER JOIN userstbl approver ON p.approved_by = approver.user_id
          LEFT JOIN branchestbl pb ON p.branch_id = pb.branch_id
          LEFT JOIN invoicestbl i ON p.invoice_id = i.invoice_id
          LEFT JOIN invoicestudentstbl ist ON i.invoice_id = ist.invoice_id
          LEFT JOIN userstbl pay_student ON ist.student_id = pay_student.user_id
          WHERE ${whereSql}
          ORDER BY p.approved_at DESC NULLS LAST, p.payment_id DESC
          LIMIT $${params.length + 1}
        `,
        [...params, DETAIL_LIMIT]
      );

      console.log(`--- Payment detail (latest ${DETAIL_LIMIT} max) ---`);
      if (!detailResult.rows.length) {
        console.log('(none)');
      } else {
        for (const row of detailResult.rows) {
          console.log('');
          console.log(
            `  payment_id=${row.payment_id} INV-${row.invoice_id ?? '?'} | ${row.payment_branch_name || 'branch ' + row.branch_id}`
          );
          console.log(
            `    student: ${row.student_name || '—'} | ${row.payment_method || '—'} | line ${Number(row.line_total || 0).toFixed(2)}`
          );
          console.log(
            `    issue_date: ${row.payment_issue_date || '—'} | ref: ${row.reference_number || '—'}`
          );
          console.log(
            `    approved_at (Manila): ${row.approved_at_manila || '—'}`
          );
          console.log(
            `    by: ${row.approver_name} <${row.approver_email || '—'}> [${row.approver_user_type}] user_id=${row.approver_user_id}`
          );
        }
      }
      console.log('');
    }

    console.log('Done.');
    console.log('');
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Script failed:', err.message || err);
  process.exit(1);
});
