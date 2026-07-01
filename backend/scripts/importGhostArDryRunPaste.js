/**
 * Parse INV-xxx + 6-digit AR# lines from a pasted dry-run export and write JSON backup.
 * Usage: node backend/scripts/importGhostArDryRunPaste.js --in=path/to/paste.txt --out=backend/scripts/.backups/ghost-ar-dry-run-full.json
 */

import fs from 'fs';
import path from 'path';

const inArg = process.argv.find((a) => a.startsWith('--in='));
const outArg = process.argv.find((a) => a.startsWith('--out='));
const inPath = inArg ? inArg.slice('--in='.length).trim() : '';
const outPath = outArg
  ? outArg.slice('--out='.length).trim()
  : 'backend/scripts/.backups/ghost-ar-dry-run-full.json';

if (!inPath) {
  console.error('Usage: --in=path/to/paste.txt [--out=backup.json]');
  process.exit(1);
}

const absIn = path.isAbsolute(inPath) ? inPath : path.resolve(process.cwd(), inPath);
const absOut = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath);

const raw = fs.readFileSync(absIn, 'utf8');
const map = new Map();

for (const line of raw.split(/\r?\n/)) {
  const m = line.trim().match(/^INV-(\d+)\s+(\d{6})\b/i);
  if (m) {
    map.set(Number(m[1]), m[2]);
  }
}

const rows = [...map.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([invoice_id, invoice_ar_number]) => ({ invoice_id, invoice_ar_number }));

fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(
  absOut,
  JSON.stringify({ exported_at: new Date().toISOString(), count: rows.length, rows }, null, 2),
  'utf8'
);

console.log(`Parsed ${rows.length} unique invoice AR mapping(s) from ${absIn}`);
console.log(`Wrote ${absOut}`);
console.log(`Restore: node backend/scripts/restoreInvoiceArNumbersFromBackup.js --file="${outPath}" --apply`);
