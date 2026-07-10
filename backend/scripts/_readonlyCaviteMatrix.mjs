import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { loadMonthlyOperationalEnrollmentFromMonthMatrix } from '../lib/enrollmentRateMetrics.js';
import { loadStudentMonthEnrollmentMatrix } from '../lib/enrollmentRateMetrics.js';

const branchId = 3;
for (const month of ['2026-07', '2024-07', '2025-07']) {
  const ops = await loadMonthlyOperationalEnrollmentFromMonthMatrix(query, { branchId, summaryMonth: month, branches: [{ branch_id: branchId }] });
  const matrix = await loadStudentMonthEnrollmentMatrix(query, { branchId, year: parseInt(month.slice(0,4),10) });
  const monthKey = month;
  const unique = new Set();
  for (const s of matrix?.students || []) {
    if (s.months?.[monthKey]?.label) unique.add(s.student_id);
  }
  const totalActive = (ops.new_enrollees||0) + (ops.re_enrollment_count||0) + (ops.rejoin_count||0);
  console.log(JSON.stringify({
    month,
    matrix_kpi: {
      new_enrollees: ops.new_enrollees,
      re_enrollment_count: ops.re_enrollment_count,
      rejoin_count: ops.rejoin_count,
      upsell_count: ops.upsell_count,
      dropped: ops.dropped_unenrolled_count,
      total_active_students_card: totalActive,
    },
    unique_students_with_any_july_label: unique.size,
    cohort_size: matrix?.cohort_size,
  }));
}
