import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const prog = await query(
  `SELECT program_id, program_name FROM programstbl WHERE program_name ILIKE '%kindergarten%' LIMIT 3`
);
console.log('Programs:', prog.rows);

const kindergartenProgramId = prog.rows[0]?.program_id;
const keys = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

const printRow = (label, matrix) => {
  const gabriel = matrix.students.find((s) => String(s.full_name || '').includes('Gabriel'));
  if (!gabriel) {
    console.log(`${label}: Gabriel not found (${matrix.students.length} rows)`);
    return;
  }
  const row = keys.map((k) => {
    const c = gabriel.months?.[k];
    return `${k.slice(5)}:${c?.mark === '1' ? c.label || c.status : '-'}`;
  });
  console.log(`${label}: ${gabriel.display_name}`);
  console.log(`  name-only: ${!String(gabriel.display_name).includes('—')}`);
  console.log(`  ${row.join(' | ')}`);
};

if (kindergartenProgramId) {
  const matrix = await loadStudentMonthEnrollmentMatrix(query, {
    year: 2026,
    programId: kindergartenProgramId,
  });
  printRow('Kindergarten program filter', matrix);
}

const matrixClass34 = await loadStudentMonthEnrollmentMatrix(query, { year: 2026, classId: 34 });
printRow('Lively Bees class filter', matrixClass34);

process.exit(0);
