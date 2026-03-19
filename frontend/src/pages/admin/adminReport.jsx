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

const AdminReport = () => {
  const { userInfo } = useAuth();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 1 });
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [statusDropdownRect, setStatusDropdownRect] = useState(null);

  const fetchStudents = async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        status: filterStatus,
        page: String(page),
        limit: String(pagination.limit),
      });
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
  }, [filterStatus]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (openStatusDropdown && !e.target.closest('.report-status-dropdown') && !e.target.closest('.report-status-dropdown-portal')) {
        setOpenStatusDropdown(false);
        setStatusDropdownRect(null);
      }
    };
    if (openStatusDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openStatusDropdown]);

  const filteredStudents = students.filter((row) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase().trim();
    return (row.full_name || '').toLowerCase().includes(term);
  });

  return (
    <div className="space-y-4 px-2 sm:px-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Report – Student Status</h1>
      </div>

      <p className="text-sm text-gray-600">
        Active = enrolled in at least one class. Inactive = registered in the system but not enrolled in any class. Shown for your branch only.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
        </div>
      ) : students.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">No students found for the selected filters.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div
            className="overflow-x-auto rounded-lg"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
          >
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '820px', tableLayout: 'fixed' }}>
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    <div className="report-status-dropdown">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setStatusDropdownRect(rect);
                          setOpenStatusDropdown(!openStatusDropdown);
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
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                      No students match your search.
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((row) => (
                    <tr key={row.user_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{row.full_name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 truncate" title={row.email}>{row.email || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.level_tag || '-'}</td>
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
    </div>
  );
};

export default AdminReport;
