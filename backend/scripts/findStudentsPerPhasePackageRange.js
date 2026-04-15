/**
 * Find students enrolled using a Phase package with a given phase range (e.g. phases 6–9).
 *
 * Data model:
 * - packagestbl: package_type = 'Phase', phase_start / phase_end define the covered phases
 * - installmentinvoiceprofilestbl: package_id + student_id + class_id (Phase + Installment enrollments)
 * - invoicestbl + invoicestudentstbl: package_id on invoice (e.g. Phase Fullpayment or enrollment invoices)
 *
 * Run from project root:
 *   node backend/scripts/findStudentsPerPhasePackageRange.js
 *   node backend/scripts/findStudentsPerPhasePackageRange.js --from 6 --to 9
 *   node backend/scripts/findStudentsPerPhasePackageRange.js --from 6 --to 9 --json
 *
 * Uses backend/.env via backend/config/loadEnv.js (same as other backend scripts).
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let phaseFrom = 6;
  let phaseTo = 9;
  let asJson = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') asJson = true;
    else if (a === '--from' && argv[i + 1]) {
      phaseFrom = parseInt(argv[++i], 10);
    } else if (a === '--to' && argv[i + 1]) {
      phaseTo = parseInt(argv[++i], 10);
    } else if (a === '--help' || a === '-h') {
      console.log(`
Usage: node backend/scripts/findStudentsPerPhasePackageRange.js [options]

  --from <n>   Package phase_start (default: 6)
  --to <n>     Package phase_end (default: 9)
  --json       Print machine-readable JSON only

Matches packages where package_type = 'Phase' AND phase_start = --from AND phase_end = --to.
Note: If phase_end is NULL in DB for a Phase package, it will not match a multi-phase range.
`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(phaseFrom) || !Number.isFinite(phaseTo) || phaseFrom < 1 || phaseTo < 1) {
    console.error('Invalid --from / --to (positive integers required).');
    process.exit(1);
  }
  if (phaseFrom > phaseTo) {
    console.error('--from must be <= --to');
    process.exit(1);
  }

  return { phaseFrom, phaseTo, asJson };
}

async function main() {
  const { phaseFrom, phaseTo, asJson } = parseArgs();

  const packagesRes = await query(
    `SELECT package_id, package_name, branch_id, package_type, payment_option,
            phase_start, phase_end, package_price, status
     FROM packagestbl
     WHERE package_type = 'Phase'
       AND phase_start = $1
       AND phase_end = $2
     ORDER BY package_id`,
    [phaseFrom, phaseTo]
  );

  if (!asJson) {
    console.log(`\nPhase packages with range Phase ${phaseFrom}–${phaseTo} (phase_start & phase_end exact):\n`);
    if (packagesRes.rows.length === 0) {
      console.log('  (none — no packagestbl rows match this range.)\n');
      const anyPhase = await query(
        `SELECT package_id, package_name, phase_start, phase_end, payment_option, status
         FROM packagestbl
         WHERE package_type = 'Phase'
           AND phase_start IS NOT NULL
         ORDER BY phase_start, phase_end NULLS LAST, package_id
         LIMIT 40`
      );
      if (anyPhase.rows.length === 0) {
        console.log('  No Phase packages found in packagestbl.\n');
      } else {
        console.log('  Phase packages in database (sample, up to 40):');
        for (const r of anyPhase.rows) {
          const end = r.phase_end != null ? r.phase_end : '(null)';
          console.log(
            `    id=${r.package_id} | ${r.package_name} | phases ${r.phase_start}–${end} | payment=${r.payment_option || '-'} | status=${r.status || '-'}`
          );
        }
        console.log('');
      }
    } else {
      for (const r of packagesRes.rows) {
        console.log(
          `  package_id=${r.package_id} | ${r.package_name} | payment_option=${r.payment_option || 'NULL'} | status=${r.status || '-'}`
        );
      }
      console.log('');
    }
  }

  const packageIds = packagesRes.rows.map((r) => r.package_id);
  if (packageIds.length === 0) {
    if (asJson) {
      console.log(JSON.stringify({ phaseFrom, phaseTo, packages: [], students: [] }, null, 2));
    } else {
      console.log('No matching packages — no students to list for this range.\n');
    }
    return;
  }

  const studentsRes = await query(
    `WITH pkg AS (
       SELECT package_id, package_name, phase_start, phase_end
       FROM packagestbl
       WHERE package_id = ANY($1::int[])
     ),
     from_profiles AS (
       SELECT
         ip.student_id AS user_id,
         ip.class_id,
         ip.installmentinvoiceprofiles_id AS profile_id,
         NULL::int AS invoice_id,
         ip.package_id,
         'installment_profile'::text AS link_source
       FROM installmentinvoiceprofilestbl ip
       INNER JOIN pkg ON pkg.package_id = ip.package_id
       WHERE ip.is_active = true
     ),
     from_invoices AS (
       SELECT
         ist.student_id AS user_id,
         NULL::int AS class_id,
         NULL::int AS profile_id,
         i.invoice_id,
         i.package_id,
         'invoice'::text AS link_source
       FROM invoicestbl i
       INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
       INNER JOIN pkg ON pkg.package_id = i.package_id
       WHERE i.package_id IS NOT NULL
     ),
     combined AS (
       SELECT * FROM from_profiles
       UNION ALL
       SELECT * FROM from_invoices
     )
     SELECT
       u.user_id,
       u.full_name,
       u.email,
       u.phone_number,
       x.class_id,
       c.class_name,
       br.branch_name,
       x.package_id,
       pkg.package_name,
       x.profile_id,
       x.invoice_id,
       x.link_source,
       cs.phase_number AS enrollment_phase_number,
       COALESCE(cs.enrollment_status, 'Active') AS enrollment_status
     FROM combined x
     INNER JOIN pkg ON pkg.package_id = x.package_id
     INNER JOIN userstbl u ON u.user_id = x.user_id
     LEFT JOIN classstudentstbl cs
       ON cs.student_id = x.user_id
       AND x.class_id IS NOT NULL
       AND cs.class_id = x.class_id
     LEFT JOIN classestbl c ON c.class_id = x.class_id
     LEFT JOIN branchestbl br ON br.branch_id = c.branch_id
     ORDER BY u.full_name, x.link_source, x.package_id, x.invoice_id NULLS LAST, x.class_id NULLS LAST`,
    [packageIds]
  );

  const rows = studentsRes.rows;
  const uniqueStudentIds = new Set(rows.map((r) => r.user_id));

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          phaseFrom,
          phaseTo,
          packages: packagesRes.rows,
          students: rows,
          rowCount: rows.length,
          uniqueStudentCount: uniqueStudentIds.size,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    `Students linked to these packages (installment profiles + invoices): ${rows.length} row(s), ${uniqueStudentIds.size} distinct student(s).\n`
  );
  if (rows.length === 0) {
    console.log('  (none — no installment profiles or invoices reference these package_id values.)\n');
    return;
  }

  for (const r of rows) {
    const parts = [
      `user_id=${r.user_id}`,
      r.full_name || '(no name)',
      r.email ? `<${r.email}>` : '',
      `package=${r.package_id} ${r.package_name || ''}`,
      r.link_source ? `[${r.link_source}]` : '',
      r.class_id != null ? `class_id=${r.class_id} ${r.class_name || ''}` : 'class=(see invoice only)',
      r.branch_name ? `branch=${r.branch_name}` : '',
      r.profile_id ? `profile=${r.profile_id}` : '',
      r.invoice_id ? `invoice=${r.invoice_id}` : '',
      r.enrollment_phase_number != null ? `enrollment_phase=${r.enrollment_phase_number}` : '',
      r.enrollment_status ? `status=${r.enrollment_status}` : '',
    ].filter(Boolean);
    console.log('  ', parts.join(' | '));
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
