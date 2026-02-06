import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import * as XLSX from 'xlsx';

const AdminPaymentLogs = () => {
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  const [exportLoading, setExportLoading] = useState(false);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  // Removed filterBranch - admin only sees their branch
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  // Removed openBranchDropdown - admin only sees their branch
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openPaymentMethodDropdown, setOpenPaymentMethodDropdown] = useState(false);
  // Removed branches state - admin only sees their branch

  // Fetch branch name if not in userInfo
  useEffect(() => {
    const fetchBranchName = async () => {
      if (!userInfo?.branch_name && adminBranchId) {
        try {
          const response = await apiRequest(`/branches/${adminBranchId}`);
          if (response && response.data && response.data.branch_name) {
            setSelectedBranchName(response.data.branch_name);
          }
        } catch (err) {
          console.error('Error fetching branch name:', err);
        }
      } else if (userInfo?.branch_name) {
        setSelectedBranchName(userInfo.branch_name);
      }
    };

    fetchBranchName();
  }, [userInfo, adminBranchId]);

  useEffect(() => {
    // Don't fetch branches for admin - they only see their branch
    if (adminBranchId) {
      fetchPayments();
    }
  }, [adminBranchId]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Removed branch dropdown - admin only sees their branch
      if (openStatusDropdown && !event.target.closest('.status-filter-dropdown') && !event.target.closest('.status-filter-dropdown-portal')) {
        setOpenStatusDropdown(false);
        setStatusDropdownRect(null);
      }
      if (openPaymentMethodDropdown && !event.target.closest('.payment-method-filter-dropdown') && !event.target.closest('.payment-method-filter-dropdown-portal')) {
        setOpenPaymentMethodDropdown(false);
        setPaymentMethodDropdownRect(null);
      }
    };

    if (openStatusDropdown || openPaymentMethodDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openStatusDropdown, openPaymentMethodDropdown]);

  const fetchPayments = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/payments');
      setPayments(response.data || []);
      setError('');
    } catch (err) {
      console.error('Error fetching payments:', err);
      setError('Failed to load payments. Please try again.');
      setPayments([]);
    } finally {
      setLoading(false);
    }
  };

  // Removed fetchBranches - admin only sees their branch
  // Removed getBranchName and formatBranchName - admin only sees their branch

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
      payment.student_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.reference_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.payment_id?.toString().includes(searchTerm);
    
    // Removed matchesBranch - admin only sees their branch
    const matchesStatus = !filterStatus || payment.status === filterStatus;
    const matchesPaymentMethod = !filterPaymentMethod || payment.payment_method === filterPaymentMethod;
    
    return matchesSearch && matchesStatus && matchesPaymentMethod;
  });

  const handleExportToExcel = async () => {
    try {
      setExportLoading(true);
      
      // Fetch all payments for admin's branch (paginate: backend limit max 100)
      const limit = 100;
      const allPayments = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const res = await apiRequest(`/payments?limit=${limit}&page=${page}`);
        const data = res.data || [];
        allPayments.push(...data);
        const total = res.pagination?.total ?? 0;
        hasMore = allPayments.length < total;
        page += 1;
      }

      if (allPayments.length === 0) {
        alert('No payment records found to export.');
        setExportLoading(false);
        return;
      }

      // Prepare data for Excel
      const excelData = allPayments.map(payment => ({
        'Invoice ID': payment.invoice_id ? `INV-${payment.invoice_id}` : '-',
        'Invoice Description': payment.invoice_description || '-',
        'Student Name': payment.student_name || 'N/A',
        'Student Email': payment.student_email || '-',
        'Payment Method': payment.payment_method || '-',
        'Payment Type': payment.payment_type || '-',
        'Amount (₱)': payment.payable_amount ? parseFloat(payment.payable_amount).toFixed(2) : '0.00',
        'Status': payment.status || 'N/A',
        'Issue Date': payment.issue_date ? formatDate(payment.issue_date) : '-',
        'Reference Number': payment.reference_number || '-',
        'Remarks': payment.remarks || '-',
      }));

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);

      // Set column widths
      ws['!cols'] = [
        { wch: 12 },  // Invoice ID
        { wch: 30 },  // Invoice Description
        { wch: 25 },  // Student Name
        { wch: 30 },  // Student Email
        { wch: 18 },  // Payment Method
        { wch: 18 },  // Payment Type
        { wch: 15 },  // Amount
        { wch: 12 },  // Status
        { wch: 15 },  // Issue Date
        { wch: 20 },  // Reference Number
        { wch: 30 },  // Remarks
      ];

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Payment Logs');

      // Generate filename with branch name
      const branchName = selectedBranchName.replace(/[^a-zA-Z0-9]/g, '_');
      const date = new Date().toISOString().split('T')[0];
      const filename = `Payment_Logs_${branchName}_${date}.xlsx`;

      // Save file
      XLSX.writeFile(wb, filename);

      setExportLoading(false);
    } catch (error) {
      console.error('Export error:', error);
      alert('Failed to export payment logs. Please try again.');
      setExportLoading(false);
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
          <p className="text-sm text-gray-500 mt-1">View and manage all payment records</p>
        </div>
        <button
          onClick={handleExportToExcel}
          disabled={exportLoading}
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

      {/* Payment Logs List */}
      {filteredPayments.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {searchTerm || filterStatus || filterPaymentMethod
              ? 'No payments found matching your criteria.'
              : 'No payment records found.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Table View - Horizontal Scroll on All Screens */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1400px', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '180px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '100px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '180px' }} />
              </colgroup>
              <thead className="bg-white table-header-stable">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '180px', minWidth: '180px' }}>
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1 min-h-[6px]">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${searchTerm ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                      </div>
                      <div className="relative min-h-[28px]">
                        <input
                          type="text"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="Search payments..."
                          className="px-2 py-1 pr-6 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 w-full"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {searchTerm && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSearchTerm('');
                            }}
                            className="absolute right-1 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    INVOICE
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '180px', minWidth: '180px' }}>
                    STUDENT
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '140px', minWidth: '140px' }}>
                    <div className="relative payment-method-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setPaymentMethodDropdownRect(rect);
                          setOpenPaymentMethodDropdown(!openPaymentMethodDropdown);
                          setOpenStatusDropdown(false);
                          setStatusDropdownRect(null);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Payment Method</span>
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterPaymentMethod ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    PAYMENT TYPE
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    AMOUNT
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    <div className="relative status-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setStatusDropdownRect(rect);
                          setOpenStatusDropdown(!openStatusDropdown);
                          setOpenPaymentMethodDropdown(false);
                          setPaymentMethodDropdownRect(null);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Status</span>
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterStatus ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '140px', minWidth: '140px' }}>
                    Branch
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    ISSUE DATE
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '180px', minWidth: '180px' }}>
                    REFERENCE
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredPayments.map((payment) => (
                  <tr key={payment.payment_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                      {payment.invoice_id ? `INV-${payment.invoice_id}` : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900" style={{ maxWidth: '120px' }}>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate" title={payment.invoice_description || `INV-${payment.invoice_id}`}>{payment.invoice_description || `INV-${payment.invoice_id}`}</span>
                        <span className="text-xs text-gray-500">Amount: {formatCurrency(payment.invoice_amount)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900" style={{ maxWidth: '180px' }}>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate" title={payment.student_name || 'N/A'}>{payment.student_name || 'N/A'}</span>
                        {payment.student_email && (
                          <span className="text-xs text-gray-500 truncate" title={payment.student_email}>{payment.student_email}</span>
                        )}
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
                    <td className="px-6 py-4 text-sm text-gray-900" style={{ maxWidth: '140px' }}>
                      <span className="truncate block" title={selectedBranchName || '-'}>{selectedBranchName || '-'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(payment.issue_date)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500" style={{ maxWidth: '180px' }}>
                      <span className="truncate block" title={payment.reference_number || '-'}>{payment.reference_number || '-'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment Method filter dropdown - portaled to avoid table overflow clipping */}
      {openPaymentMethodDropdown && paymentMethodDropdownRect && createPortal(
        <div
          className="fixed payment-method-filter-dropdown-portal w-48 bg-white rounded-md shadow-lg z-[100] border border-gray-200 max-h-60 overflow-y-auto py-1"
          style={{
            top: `${paymentMethodDropdownRect.bottom + 4}px`,
            left: `${paymentMethodDropdownRect.left}px`,
            minWidth: `${Math.max(paymentMethodDropdownRect.width, 192)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterPaymentMethod('');
              setOpenPaymentMethodDropdown(false);
              setPaymentMethodDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              !filterPaymentMethod ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            All Methods
          </button>
          {getUniquePaymentMethods().map((method) => (
            <button
              key={method}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterPaymentMethod(method);
                setOpenPaymentMethodDropdown(false);
                setPaymentMethodDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                filterPaymentMethod === method ? 'bg-gray-100 font-medium' : 'text-gray-700'
              }`}
            >
              {method}
            </button>
          ))}
        </div>,
        document.body
      )}

      {/* Status filter dropdown - portaled to avoid table overflow clipping */}
      {openStatusDropdown && statusDropdownRect && createPortal(
        <div
          className="fixed status-filter-dropdown-portal w-48 bg-white rounded-md shadow-lg z-[100] border border-gray-200 max-h-60 overflow-y-auto py-1"
          style={{
            top: `${statusDropdownRect.bottom + 4}px`,
            left: `${statusDropdownRect.left}px`,
            minWidth: `${Math.max(statusDropdownRect.width, 192)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterStatus('');
              setOpenStatusDropdown(false);
              setStatusDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              !filterStatus ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            All Statuses
          </button>
          {getUniqueStatuses().map((status) => (
            <button
              key={status}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterStatus(status);
                setOpenStatusDropdown(false);
                setStatusDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                filterStatus === status ? 'bg-gray-100 font-medium' : 'text-gray-700'
              }`}
            >
              {status}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

export default AdminPaymentLogs;

