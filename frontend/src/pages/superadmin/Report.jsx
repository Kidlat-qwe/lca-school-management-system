import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import FixedTablePagination, { TablePaginationSummary } from '../../components/table/FixedTablePagination';
import StatusLegend from '../../components/reports/StatusLegend';
import {
  formatProgramEnrollmentStatus,
  PROGRAM_ENROLLMENT_STATUS_FILTER_OPTIONS,
  programEnrollmentStatusBadgeClass,
} from '../../utils/programEnrollmentStatus';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { formatDateTimeManila } from '../../utils/dateUtils';

const TAB_STUDENT_STATUS = 'student_status';
const TAB_PROGRAM_PAYMENT_STATUS = 'program_payment_status';
const TAB_PROGRAM_ENROLLMENT_STATUS = 'program_enrollment_status';

const REPORT_TABS = [
  { id: TAB_STUDENT_STATUS, label: 'Student Status' },
  { id: TAB_PROGRAM_PAYMENT_STATUS, label: 'Program Payment Status' },
  { id: TAB_PROGRAM_ENROLLMENT_STATUS, label: 'Program Enrollment Status' },
];

const TAB_CONFIG = {
  [TAB_STUDENT_STATUS]: {
    endpoint: '/reports/student-status',
    title: 'Report - Student Status',
    description: 'Rows from student_statustbl.',
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

const Report = () => {
  const location = useLocation();
  const urlBootstrap = parseReportLocationSearch(location.search);
  const { selectedBranchId: globalBranchId } = useGlobalBranchFilter();
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
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });

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
    setFilterStatus('all');
    setSearchTerm('');
    setRows([]);
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
      if (globalBranchId) params.set('branch_id', String(globalBranchId));
      if (debouncedSearchTerm.trim()) params.set('search', debouncedSearchTerm.trim());
      if (tab === TAB_PROGRAM_ENROLLMENT_STATUS) {
        if (filterPhaseNumber) params.set('phase_number', filterPhaseNumber);
        if (filterEnrolledDateFrom) params.set('enrolled_date_from', filterEnrolledDateFrom);
        if (filterEnrolledDateTo) params.set('enrolled_date_to', filterEnrolledDateTo);
        if (filterEnrolledOnly) params.set('enrolled_only', '1');
      }
      const response = await apiRequest(`${config.endpoint}?${params.toString()}`);
      setRows(response.data || []);
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
    globalBranchId,
    debouncedSearchTerm,
    filterPhaseNumber,
    filterEnrolledDateFrom,
    filterEnrolledDateTo,
    filterEnrolledOnly,
  ]);

  const table = useMemo(() => {
    if (tab === TAB_STUDENT_STATUS) {
      return {
        minWidth: '820px',
        headers: ['Name', 'Email', 'Level Tag', 'Branch', 'Status', 'Updated At'],
        render: (row) => (
          <>
            <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{row.full_name || '-'}</td>
            <td className="px-4 py-3 text-sm text-gray-600 truncate" title={row.email || '-'}>
              {row.email || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.level_tag || '-'}</td>
            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.branch_name || '-'}</td>
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
    if (tab === TAB_PROGRAM_PAYMENT_STATUS) {
      return {
        minWidth: '960px',
        headers: ['Student', 'Email', 'Branch', 'Invoice', 'Class', 'Status', 'Updated At'],
        render: (row) => (
          <>
            <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{row.full_name || '-'}</td>
            <td className="px-4 py-3 text-sm text-gray-600 truncate" title={row.email || '-'}>
              {row.email || '-'}
            </td>
            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.branch_name || '-'}</td>
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
      minWidth: '1320px',
      headers: ['Student', 'Email', 'Level Tag', 'Branch', 'Phase', 'Class', 'Enrollment Status', 'Created At', 'Removed At'],
      render: (row) => (
        <>
          <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{row.full_name || '-'}</td>
          <td className="px-4 py-3 text-sm text-gray-600 truncate" title={row.email || '-'}>
            {row.email || '-'}
          </td>
          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.level_tag || '-'}</td>
          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.branch_name || '-'}</td>
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
      </div>

      <StatusLegend tab={tab} />

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
    </div>
  );
};

export default Report;
