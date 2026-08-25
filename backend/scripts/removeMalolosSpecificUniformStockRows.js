/**
 * Delete specific Malolos School Uniform stock rows shown in ops screenshots
 * (2026-08-25) — not whole merchandise types.
 *
 * Targets (Vista Mall Malolos only):
 *   Female Blouse  M / XL / S / XS  (qty 50)
 *   Female Skirt   M                (qty 50, ₱500)
 *   Male Polo      M qty 1  ("Change inclusion to uniform")
 *   Male Polo      M qty 49 (₱99, Ops repair)
 *   Male Polo      S qty 51 ("PE uniform replacement")
 *   Male Short     S qty 51 ("pe uniform replacement")
 *   Male Short     M qty 1  ("Change bag to uniform")
 *
 * Each target must match exactly one merchandisestbl row or the script aborts.
 *
 * Usage (from backend/):
 *   node scripts/removeMalolosSpecificUniformStockRows.js --production
 *   node scripts/removeMalolosSpecificUniformStockRows.js --production --apply
 *
 * Default is dry-run unless --apply is passed.
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';

const BRANCH_NAME_FRAGMENT = 'Malolos';

/**
 * Fingerprints from Superadmin → Merchandise → View Stocks screenshots.
 * remarksContains: every fragment must appear in remarks (case-insensitive).
 */
const TARGETS = [
  {
    label: 'Female Blouse M qty50 ₱199',
    gender: 'Female',
    type: 'Blouse',
    size: 'M',
    quantity: 50,
    price: 199,
    remarksContains: ['Ops repair 2026-08-05'],
  },
  {
    label: 'Female Blouse XL qty50 Bag replacement',
    gender: 'Female',
    type: 'Blouse',
    size: 'XL',
    quantity: 50,
    price: 100,
    remarksContains: ['Bag replacement'],
  },
  {
    label: 'Female Blouse S qty50 Bag replacement',
    gender: 'Female',
    type: 'Blouse',
    size: 'S',
    quantity: 50,
    price: 100,
    remarksContains: ['Bag replacement'],
  },
  {
    label: 'Female Blouse XS qty50 Ops repair',
    gender: 'Female',
    type: 'Blouse',
    size: 'XS',
    quantity: 50,
    price: 100,
    remarksContains: ['Ops repair 2026-08-05'],
  },
  {
    label: 'Female Skirt M qty50 ₱500',
    gender: 'Female',
    type: 'Skirt',
    size: 'M',
    quantity: 50,
    price: 500,
    remarksContains: ['Ops repair 2026-08-05'],
  },
  {
    label: 'Male Polo M qty1 Change inclusion',
    gender: 'Male',
    type: 'Polo',
    size: 'M',
    quantity: 1,
    price: 100,
    remarksContains: ['Change inclusion to uniform'],
  },
  {
    label: 'Male Polo M qty49 ₱99 Ops repair',
    gender: 'Male',
    type: 'Polo',
    size: 'M',
    quantity: 49,
    price: 99,
    remarksContains: ['Ops repair 2026-08-05'],
  },
  {
    label: 'Male Polo S qty51 PE uniform replacement',
    gender: 'Male',
    type: 'Polo',
    size: 'S',
    quantity: 51,
    price: 100,
    remarksContains: ['PE uniform replacement'],
  },
  {
    label: 'Male Short S qty51 pe uniform replacement',
    gender: 'Male',
    type: 'Short',
    size: 'S',
    quantity: 51,
    price: 100,
    remarksContains: ['pe uniform replacement'],
  },
  {
    label: 'Male Short M qty1 Change bag to uniform',
    gender: 'Male',
    type: 'Short',
    size: 'M',
    quantity: 1,
    price: 100,
    remarksContains: ['Change bag to uniform'],
  },
];

const isApply = process.argv.includes('--apply');
const isDryRun = !isApply || process.argv.includes('--dry-run');

if (isApply && process.argv.includes('--dry-run')) {
  console.error('Use either --dry-run (default) or --apply, not both.');
  process.exit(1);
}

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function remarksMatch(remarks, fragments) {
  const r = norm(remarks);
  return (fragments || []).every((f) => r.includes(norm(f)));
}

async function resolveMalolos(client) {
  const matches = (
    await client.query(
      `
      SELECT branch_id, branch_name, branch_nickname
      FROM branchestbl
      WHERE branch_name ILIKE '%' || $1 || '%'
         OR COALESCE(branch_nickname, '') ILIKE '%' || $1 || '%'
      ORDER BY branch_id
      `,
      [BRANCH_NAME_FRAGMENT]
    )
  ).rows;
  if (matches.length === 0) {
    throw new Error(`No branch found matching "${BRANCH_NAME_FRAGMENT}"`);
  }
  if (matches.length > 1) {
    for (const b of matches) console.log(`  ${b.branch_id} — ${b.branch_name}`);
    throw new Error('Ambiguous Malolos branch — refine branchestbl names');
  }
  return matches[0];
}

