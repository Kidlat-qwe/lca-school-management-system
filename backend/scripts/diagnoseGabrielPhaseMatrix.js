import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentPhaseEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const prog = await query(
  `SELECT program_id, program_name FROM programstbl WHERE program_name ILIKE '%kindergarten%'`
);

const kindergartenProgramId = prog.rows.find((p) => p.program_name === 'Kindergarten')?.program_id;

const printGabriel = (label, matrix) => {
  const rows = matrix.students.filter((s) => String(s.full_name || '').includes('Gabriel'));
  console.log(`\n${label} (${rows.length} Gabriel rows):`);
  for (const row of rows) {
    const phases = [1, 2, 3, 4, 5]
      .map((p) => {
        const c = row.phases?.[p];
        return `P${p}:${c?.mark === '1' ? c.label || c.status : '-'}`;
      })
      .join(' | ');
    console.log(`  ${row.display_name}${row.matrix_upsell_track ? ' [upsell row]' : ''}`);
    console.log(`    ${phases}`);
  }
};

if (kindergartenProgramId) {
  const matrix = await loadStudentPhaseEnrollmentMatrix(query, {
    programId: kindergartenProgramId,
    maxPhase: 10,
  });
  printGabriel('Kindergarten program', matrix);
}

const matrixAll = await loadStudentPhaseEnrollmentMatrix(query, { maxPhase: 10 });
printGabriel('All programs', matrixAll);

process.exit(0);
