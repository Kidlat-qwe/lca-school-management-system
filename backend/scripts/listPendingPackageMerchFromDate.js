/**
 * Display Merchandise → Pending Issue rows (read-only).
 *
 * Same source as GET /merchandise/package-pending, filtered to enrollments /
 * invoice issue dates on or after a Manila calendar day (default: 2026-08-21).
 *
 * Usage:
 *   node backend/scripts/listPendingPackageMerchFromDate.js
 *   node backend/scripts/listPendingPackageMerchFromDate.js --from=2026-08-21
 *   node backend/scripts/listPendingPackageMerchFromDate.js --from=2026-08-21 --branch-id=6
 *   node backend/scripts/listPendingPackageMerchFromDate.js --oos-only
 *
 * Display only — does not issue or mutate stock.
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import {
  listPendingPackageMerch,
  PACKAGE_MERCH_PENDING_ISSUE_CUTOFF_YMD,
} from '../lib/packageMerchFulfillment/index.js';

const DEFAULT_FROM_YMD = PACKAGE_MERCH_PENDING_ISSUE_CUTOFF_YMD;

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function toManilaYmd(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatDisplayDate(value) {
  const ymd = toManilaYmd(value);
  if (!ymd) return '—';
  const [y, m, day] = ymd.split('-').map(Number);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${months[m - 1]} ${day}, ${y}`;
}

const fromYmd = String(argValue('from') || DEFAULT_FROM_YMD).trim();
const branchIdArg = argValue('branch-id');
const oosOnly = process.argv.includes('--oos-only');

if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd)) {
  console.error('Invalid --from=YYYY-MM-DD');
  process.exit(1);
}

const branchId =
  branchIdArg != null && branchIdArg !== ''
    ? Number(branchIdArg)
    : null;
if (branchIdArg != null && (!Number.isInteger(branchId) || branchId < 1)) {
  console.error('Invalid --branch-id= (positive integer)');
  process.exit(1);
}

async function main() {
  console.log('\nPending Issue — display report');
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  console.log(`From (Manila YMD): ${fromYmd}${oosOnly ? ' | OOS only' : ''}`);
  console.log(
    branchId != null ? `Branch filter: ${branchId}` : 'Branch filter: all branches'
  );

  const client = await getClient();
  try {
    const all = await listPendingPackageMerch(client, {
      branchId: branchId != null ? branchId : undefined,
    });

    const filtered = all.filter((item) => {
      const ymd =
        toManilaYmd(item.enrolled_at) || toManilaYmd(item.invoice_issue_date);
      if (!ymd || ymd < fromYmd) return false;
      if (oosOnly && Number(item.available_quantity) > 0) return false;
      return true;
    });

    console.log(
      `\nAPI pending total (cutoff ${PACKAGE_MERCH_PENDING_ISSUE_CUTOFF_YMD}): ${all.length}` +
        ` | Matching from ${fromYmd}: ${filtered.length}\n`
    );

    if (filtered.length === 0) {
      console.log('No pending-issue rows in this window.');
      return;
    }

    console.table(
      filtered.map((item, idx) => ({
        '#': idx + 1,
        student: item.student_name,
        class: item.class_name || '—',
        branch: item.branch_name || '—',
        item: item.merchandise_name || '—',
        size: item.size || item.category || '—',
        stock: item.available_quantity,
        payment: item.has_first_payment ? 'Paid' : 'Unpaid',
        enrolled: formatDisplayDate(item.enrolled_at || item.invoice_issue_date),
        can_issue: item.can_issue ? 'Yes' : 'No',
        block: item.block_reason || '—',
        invoice_id: item.invoice_id,
        student_id: item.student_id,
      }))
    );

    const oos = filtered.filter((i) => Number(i.available_quantity) <= 0).length;
    const ready = filtered.filter((i) => i.can_issue).length;
    console.log('\n------------------------------------------------------------');
    console.log(`Total: ${filtered.length} | Out of stock: ${oos} | Ready to issue: ${ready}`);
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Failed:', err?.message || err);
    process.exit(1);
  });
