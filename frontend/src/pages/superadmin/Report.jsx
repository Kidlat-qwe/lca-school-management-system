import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import FixedTablePagination from '../../components/table/FixedTablePagination';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active (Enrolled)' },
  { value: 'inactive', label: 'Inactive (Not Enrolled)' },
];

const Report = () => {
  const { userInfo } = useAuth();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterBranch, setFilterBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openBranchDropdown, setOpenBranchDropdown] = useState(false);
  const [statusDropdownRect, setStatusDropdownRect] = useState(null);
  const [branchDropdownRect, setBranchDropdownRect] = useState(null);

  const isSuperadmin = (userInfo?.user_type || userInfo?.userType) === 'Superadmin';

  const fetchStudents = async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        status: filterStatus,
        page: String(page),
        limit: String(pagination.limit),
      });
      if (isSuperadmin && filterBranch) params.set('branch_id', filterBranch);
      const response = await apiRequest(`/reports/students?${params.toString()}`);
      setStudents(response.data || []);
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
      console.error('Error fetching report:', err);
      setError('Failed to load student report.');
      setStudents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents(1);
  }, [filterStatus, filterBranch]);

  useEffect(() => {
    if (isSuperadmin) {
      apiRequest('/branches')
        .then((res) => {
          const list = res.data || [];
          const deduped = list.filter((b, i, arr) => arr.findIndex((x) => x.branch_id === b.branch_id) === i);
          setBranches(deduped);
        })
        .catch(() => setBranches([]));
    }
  }, [isSuperadmin]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (openStatusDropdown && !e.target.closest('.report-status-dropdown') && !e.target.closest('.report-status-dropdown-portal')) {
        setOpenStatusDropdown(false);
        setStatusDropdownRect(null);
      }
      if (openBranchDropdown && !e.target.closest('.report-branch-dropdown') && !e.target.closest('.report-branch-dropdown-portal')) {
        setOpenBranchDropdown(false);
        setBranchDropdownRect(null);
      }
    };
    if (openStatusDropdown || openBranchDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openStatusDropdown, openBranchDropdown]);

  const filteredStudents = students.filter((row) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase().trim();
    return (row.full_name || '').toLowerCase().includes(term);
  });

  const getBranchName = (branchId) => {
    if (branchId == null) return null;
    const b = branches.find((x) => x.branch_id === branchId);
    return b ? (b.branch_nickname || b.branch_name) : null;
  };

  return (
    <div className="space-y-4 px-2 sm:px-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Report – Student Status</h1>
      </div>

      <p className="text-sm text-gray-600">
        Active = enrolled in at least one class. Inactive = registered in the system but not enrolled in any class.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div
            className="overflow-x-auto rounded-lg"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
          >
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1020px', tableLayout: 'fixed' }}>
              <thead className="bg-gray-50 table-header-stable">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '180px', minWidth: '180px' }}>
                    <div className="flex flex-col space-y-2">
                      <span className="inline-block">Name</span>
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search by name..."
                        className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 w-full"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Level tag
                  </th>
                  {isSuperadmin && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '160px', minWidth: '160px' }}>
                      <div className="report-branch-dropdown">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setBranchDropdownRect(rect);
                            setOpenBranchDropdown(!openBranchDropdown);
                            setOpenStatusDropdown(false);
                          }}
                          className="flex items-center gap-1 hover:text-gray-700 w-full text-left"
                        >
                          Branch
                          {filterBranch && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-600 flex-shrink-0" aria-hidden />}
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                    </th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    <div className="report-status-dropdown">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setStatusDropdownRect(rect);
                          setOpenStatusDropdown(!openStatusDropdown);
                          setOpenBranchDropdown(false);
                        }}
                        className="flex items-center gap-1 hover:text-gray-700 w-full text-left"
                      >
                        Status
                        {filterStatus !== 'all' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary-600 flex-shrink-0" aria-hidden />}
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '220px', minWidth: '220px' }}>
                    Class Enrolled
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={isSuperadmin ? 6 : 5} className="px-4 py-12 text-center text-sm text-gray-500">
                      {students.length === 0
                        ? 'No students found for the selected filters.'
                        : 'No matching students. Try adjusting your search or filters.'}
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((row) => (
                    <tr key={row.user_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{row.full_name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 truncate" title={row.email}>{row.email || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.level_tag || '-'}</td>
                      {isSuperadmin && (
                        <td className="px-4 py-3 text-sm text-gray-600 truncate" title={getBranchName(row.branch_id) || row.branch_name || '-'}>
                          {getBranchName(row.branch_id) || row.branch_name || '-'}
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                            row.enrollment_status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {row.enrollment_status === 'Active' ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-[220px]" title={row.enrolled_classes || undefined}>
                        <span className="truncate block">{row.enrolled_classes || '—'}</span>
                      </td>
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
              itemsPerPage={10}
              itemLabel="students"
              onPageChange={fetchStudents}
            />
          )}
        </div>
      )}

      {openStatusDropdown && statusDropdownRect && createPortal(
        <div
          className="fixed report-status-dropdown-portal z-[100] w-56 bg-white rounded-md shadow-lg border border-gray-200 py-1"
          style={{
            top: `${statusDropdownRect.bottom + 4}px`,
            left: `${statusDropdownRect.left}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setFilterStatus(opt.value);
                setOpenStatusDropdown(false);
                setStatusDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                filterStatus === opt.value ? 'bg-gray-100 font-medium' : ''
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}

      {isSuperadmin && openBranchDropdown && branchDropdownRect && createPortal(
        <div
          className="fixed report-branch-dropdown-portal z-[100] max-h-60 overflow-y-auto w-56 bg-white rounded-md shadow-lg border border-gray-200 py-1"
          style={{
            top: `${branchDropdownRect.bottom + 4}px`,
            left: `${branchDropdownRect.left}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setFilterBranch('');
              setOpenBranchDropdown(false);
              setBranchDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${!filterBranch ? 'bg-gray-100 font-medium' : ''}`}
          >
            All branches
          </button>
          {branches.map((b) => (
            <button
              key={b.branch_id}
              type="button"
              onClick={() => {
                setFilterBranch(String(b.branch_id));
                setOpenBranchDropdown(false);
                setBranchDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 truncate ${
                filterBranch === String(b.branch_id) ? 'bg-gray-100 font-medium' : ''
              }`}
              title={b.branch_nickname || b.branch_name}
            >
              {b.branch_nickname || b.branch_name}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

export default Report;
