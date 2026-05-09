import { useState, useEffect, useMemo } from 'react';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import * as XLSX from 'xlsx';
import { appendPaymentLogsAmountTotalRow } from '../../utils/paymentLogsExcelExport';
import FixedTablePagination from '../../components/table/FixedTablePagination';
import { appAlert } from '../../utils/appAlert';
import StandardExportModal from '../../components/export/StandardExportModal';
import PaymentLogsExportDateRange from '../../components/export/PaymentLogsExportDateRange';
import SortableHeader from '../../components/table/SortableHeader';
import { sortRows, toggleSortConfig } from '../../utils/tableSorting';

const StudentPaymentLogs = () => {
  const { userInfo } = useAuth();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterIssueDateFrom, setFilterIssueDateFrom] = useState('');
  const [filterIssueDateTo, setFilterIssueDateTo] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openPaymentMethodDropdown, setOpenPaymentMethodDropdown] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPaymentDateFrom, setExportPaymentDateFrom] = useState('');
  const [exportPaymentDateTo, setExportPaymentDateTo] = useState('');
  const [sortConfig, setSortConfig] = useState(null);

  const studentId = userInfo?.userId || userInfo?.user_id;

  useEffect(() => {
    if (studentId) {
      fetchPayments();
    }
  }, [studentId]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.status-filter-dropdown')) {
        setOpenStatusDropdown(false);
      }
      if (!event.target.closest('.payment-method-filter-dropdown')) {
        setOpenPaymentMethodDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const fetchPayments = async () => {
    try {
      setLoading(true);
      const response = await apiRequest(`/payments/student/${studentId}`);
      setPayments(response.data || []);
      setError('');
    } catch (err) {
      console.error('Error fetching payments:', err);
      setError('Failed to load payment logs. Please try again.');
      setPayments([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatCurrency = (amount) => {
    if (!amount) return '₱0.00';
    return `₱${parseFloat(amount).toFixed(2)}`;
  };

  const getStatusBadge = (status) => {
    const statusColors = {
      'Completed': 'bg-green-100 text-green-800',
      'Pending': 'bg-yellow-100 text-yellow-800',
      'Failed': 'bg-red-100 text-red-800',
      'Cancelled': 'bg-gray-100 text-gray-800',
    };
    const colorClass = statusColors[status] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        {status || 'N/A'}
      </span>
    );
  };

  const getPaymentMethodBadge = (method) => {
    const methodColors = {
      'Cash': 'bg-blue-100 text-blue-800',
      'Credit Card': 'bg-purple-100 text-purple-800',
      'Debit Card': 'bg-indigo-100 text-indigo-800',
      'Bank Transfer': 'bg-teal-100 text-teal-800',
      'Check': 'bg-orange-100 text-orange-800',
      'Online Payment': 'bg-pink-100 text-pink-800',
      'Other': 'bg-gray-100 text-gray-800',
    };
    const colorClass = methodColors[method] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        {method || 'N/A'}
      </span>
    );
  };

  const getUniqueStatuses = () => {
    const statuses = [...new Set(payments.map(p => p.status).filter(Boolean))];
    return statuses.sort();
  };

  const getUniquePaymentMethods = () => {
    const methods = [...new Set(payments.map(p => p.payment_method).filter(Boolean))];
    return methods.sort();
  };

  const filteredPayments = payments.filter((payment) => {
    const matchesSearch = !searchTerm || 
      payment.invoice_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.invoice_ar_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.reference_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.payment_id?.toString().includes(searchTerm) ||
      `INV-${payment.invoice_id}`.includes(searchTerm);
    
    const matchesStatus = !filterStatus || payment.status === filterStatus;
    const matchesPaymentMethod = !filterPaymentMethod || payment.payment_method === filterPaymentMethod;
    const issueDay = payment.issue_date ? String(payment.issue_date).slice(0, 10) : '';
    const hasRange = Boolean(filterIssueDateFrom || filterIssueDateTo);
    const rangeInvalid =
      hasRange &&
      filterIssueDateFrom &&
      filterIssueDateTo &&
      filterIssueDateFrom > filterIssueDateTo;
    let matchesIssueRange = true;
    if (rangeInvalid) {
      matchesIssueRange = false;
    } else if (hasRange) {
      if (!issueDay) {
        matchesIssueRange = false;
      } else {
        if (filterIssueDateFrom && issueDay < filterIssueDateFrom) matchesIssueRange = false;
        if (filterIssueDateTo && issueDay > filterIssueDateTo) matchesIssueRange = false;
      }
    }

    return matchesSearch && matchesStatus && matchesPaymentMethod && matchesIssueRange;
  });

  const exportPaymentDateRangeInvalid =
    Boolean(exportPaymentDateFrom && exportPaymentDateTo) && exportPaymentDateFrom > exportPaymentDateTo;

  const exportModalPayments = useMemo(() => {
    return payments.filter((payment) => {
      const matchesSearch =
        !searchTerm ||
        payment.invoice_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        payment.invoice_ar_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        payment.reference_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        payment.payment_id?.toString().includes(searchTerm) ||
        `INV-${payment.invoice_id}`.includes(searchTerm);

      const matchesStatus = !filterStatus || payment.status === filterStatus;
      const matchesPaymentMethod = !filterPaymentMethod || payment.payment_method === filterPaymentMethod;

      const issueDay = payment.issue_date ? String(payment.issue_date).slice(0, 10) : '';
      const hasRange = Boolean(exportPaymentDateFrom || exportPaymentDateTo);
      let matchesExportDate = true;
      if (exportPaymentDateRangeInvalid) {
        matchesExportDate = false;
      } else if (hasRange) {
        if (!issueDay) {
          matchesExportDate = false;
        } else {
          if (exportPaymentDateFrom && issueDay < exportPaymentDateFrom) matchesExportDate = false;
          if (exportPaymentDateTo && issueDay > exportPaymentDateTo) matchesExportDate = false;
        }
      }

      return matchesSearch && matchesStatus && matchesPaymentMethod && matchesExportDate;
    });
  }, [payments, searchTerm, filterStatus, filterPaymentMethod, exportPaymentDateFrom, exportPaymentDateTo]);

  const filteredTotalAmount = filteredPayments.reduce(
    (sum, payment) =>
      sum + (parseFloat(payment.payable_amount) || 0) + (parseFloat(payment.tip_amount) || 0),
    0
  );

  const itemsPerPage = 10;
  const sortedPayments = sortRows(filteredPayments, sortConfig, {
    status: { accessor: 'status', type: 'string' },
    payment_date: { accessor: 'payment_date', type: 'date' },
  });
  const totalPages = Math.max(Math.ceil(sortedPayments.length / itemsPerPage), 1);
  const paginatedPayments = sortedPayments.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (key) => {
    setSortConfig((current) => toggleSortConfig(current, key));
    setCurrentPage(1);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterStatus, filterPaymentMethod, filterIssueDateFrom, filterIssueDateTo]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const handleExportToExcel = async (opts = {}) => {
    const { closeModalAfter = false } = opts;
    let wroteFile = false;
    if (exportPaymentDateRangeInvalid) {
      appAlert('"From" date must be on or before "To" date.');
      return;
    }
    try {
      setExportLoading(true);

      if (exportModalPayments.length === 0) {
        appAlert('No payment records found to export.');
        return;
      }

      const excelData = exportModalPayments.map((payment) => ({
        'Invoice ID': payment.invoice_id ? `INV-${payment.invoice_id}` : '-',
        'Invoice Description': payment.invoice_description || '-',
        'Payment Method': payment.payment_method || '-',
        'Payment Type': payment.payment_type || '-',
        'Amount (₱)': payment.payable_amount ? parseFloat(payment.payable_amount).toFixed(2) : '0.00',
        'Status': payment.status || 'N/A',
        'Payment Date': payment.issue_date ? formatDate(payment.issue_date) : '-',
        'Acknowledgement Receipt#': payment.invoice_ar_number || '-',
        'Reference Number': payment.reference_number || '-',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      appendPaymentLogsAmountTotalRow(ws, excelData);

      ws['!cols'] = [
        { wch: 12 },
        { wch: 30 },
        { wch: 18 },
        { wch: 18 },
        { wch: 15 },
        { wch: 12 },
        { wch: 15 },
        { wch: 10 },
        { wch: 20 },
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'My Payment Logs');

      const studentName = userInfo?.fullName || userInfo?.full_name || 'Student';
      const sanitizedName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
      const date = new Date().toISOString().split('T')[0];
      const filename = `Payment_Logs_${sanitizedName}_${date}.xlsx`;

      XLSX.writeFile(wb, filename);
      wroteFile = true;
    } catch (error) {
      console.error('Export error:', error);
      appAlert('Failed to export payment logs. Please try again.');
    } finally {
      setExportLoading(false);
      if (closeModalAfter && wroteFile) setShowExportModal(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Payment Logs</h1>
          <p className="text-sm text-gray-500 mt-1">View your payment history</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setExportPaymentDateFrom(filterIssueDateFrom || '');
            setExportPaymentDateTo(filterIssueDateTo || '');
            setShowExportModal(true);
          }}
          disabled={exportLoading || filteredPayments.length === 0}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          {exportLoading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Exporting...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export to Excel
            </>
          )}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search payments..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="sm:col-span-2 lg:col-span-1">
            <span className="block text-xs font-medium text-gray-600 mb-1">Payment date</span>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="flex-1 min-w-0">
                <label htmlFor="student-payment-logs-issue-date-from" className="sr-only">
                  From
                </label>
                <input
                  id="student-payment-logs-issue-date-from"
                  type="date"
                  value={filterIssueDateFrom}
                  onChange={(e) => setFilterIssueDateFrom(e.target.value)}
                  aria-label="Payment date from"
                  className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent text-sm"
                />
                <span className="text-[10px] text-gray-500 mt-0.5 block sm:hidden">From</span>
              </div>
              <div className="flex-1 min-w-0">
                <label htmlFor="student-payment-logs-issue-date-to" className="sr-only">
                  To
                </label>
                <input
                  id="student-payment-logs-issue-date-to"
                  type="date"
                  value={filterIssueDateTo}
                  onChange={(e) => setFilterIssueDateTo(e.target.value)}
                  aria-label="Payment date to"
                  className="w-full min-h-[42px] px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent text-sm"
                />
                <span className="text-[10px] text-gray-500 mt-0.5 block sm:hidden">To</span>
              </div>
              {filterIssueDateFrom || filterIssueDateTo ? (
                <button
                  type="button"
                  onClick={() => {
                    setFilterIssueDateFrom('');
                    setFilterIssueDateTo('');
                  }}
                  className="text-sm font-medium text-amber-700 hover:text-amber-900 shrink-0 pb-2 sm:pb-0"
                >
                  Clear dates
                </button>
              ) : null}
            </div>
            <p className="text-xs text-gray-500 mt-1">Inclusive range. Leave both empty for all dates.</p>
          </div>
          <div className="relative status-filter-dropdown">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpenStatusDropdown(!openStatusDropdown);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent text-left flex items-center justify-between"
            >
              <span>{filterStatus || 'All Statuses'}</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openStatusDropdown && (
              <div className="absolute left-0 mt-2 w-full bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                <div className="py-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterStatus('');
                      setOpenStatusDropdown(false);
                    }}
                    className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                      !filterStatus ? 'bg-gray-100 font-medium' : 'text-gray-700'
                    }`}
                  >
                    All Statuses
                  </button>
                  {getUniqueStatuses().map((status) => (
                    <button
                      key={status}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterStatus(status);
                        setOpenStatusDropdown(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                        filterStatus === status ? 'bg-gray-100 font-medium' : 'text-gray-700'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="relative payment-method-filter-dropdown">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpenPaymentMethodDropdown(!openPaymentMethodDropdown);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent text-left flex items-center justify-between"
            >
              <span>{filterPaymentMethod || 'All Payment Methods'}</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openPaymentMethodDropdown && (
              <div className="absolute left-0 mt-2 w-full bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                <div className="py-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterPaymentMethod('');
                      setOpenPaymentMethodDropdown(false);
                    }}
                    className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                      !filterPaymentMethod ? 'bg-gray-100 font-medium' : 'text-gray-700'
                    }`}
                  >
                    All Methods
                  </button>
                  {getUniquePaymentMethods().map((method) => (
                    <button
                      key={method}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterPaymentMethod(method);
                        setOpenPaymentMethodDropdown(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                        filterPaymentMethod === method ? 'bg-gray-100 font-medium' : 'text-gray-700'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
        <span>
          <span className="font-semibold text-gray-900">Total Payments:</span>{' '}
          <span className="font-medium text-gray-900">{filteredPayments.length.toLocaleString('en-US')}</span>
        </span>
        <span className="text-gray-300">·</span>
        <span>
          <span className="font-semibold text-gray-900">Total amount (payable + tips):</span>{' '}
          <span className="font-semibold text-emerald-700">
            ₱{filteredTotalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </span>
      </div>

      {/* Payment Logs List */}
      <div className="bg-white rounded-lg shadow">
        <div
            className="overflow-x-auto rounded-lg"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <table
              className="divide-y divide-gray-200"
              style={{ width: '100%', minWidth: '1250px', tableLayout: 'fixed' }}
            >
              <colgroup>
                <col style={{ width: '120px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '140px' }} />
              </colgroup>
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Invoice
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Payment Method
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Payment Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <SortableHeader label="Status" sortKey="status" sortConfig={sortConfig} onSort={handleSort} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" />
                  <SortableHeader label="Payment Date" sortKey="payment_date" sortConfig={sortConfig} onSort={handleSort} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" />
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span className="block">Acknowledgement</span>
                    <span className="block">Receipt#</span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reference
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center">
                      <p className="text-gray-500">
                        {searchTerm || filterStatus || filterPaymentMethod
                          ? 'No matching payments. Try adjusting your search or filters.'
                          : 'No payment records found.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  paginatedPayments.map((payment) => (
                  <tr key={payment.payment_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                      {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900" style={{ maxWidth: '200px' }}>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate" title={payment.invoice_description || `INV-${payment.invoice_id}`}>{payment.invoice_description || `INV-${payment.invoice_id}`}</span>
                        <span className="text-xs text-gray-500">Invoice: {formatCurrency(payment.invoice_amount)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {getPaymentMethodBadge(payment.payment_method)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {payment.payment_type || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">
                      {formatCurrency(payment.payable_amount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {getStatusBadge(payment.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(payment.issue_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <span className="truncate block" title={payment.invoice_ar_number || ''}>
                        {payment.invoice_ar_number || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500" style={{ maxWidth: '180px' }}>
                      <span className="truncate block" title={payment.reference_number || '-'}>{payment.reference_number || '-'}</span>
                    </td>
                  </tr>
                ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      {filteredPayments.length > 0 && (
        <FixedTablePagination
          page={currentPage}
          totalPages={totalPages}
          totalItems={filteredPayments.length}
          itemsPerPage={itemsPerPage}
          itemLabel="payments"
          onPageChange={(page) => setCurrentPage(Math.min(Math.max(page, 1), totalPages))}
        />
      )}

      <StandardExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Payment Logs"
        description="Choose a payment date range (optional). Export includes rows matching your search and status filters; dates apply only to this export."
        exportLoading={exportLoading}
        onExport={() => handleExportToExcel({ closeModalAfter: true })}
        exportDisabled={exportPaymentDateRangeInvalid || exportModalPayments.length === 0}
        maxWidthClass="max-w-lg"
        scrollable
        overlayZClass="z-[9999]"
      >
        <PaymentLogsExportDateRange
          idPrefix="student-pl-export"
          dateFrom={exportPaymentDateFrom}
          dateTo={exportPaymentDateTo}
          onDateFromChange={setExportPaymentDateFrom}
          onDateToChange={setExportPaymentDateTo}
          onClear={() => {
            setExportPaymentDateFrom('');
            setExportPaymentDateTo('');
          }}
          disabled={exportLoading}
        />
      </StandardExportModal>
    </div>
  );
};

export default StudentPaymentLogs;
