import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';
import { fetchMonthMatrixReEnrollmentBreakdown } from '../../utils/monthMatrixReEnrollmentBreakdown';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import OperationalReEnrolledStudentsModal from './OperationalReEnrolledStudentsModal';

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');
const formatRate = (value) => `${(Number(value) || 0).toFixed(2)}%`;

const PAYMENT_BREAKDOWN_RATE_FORMULA =
  'Rate = Students re-enrolled ÷ Retention base × 100';

const MONTH_MATRIX_BREAKDOWN_RATE_FORMULA =
  'Rate = Students re-enrolled ÷ Retention base × 100 (enrollment month — same rules as Month Re-enrollment dashboard, not payment issue date).';

const computeBreakdownReEnrollmentRate = (row) => {
  const reEnrolled =
    Number(row?.re_enrolled_student_count ?? row?.re_enrollment_kpi_count) || 0;
  const retentionBase = Number(row?.retention_base_count) || 0;
  if (retentionBase <= 0) return 0;
  return (reEnrolled / retentionBase) * 100;
};

const OperationalReEnrollmentRateTable = ({
  breakdown = null,
  tooltip = '',
  emptyMessage = 'No re-enrollment rate breakdown available.',
  periodMode = 'daily',
  summaryDate = '',
  summaryMonth = '',
  branchRows = [],
  branchFilterId = '',
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [monthMatrixBreakdown, setMonthMatrixBreakdown] = useState(null);
  const [monthMatrixLoading, setMonthMatrixLoading] = useState(false);
  const [monthMatrixError, setMonthMatrixError] = useState('');

  const isMonthlyEnrollmentMode = periodMode === 'monthly';

  const branchScopeKey = useMemo(
    () =>
      (branchRows || [])
        .map((b) => b.branch_id)
        .filter((id) => id != null)
        .sort((a, b) => Number(a) - Number(b))
        .join(','),
    [branchRows]
  );

  useEffect(() => {
    if (!isMonthlyEnrollmentMode || !summaryMonth) {
      setMonthMatrixBreakdown(null);
      setMonthMatrixError('');
      setMonthMatrixLoading(false);
      return undefined;
    }

    let cancelled = false;
    setMonthMatrixLoading(true);
    setMonthMatrixError('');

    fetchMonthMatrixReEnrollmentBreakdown(apiRequest, {
      summaryMonth,
      branchRows,
      branchFilterId,
    })
      .then((result) => {
        if (cancelled) return;
        setMonthMatrixBreakdown(result);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Month matrix re-enrollment breakdown error:', err);
        setMonthMatrixBreakdown(null);
        setMonthMatrixError(err?.message || 'Failed to load enrollment-month breakdown.');
      })
      .finally(() => {
        if (!cancelled) setMonthMatrixLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isMonthlyEnrollmentMode, summaryMonth, branchScopeKey, branchFilterId]);

  const activeBreakdown = useMemo(() => {
    if (isMonthlyEnrollmentMode) return monthMatrixBreakdown;
    return breakdown;
  }, [isMonthlyEnrollmentMode, monthMatrixBreakdown, breakdown]);

  const rows = activeBreakdown?.rows || [];
  const totals = activeBreakdown?.totals || null;
  const priorLabel = activeBreakdown?.prior_period_label;
  const rateFormula = isMonthlyEnrollmentMode
    ? MONTH_MATRIX_BREAKDOWN_RATE_FORMULA
    : PAYMENT_BREAKDOWN_RATE_FORMULA;

  const openBranchModal = (row) => {
    setSelectedBranch(row);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedBranch(null);
  };

  if (monthMatrixLoading) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
        <p className="flex items-center gap-0.5 text-sm font-semibold text-gray-700">
          <span>Re-enrollment rate breakdown</span>
          {tooltip ? (
            <MatrixInfoTooltip label="About re-enrollment rate breakdown">{tooltip}</MatrixInfoTooltip>
          ) : null}
        </p>
        <div className="mt-6 flex min-h-[120px] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
        </div>
      </div>
    );
  }

  if (monthMatrixError) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
        <p className="flex items-center gap-0.5 text-sm font-semibold text-gray-700">
          <span>Re-enrollment rate breakdown</span>
          {tooltip ? (
            <MatrixInfoTooltip label="About re-enrollment rate breakdown">{tooltip}</MatrixInfoTooltip>
          ) : null}
        </p>
        <p className="mt-3 text-sm text-red-600">{monthMatrixError}</p>
      </div>
    );
  }

  if (!rows.length && !totals) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
        <p className="flex items-center gap-0.5 text-sm font-semibold text-gray-700">
          <span>Re-enrollment rate breakdown</span>
          {tooltip ? (
            <MatrixInfoTooltip label="About re-enrollment rate breakdown">{tooltip}</MatrixInfoTooltip>
          ) : null}
        </p>
        <p className="mt-3 text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  const tableRows = totals ? [...rows, totals] : rows;

  return (
    <>
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="flex flex-wrap items-center gap-0.5 text-sm font-semibold text-gray-700">
              <span>Re-enrollment rate breakdown</span>
              {tooltip ? (
                <MatrixInfoTooltip label="About re-enrollment rate breakdown">{tooltip}</MatrixInfoTooltip>
              ) : null}
            </p>
            {priorLabel ? (
              <p className="mt-1 text-xs text-gray-500">Prior period: {priorLabel}</p>
            ) : null}
            <p className="mt-1 text-xs text-gray-500">{rateFormula}</p>
            <p className="mt-1 text-xs text-indigo-600">Click a branch row to view re-enrolled students.</p>
          </div>
        </div>

        <div
          className="overflow-x-auto rounded-lg"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#cbd5e0 #f7fafc',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <table style={{ width: '100%', minWidth: '560px' }} className="border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2.5">Branch</th>
                <th className="px-3 py-2.5 text-right">Students re-enrolled</th>
                <th className="px-3 py-2.5 text-right">Retention base</th>
                <th className="px-3 py-2.5 text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, index) => {
                const isTotal = totals && index === tableRows.length - 1;
                const studentCount =
                  row.re_enrolled_student_count ?? row.re_enrollment_kpi_count ?? 0;
                const displayRate = computeBreakdownReEnrollmentRate(row);

                return (
                  <tr
                    key={`${row.branch_id ?? 'total'}-${row.branch_name}-${index}`}
                    className={`border-b border-gray-100 ${isTotal ? 'bg-amber-50/60 font-semibold' : 'hover:bg-gray-50'} cursor-pointer`}
                    onClick={() => openBranchModal(row)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openBranchModal(row);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View re-enrolled students for ${row.branch_name || 'branch'}`}
                  >
                    <td className="px-3 py-2.5 text-gray-900">
                      <span className="text-indigo-700 underline-offset-2 hover:underline">
                        {row.branch_name || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(studentCount)}</td>
                    <td className="px-3 py-2.5 text-right text-gray-700">
                      {formatNumber(row.retention_base_count)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-indigo-700">
                      {formatRate(displayRate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <OperationalReEnrolledStudentsModal
        open={modalOpen}
        onClose={closeModal}
        periodMode={periodMode}
        summaryDate={summaryDate}
        summaryMonth={summaryMonth}
        branchId={selectedBranch?.branch_id ?? ''}
        branchName={selectedBranch?.branch_name ?? ''}
        cardStudentCount={selectedBranch?.re_enrolled_student_count ?? 0}
      />
    </>
  );
};

export default OperationalReEnrollmentRateTable;
