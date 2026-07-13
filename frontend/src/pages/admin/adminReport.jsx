import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import FixedTablePagination, { TablePaginationSummary } from '../../components/table/FixedTablePagination';
import StatusLegend from '../../components/reports/StatusLegend';
import StandardExportModal from '../../components/export/StandardExportModal';
import {
  formatProgramEnrollmentStatus,
  PROGRAM_ENROLLMENT_STATUS_FILTER_OPTIONS,
  programEnrollmentStatusBadgeClass,
} from '../../utils/programEnrollmentStatus';
import {
  downloadStudentStatusExportXlsx,
  STUDENT_STATUS_EXPORT_OPTIONS,
} from '../../utils/studentStatusExcelExport';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { formatDateTimeManila } from '../../utils/dateUtils';

const TAB_STUDENT_STATUS = 'student_status';
const TAB_PROGRAM_PAYMENT_STATUS = 'program_payment_status';
const TAB_PROGRAM_ENROLLMENT_STATUS = 'program_enrollment_status';

const currentManilaMonthKey = () => {
  const manila = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  return `${manila.getFullYear()}-${String(manila.getMonth() + 1).padStart(2, '0')}`;
};

const CURRENT_MONTH = currentManilaMonthKey();

const REPORT_TABS = [
  { id: TAB_STUDENT_STATUS, label: 'Student Status' },
  { id: TAB_PROGRAM_PAYMENT_STATUS, label: 'Program Payment Status' },
  { id: TAB_PROGRAM_ENROLLMENT_STATUS, label: 'Program Enrollment Status' },
];

const TAB_CONFIG = {
  [TAB_STUDENT_STATUS]: {
    endpoint: '/reports/student-status',
    title: 'Report - Student Status',
    description:
      'Active/inactive per billing month using Month Re-enrollment matrix rules (new + re-enrolled + rejoin + upsell), same as Monthly Operational Dashboard.',
    itemLabel: 'students',
    statusOptions: [
      { value: 'all', label: 'All' },
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ],
  },
  [TAB_PROGRAM_PAYMENT_STATUS]: {
    endpoint: '/reports/program-payment-status',
    title: 'Report - Program Payment Status',
    description: 'Rows from program_payment_statustbl.',
    itemLabel: 'payment statuses',
    statusOptions: [
      { value: 'all', label: 'All' },
      { value: 'wait_for_payment', label: 'Wait for payment' },
      { value: 'paid', label: 'Paid' },
      { value: 'under_grace_period', label: 'Under grace period' },
      { value: 'due_date', label: 'Due date' },
    ],
  },
  [TAB_PROGRAM_ENROLLMENT_STATUS]: {
    endpoint: '/reports/program-enrollment-status',
    title: 'Report - Program Enrollment Status',
    description: 'Rows from classstudentstbl using program_enrollment_status.',
    itemLabel: 'enrollment rows',
    statusOptions: PROGRAM_ENROLLMENT_STATUS_FILTER_OPTIONS,
  },
};

const formatDateTime = (value) => formatDateTimeManila(value, { hour12: true });

const statusBadgeClass = (value) => {
  const v = String(value || '').toLowerCase();
  if (['active', 'paid', 'completed', 'new', 're_enrolled', 'upsell', 'rejoin'].includes(v)) return 'bg-green-100 text-green-800';
  if (['wait_for_payment', 'pending_enrollment', 'under_grace_period', 'reserved'].includes(v)) return 'bg-amber-100 text-amber-800';
  if (['inactive', 'dropped', 'due_date'].includes(v)) return 'bg-gray-100 text-gray-800';
  return 'bg-slate-100 text-slate-800';
};

const parseReportLocationSearch = (search) => {
  const params = new URLSearchParams(search);
  const tabParam = params.get('tab');
  const tab =
    tabParam === TAB_PROGRAM_ENROLLMENT_STATUS
      ? TAB_PROGRAM_ENROLLMENT_STATUS
      : tabParam === TAB_PROGRAM_PAYMENT_STATUS
        ? TAB_PROGRAM_PAYMENT_STATUS
        : TAB_STUDENT_STATUS;
  return {
    tab,
    phaseNumber: params.get('phase_number') || '',
    enrolledDateFrom: params.get('enrolled_date_from') || '',
    enrolledDateTo: params.get('enrolled_date_to') || '',
    enrolledOnly: params.get('enrolled_only') === '1',
  };
};

