/**
 * Find invoices that appear on the Acknowledgement Receipt (AR) page as
 * "Invoice payment (no AR record)" in Package / Items — synthetic rows from
 * invoicestbl.invoice_ar_number without a matching acknowledgement_receiptstbl row.
 *
 * Default: list only (--dry-run).
 * --apply: clears invoice_ar_number on those invoices so they no longer appear
 *          on the AR page (payments and invoices are kept).
 *
 * Optional filters:
 *   --branch-id=1
 *   --issue-from=2026-06-01
 *   --issue-to=2026-06-30
 *   --invoice-id=1369
 *   --limit=50
 *
 * Run from project root:
 *   node backend/scripts/findAndClearInvoiceOnlyArGhostRows.js
 *   node backend/scripts/findAndClearInvoiceOnlyArGhostRows.js --apply
 *   node backend/scripts/findAndClearInvoiceOnlyArGhostRows.js --export=path/to/backup.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { fetchAllInvoiceOnlyArListCandidates } from '../utils/arInvoiceOnlyListRows.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, '.backups');

const isApply = process.argv.includes('--apply');
const isDryRun = !isApply || process.argv.includes('--dry-run');
const exportArg = process.argv.find((a) => a.startsWith('--export='));
const exportPath = exportArg ? exportArg.slice('--export='.length).trim() : '';

const parseArg = (prefix) => {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1).trim() : '';
};

const branchIdRaw = parseArg('--branch-id');
const issueFrom = parseArg('--issue-from').slice(0, 10);
const issueTo = parseArg('--issue-to').slice(0, 10);
const invoiceIdRaw = parseArg('--invoice-id');
const limitRaw = parseArg('--limit');

const branchId = branchIdRaw ? Number(branchIdRaw) : null;
const invoiceId = invoiceIdRaw ? Number(invoiceIdRaw) : null;
const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10)) : null;

const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function formatMoney(n) {
  return `₱${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatYmd(value) {
  if (value == null || value === '') return '—';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
}

async function main() {
  const filters = {
    branchId: Number.isFinite(branchId) ? branchId : null,
    issueFrom: ymdOk(issueFrom) ? issueFrom : null,
    issueTo: ymdOk(issueTo) ? issueTo : null,
    invoiceId: Number.isFinite(invoiceId) ? invoiceId : null,
  };

  let rows = await fetchAllInvoiceOnlyArListCandidates(filters);
  if (limit != null) {
    rows = rows.slice(0, limit);
  }

  console.log(
    isApply
      ? '=== APPLY: clear invoice_ar_number on ghost AR list rows ==='
      : '=== DRY RUN: invoice-only AR ghost rows (Package/Items: "Invoice payment (no AR record)") ==='
  );
  console.log('Filters:', JSON.stringify(filters));
  console.log(`Found ${rows.length} invoice(s).\n`);

  if (rows.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const header = [
    'INVOICE',
    'AR#',
    'STUDENT',
    'BRANCH',
    'STATUS',
    'LINE TOTAL',
    'PAYMENT DATE',
    'PAYMENT METHOD',
    'REF#',
  ];
  console.log(header.join('\t'));

  for (const row of rows) {
    console.log(
      [
        row.linked_invoice_id != null ? `INV-${row.linked_invoice_id}` : '—',
        row.invoice_ar_number || '—',
        row.student_name || row.prospect_student_name || '—',
        row.branch_name || row.branch_id || '—',
        row.status || '—',
        formatMoney(row.list_line_total_amount ?? row.payment_amount),
        formatYmd(row.payment_date || row.issue_date),
        row.payment_method || '—',
        row.reference_number || '—',
      ].join('\t')
    );
  }

  const totalLine = rows.reduce(
    (sum, row) => sum + (Number(row.list_line_total_amount ?? row.payment_amount ?? 0) || 0),
    0
  );
  console.log(`\nTotal line amount (listed): ${formatMoney(totalLine)}`);

  const backupRows = rows
    .map((row) => ({
      invoice_id: Number(row.linked_invoice_id),
      invoice_ar_number: String(row.invoice_ar_number || '').trim(),
      student_name: row.student_name || row.prospect_student_name || null,
      branch_name: row.branch_name || null,
      status: row.status || null,
    }))
    .filter((row) => Number.isFinite(row.invoice_id) && row.invoice_id > 0 && row.invoice_ar_number);

  if (exportPath) {
    const absExport = path.isAbsolute(exportPath)
      ? exportPath
      : path.resolve(process.cwd(), exportPath);
    fs.mkdirSync(path.dirname(absExport), { recursive: true });
    fs.writeFileSync(
      absExport,
      JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          count: backupRows.length,
          rows: backupRows,
        },
        null,
        2
      ),
      'utf8'
    );
    console.log(`\nExported ${backupRows.length} row(s) to ${absExport}`);
  }

  if (isDryRun) {
    console.log('\nDry run only. Re-run with --apply to clear invoice_ar_number on these invoices.');
    if (!exportPath) {
      console.log('Tip: add --export=backend/scripts/.backups/ghost-ar-before-clear.json before --apply.');
    }
    return;
  }

  const invoiceIds = [...new Set(backupRows.map((row) => row.invoice_id))];

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(BACKUP_DIR, `invoice-ar-ghost-clear-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        cleared_at: new Date().toISOString(),
        count: backupRows.length,
        rows: backupRows,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`\nBackup written: ${backupPath}`);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE invoicestbl
       SET invoice_ar_number = NULL
       WHERE invoice_id = ANY($1::int[])
         AND invoice_ar_number IS NOT NULL`,
      [invoiceIds]
    );

    await client.query('COMMIT');

    console.log(`\nCleared invoice_ar_number on ${updateRes.rowCount} invoice(s).`);
    console.log('These rows will no longer appear as "Invoice payment (no AR record)" on the AR page.');
    console.log('Payments and invoice records were not deleted.');
    console.log(
      `To undo: node backend/scripts/restoreInvoiceArNumbersFromBackup.js --file="${backupPath}" --apply`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