async function main() {
  console.log(
    `\nMalolos specific uniform stock row removal` +
      `${isDryRun ? ' (DRY-RUN — no deletes)' : ' (APPLY — will DELETE)'}\n`
  );
  console.log(
    `DB_NAME=${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV || '(not set)'}`
  );
  console.log(`Targets: ${TARGETS.length} stock fingerprint(s)`);
  console.log('');

  const client = await getClient();
  try {
    const dbInfo = await client.query(
      `SELECT current_database() AS db, current_user AS db_user`
    );
    console.log('Connected:', dbInfo.rows[0]);

    const branch = await resolveMalolos(client);
    const branchId = Number(branch.branch_id);
    console.log(`Branch: ${branchId} — ${branch.branch_name}\n`);

    const stockRes = await client.query(
      `
      SELECT
        merchandise_id,
        merchandise_name,
        gender,
        type,
        size,
        quantity,
        price,
        remarks,
        branch_id
      FROM merchandisestbl
      WHERE branch_id = $1
      ORDER BY merchandise_id
      `,
      [branchId]
    );

    const matched = [];
    const problems = [];

    for (const t of TARGETS) {
      const hits = stockRes.rows.filter((r) => {
        if (norm(r.gender) !== norm(t.gender)) return false;
        if (norm(r.type) !== norm(t.type)) return false;
        if (norm(r.size) !== norm(t.size)) return false;
        if (Number(r.quantity ?? 0) !== Number(t.quantity)) return false;
        if (Number(r.price) !== Number(t.price)) return false;
        if (!remarksMatch(r.remarks, t.remarksContains)) return false;
        return true;
      });

      if (hits.length === 0) {
        problems.push(`NO MATCH: ${t.label}`);
        continue;
      }
      if (hits.length > 1) {
        problems.push(
          `AMBIGUOUS (${hits.length}): ${t.label} → ids ${hits.map((h) => h.merchandise_id).join(', ')}`
        );
        continue;
      }

      matched.push({ target: t, row: hits[0] });
    }

    if (problems.length) {
      console.log('=== Match problems ===');
      for (const p of problems) console.log(`  ${p}`);
      console.log('');
    }

    if (matched.length === 0) {
      console.log('No rows matched. Nothing to delete.');
      return;
    }

    console.log(`=== Matched rows: ${matched.length} / ${TARGETS.length} ===`);
    console.table(
      matched.map(({ target, row }) => ({
        merchandise_id: row.merchandise_id,
        merchandise_name: row.merchandise_name,
        gender: row.gender,
        type: row.type,
        size: row.size,
        quantity: Number(row.quantity ?? 0),
        price: row.price,
        remarks: String(row.remarks || '').slice(0, 60),
        fingerprint: target.label,
      }))
    );

    if (problems.length) {
      throw new Error(
        'Aborting — every screenshot row must match exactly one DB row. Fix mismatches first.'
      );
    }

    const ids = matched.map(({ row }) => Number(row.merchandise_id));

    const packageDetails = await client.query(
      `SELECT COUNT(*)::int AS n FROM packagedetailstbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const promoLinks = await client.query(
      `SELECT COUNT(*)::int AS n FROM promomerchandisetbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const releaseLogs = await client.query(
      `SELECT COUNT(*)::int AS n FROM merchandise_release_logtbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const requestLinks = await client.query(
      `SELECT COUNT(*)::int AS n FROM merchandiserequestlogtbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );

    console.log('\nFK blockers / related:');
    console.log(`  packagedetailstbl to DELETE: ${packageDetails.rows[0].n}`);
    console.log(`  promomerchandisetbl to DELETE: ${promoLinks.rows[0].n}`);
    console.log(`  merchandise_release_logtbl to DELETE: ${releaseLogs.rows[0].n}`);
    console.log(
      `  merchandiserequestlogtbl.merchandise_id → NULL: ${requestLinks.rows[0].n}`
    );

    if (isDryRun) {
      console.log('\nDry-run complete — no changes written.');
      console.log(
        '  node scripts/removeMalolosSpecificUniformStockRows.js --production --apply'
      );
      return;
    }

    await client.query('BEGIN');

    const pkgDel = await client.query(
      `DELETE FROM packagedetailstbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const promoDel = await client.query(
      `DELETE FROM promomerchandisetbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const releaseDel = await client.query(
      `DELETE FROM merchandise_release_logtbl WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const reqNull = await client.query(
      `UPDATE merchandiserequestlogtbl SET merchandise_id = NULL WHERE merchandise_id = ANY($1::int[])`,
      [ids]
    );
    const merchDel = await client.query(
      `
      DELETE FROM merchandisestbl
      WHERE branch_id = $1
        AND merchandise_id = ANY($2::int[])
      `,
      [branchId, ids]
    );

    await client.query('COMMIT');

    console.log('\n=== APPLY complete ===');
    console.log(`  packagedetailstbl deleted: ${pkgDel.rowCount}`);
    console.log(`  promomerchandisetbl deleted: ${promoDel.rowCount}`);
    console.log(`  merchandise_release_logtbl deleted: ${releaseDel.rowCount}`);
    console.log(`  merchandiserequestlogtbl nulled: ${reqNull.rowCount}`);
    console.log(`  merchandisestbl deleted: ${merchDel.rowCount}`);
    console.log(
      '\nRefresh Merchandise → Malolos → School Uniform (View Stocks). Those rows should be gone.'
    );
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\nremoveMalolosSpecificUniformStockRows failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