const AdminReport = () => {
  const location = useLocation();
  const urlBootstrap = parseReportLocationSearch(location.search);
  const [tab, setTab] = useState(urlBootstrap.tab);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnceRef = useRef(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPhaseNumber, setFilterPhaseNumber] = useState(urlBootstrap.phaseNumber);
  const [filterEnrolledDateFrom, setFilterEnrolledDateFrom] = useState(urlBootstrap.enrolledDateFrom);
  const [filterEnrolledDateTo, setFilterEnrolledDateTo] = useState(urlBootstrap.enrolledDateTo);
  const [filterEnrolledOnly, setFilterEnrolledOnly] = useState(urlBootstrap.enrolledOnly);
  const [filterSummaryMonth, setFilterSummaryMonth] = useState(CURRENT_MONTH);
  const [reportMeta, setReportMeta] = useState(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStatusScope, setExportStatusScope] = useState('all');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');

  const config = TAB_CONFIG[tab];

  useEffect(() => {
    const parsed = parseReportLocationSearch(location.search);
    setTab(parsed.tab);
    if (parsed.phaseNumber) setFilterPhaseNumber(parsed.phaseNumber);
    if (parsed.enrolledDateFrom) setFilterEnrolledDateFrom(parsed.enrolledDateFrom);
    if (parsed.enrolledDateTo) setFilterEnrolledDateTo(parsed.enrolledDateTo);
    setFilterEnrolledOnly(parsed.enrolledOnly);
  }, [location.search]);

  useEffect(() => {
    if (tab === TAB_STUDENT_STATUS) {
      setFilterSummaryMonth((prev) => prev || CURRENT_MONTH);
    }
  }, [tab]);

  useEffect(() => {
    setFilterStatus('all');
    setSearchTerm('');
    setRows([]);
    setReportMeta(null);
    setPagination((p) => ({ ...p, page: 1 }));
    hasLoadedOnceRef.current = false;
    setLoading(true);
  }, [tab]);

  const fetchRows = async (page = 1) => {
    try {
      if (!hasLoadedOnceRef.current) setLoading(true);
      const params = new URLSearchParams({
        status: filterStatus,
        page: String(page),
        limit: String(pagination.limit),
      });
      if (debouncedSearchTerm.trim()) params.set('search', debouncedSearchTerm.trim());
      if (tab === TAB_PROGRAM_ENROLLMENT_STATUS) {
        if (filterPhaseNumber) params.set('phase_number', filterPhaseNumber);
        if (filterEnrolledDateFrom) params.set('enrolled_date_from', filterEnrolledDateFrom);
        if (filterEnrolledDateTo) params.set('enrolled_date_to', filterEnrolledDateTo);
        if (filterEnrolledOnly) params.set('enrolled_only', '1');
      }
      if (tab === TAB_STUDENT_STATUS && filterSummaryMonth) {
        params.set('summary_month', filterSummaryMonth);
      }
      const response = await apiRequest(`${config.endpoint}?${params.toString()}`);
      setRows(response.data || []);
      setReportMeta(tab === TAB_STUDENT_STATUS ? response.meta || null : null);
      if (response.pagination) {
        setPagination((prev) => ({
          ...prev,
          page: response.pagination.page,
          limit: response.pagination.limit,
          total: response.pagination.total,
          totalPages: response.pagination.totalPages ?? 1,
        }));
      }
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load report.');
      setRows([]);
    } finally {
      if (!hasLoadedOnceRef.current) {
        setLoading(false);
        hasLoadedOnceRef.current = true;
      }
    }
  };

  useEffect(() => {
    fetchRows(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    filterStatus,
    debouncedSearchTerm,
    filterPhaseNumber,
    filterEnrolledDateFrom,
    filterEnrolledDateTo,
    filterEnrolledOnly,
    filterSummaryMonth,
  ]);

  const openExportModal = () => {
    setExportStatusScope(
      filterStatus === 'active' || filterStatus === 'inactive' ? filterStatus : 'all'
    );
    setExportError('');
    setShowExportModal(true);
  };

  const fetchAllStudentStatusRowsForExport = async (statusScope) => {
    const pageLimit = 100;
    let page = 1;
    let totalPages = 1;
    const allRows = [];

    while (page <= totalPages) {
      const params = new URLSearchParams({
        status: statusScope,
        page: String(page),
        limit: String(pageLimit),
      });
      if (debouncedSearchTerm.trim()) params.set('search', debouncedSearchTerm.trim());
      if (filterSummaryMonth) params.set('summary_month', filterSummaryMonth);

      const response = await apiRequest(`/reports/student-status?${params.toString()}`);
      allRows.push(...(response.data || []));
      totalPages = Math.max(1, Number(response.pagination?.totalPages) || 1);
      page += 1;
      if (page > 200) break;
    }
    return allRows;
  };

  const handleExportStudentStatus = async () => {
    try {
      setExportLoading(true);
      setExportError('');
      const exportRows = await fetchAllStudentStatusRowsForExport(exportStatusScope);
      if (!exportRows.length) {
        setExportError('No students found for the selected export scope.');
        return;
      }
      const scopeLabel =
        exportStatusScope === 'active'
          ? 'active'
          : exportStatusScope === 'inactive'
            ? 'inactive'
            : 'all';
      downloadStudentStatusExportXlsx(
        exportRows,
        `Student_Status_${scopeLabel}_${filterSummaryMonth || 'month'}.xlsx`,
        {
          summaryMonth: filterSummaryMonth,
          statusScope: exportStatusScope,
        }
      );
      setShowExportModal(false);
    } catch (err) {
      setExportError(err.message || 'Failed to export Student Status report.');
    } finally {
      setExportLoading(false);
    }
  };

  const table = useMemo(() => {
    if (tab === TAB_STUDENT_STATUS) {
      return {
        minWidth: '880px',
        headers: ['Name', 'Email', 'Level Tag', 'Status', 'Matrix Labels', 'Updated At'],
        render: (row) => (
          <>
            <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{row.full_name || '-'}</td>
            <td className="px-4 py-3 text-sm text-gray-600 truncate" title={row.email || '-'}>
              {row.email || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.level_tag || '-'}</td>
            <td className="px-4 py-3 whitespace-nowrap">
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeClass(row.status)}`}>
                {row.status || '-'}
              </span>
            </td>
            <td className="px-4 py-3 text-sm text-gray-600 max-w-[220px]" title={row.matrix_labels || '-'}>
              <span className="truncate block">{row.matrix_labels || '—'}</span>
            </td>
            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDateTime(row.updated_at)}</td>
          </>
        ),
      };
    }
    if (tab === TAB_PROGRAM_PAYMENT_STATUS) {
      return {
        minWidth: '860px',
        headers: ['Student', 'Email', 'Invoice', 'Class', 'Status', 'Updated At'],
        render: (row) => (
          <>
            <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{row.full_name || '-'}</td>
            <td className="px-4 py-3 text-sm text-gray-600 truncate" title={row.email || '-'}>
              {row.email || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-gray-600 max-w-[220px]" title={row.invoice_description || '-'}>
              <span className="truncate block">{row.invoice_description || `INV-${row.invoice_id}`}</span>
            </td>
            <td className="px-4 py-3 text-sm text-gray-600 max-w-[160px]" title={row.class_name || '-'}>
              <span className="truncate block">{row.class_name || '-'}</span>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeClass(row.status)}`}>
                {row.status || '-'}
              </span>
            </td>
            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDateTime(row.updated_at)}</td>
          </>
        ),
      };
    }
    return {
      minWidth: '1180px',
      headers: ['Student', 'Email', 'Level Tag', 'Phase', 'Class', 'Enrollment Status', 'Created At', 'Removed At'],
      render: (row) => (
        <>
          <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{row.full_name || '-'}</td>
          <td className="px-4 py-3 text-sm text-gray-600 truncate" title={row.email || '-'}>
            {row.email || '-'}
          </td>
          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.level_tag || '-'}</td>
          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
            {row.phase_number != null && row.phase_number !== '' ? row.phase_number : '-'}
          </td>
          <td className="px-4 py-3 text-sm text-gray-600 max-w-[240px]" title={row.class_name || '-'}>
            <span className="truncate block">{row.class_name || '-'}</span>
          </td>
          <td className="px-4 py-3 whitespace-nowrap">
            <span
              className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${programEnrollmentStatusBadgeClass(row.program_enrollment_status)}`}
            >
              {formatProgramEnrollmentStatus(row.program_enrollment_status)}
            </span>
          </td>
          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDateTime(row.removed_at)}</td>
        </>
      ),
    };
  }, [tab]);

  return (
    <div className="space-y-4 px-2 sm:px-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{config.title}</h1>
        <p className="text-sm text-gray-600 mt-1">{config.description}</p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-4 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          {REPORT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${
                tab === t.id ? 'text-primary-700 border-primary-600' : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search student/email/class..."
            className="input-field text-sm min-w-[260px]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="input-field text-sm min-w-[200px]"
          >
            {config.statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {tab === TAB_STUDENT_STATUS ? (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Billing month</label>
            <input
              type="month"
              value={filterSummaryMonth}
              onChange={(e) => setFilterSummaryMonth(e.target.value)}
              className="input-field text-sm"
            />
          </div>
        ) : null}
        {tab === TAB_PROGRAM_ENROLLMENT_STATUS ? (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phase</label>
              <input
                type="number"
                min={1}
                value={filterPhaseNumber}
                onChange={(e) => setFilterPhaseNumber(e.target.value)}
                placeholder="All phases"
                className="input-field text-sm min-w-[100px]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Enrolled from</label>
              <input
                type="date"
                value={filterEnrolledDateFrom}
                onChange={(e) => setFilterEnrolledDateFrom(e.target.value)}
                className="input-field text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Enrolled to</label>
              <input
                type="date"
                value={filterEnrolledDateTo}
                onChange={(e) => setFilterEnrolledDateTo(e.target.value)}
                className="input-field text-sm"
              />
            </div>
            <label className="inline-flex items-center gap-2 self-end pb-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={filterEnrolledOnly}
                onChange={(e) => setFilterEnrolledOnly(e.target.checked)}
                className="rounded border-gray-300"
              />
              Enrolled only
            </label>
          </>
        ) : null}
        {tab === TAB_STUDENT_STATUS ? (
          <div className="sm:ml-auto self-end">
            <button
              type="button"
              onClick={openExportModal}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Export to Excel
            </button>
          </div>
        ) : null}
      </div>

      <StatusLegend tab={tab} summaryMonth={tab === TAB_STUDENT_STATUS ? filterSummaryMonth : ''} />

      {tab === TAB_STUDENT_STATUS && reportMeta ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Billing month <span className="font-semibold">{reportMeta.summary_month}</span>:{' '}
          <span className="font-semibold">{reportMeta.active_students ?? 0}</span> active students,{' '}
          <span className="font-semibold">{reportMeta.inactive_students ?? 0}</span> inactive (matrix rules:
          new + re-enrolled + rejoin + upsell).
        </div>
      ) : null}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {pagination.total > 0 && (
            <TablePaginationSummary
              page={pagination.page}
              totalItems={pagination.total}
              itemsPerPage={pagination.limit}
              itemLabel={config.itemLabel}
              className="px-4 pt-4 pb-2"
            />
          )}
          <div
            className="overflow-x-auto rounded-lg"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
          >
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: table.minWidth }}>
              <thead className="bg-gray-50">
                <tr>
                  {table.headers.map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={table.headers.length} className="px-4 py-12 text-center text-sm text-gray-500">
                      No records found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr key={row.student_status_id || row.program_payment_status_id || row.classstudent_id || `${tab}-${idx}`} className="hover:bg-gray-50">
                      {table.render(row)}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {pagination.total > 0 && (
            <FixedTablePagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.total}
              itemsPerPage={pagination.limit}
              itemLabel={config.itemLabel}
              onPageChange={fetchRows}
            />
          )}
        </div>
      )}

      <StandardExportModal
        open={showExportModal}
        onClose={() => {
          if (exportLoading) return;
          setShowExportModal(false);
        }}
        title="Export Student Status"
        description={
          <>
            Export for billing month <span className="font-medium">{filterSummaryMonth || '—'}</span> using
            Month Re-enrollment matrix active/inactive rules. Current search filter is applied.
          </>
        }
        exportLoading={exportLoading}
        onExport={handleExportStudentStatus}
      >
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Include students</label>
          <div className="space-y-2">
            {STUDENT_STATUS_EXPORT_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="admin-student-status-export-scope"
                  value={opt.value}
                  checked={exportStatusScope === opt.value}
                  onChange={() => setExportStatusScope(opt.value)}
                  className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-gray-800">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
        {exportError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {exportError}
          </div>
        ) : null}
      </StandardExportModal>
    </div>
  );
};

export default AdminReport;
