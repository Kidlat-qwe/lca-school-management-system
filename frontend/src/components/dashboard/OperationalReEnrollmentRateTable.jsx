import { useState } from 'react';
import MatrixInfoTooltip from './MatrixInfoTooltip';
import OperationalReEnrolledStudentsModal from './OperationalReEnrolledStudentsModal';

const formatNumber = (value) => (Number(value) || 0).toLocaleString('en-PH');
const formatRate = (value) => `${(Number(value) || 0).toFixed(2)}%`;

const OperationalReEnrollmentRateTable = ({
  breakdown = null,
  tooltip = '',
  emptyMessage = 'No re-enrollment rate breakdown available.',
  periodMode = 'daily',
  summaryDate = '',
  summaryMonth = '',
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(null);

  const rows = breakdown?.rows || [];
  const totals = breakdown?.totals || null;
  const priorLabel = breakdown?.prior_period_label;
  const formula = breakdown?.formula;

  const openBranchModal = (row) => {
    setSelectedBranch(row);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedBranch(null);
  };

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
            {formula ? (
              <p className="mt-1 text-xs text-gray-500">{formula}</p>
            ) : null}
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
                      {formatRate(row.re_enrollment_rate)}
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
