import { useState, useEffect } from 'react';
import { apiRequest } from '../../config/api';
import * as XLSX from 'xlsx';

const FinancePaymentLogs = () => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [openBranchDropdown, setOpenBranchDropdown] = useState(false);
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openPaymentMethodDropdown, setOpenPaymentMethodDropdown] = useState(false);
  const [branches, setBranches] = useState([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedExportBranches, setSelectedExportBranches] = useState([]);
  const [exportLoading, setExportLoading] = useState(false);

  useEffect(() => {
    fetchPayments();
    fetchBranches();
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.branch-filter-dropdown')) {
        setOpenBranchDropdown(false);
      }
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

  const fetchBranches = async () => {
    try {
      const response = await apiRequest('/branches');
      setBranches(response.data || []);
    } catch (err) {
      console.error('Error fetching branches:', err);
    }
  };

  const getBranchName = (branchId) => {
    const branch = branches.find(b => b.branch_id === branchId);
    return branch ? branch.branch_name : 'N/A';
  };

  const formatBranchName = (branchName) => {
    if (!branchName) return null;

    if (branchName.includes(' - ')) {
      const parts = branchName.split(' - ');
      return {
        company: parts[0].trim(),
        location: parts.slice(1).join(' - ').trim(),
      };
    }

    if (branchName.includes('-')) {
      const parts = branchName.split('-');
      return {
        company: parts[0].trim(),
        location: parts.slice(1).join('-').trim(),
      };
    }

    return {
      company: branchName,
      location: '',
    };
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
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
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
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
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
    
    const matchesBranch = !filterBranch || payment.branch_id?.toString() === filterBranch;
    const matchesStatus = !filterStatus || payment.status === filterStatus;
    const matchesPaymentMethod = !filterPaymentMethod || payment.payment_method === filterPaymentMethod;
    
    return matchesSearch && matchesBranch && matchesStatus && matchesPaymentMethod;
  });

  const handleExportClick = () => {
    setSelectedExportBranches([]);
    setShowExportModal(true);
  };

  const handleExportBranchToggle = (branchId) => {
    setSelectedExportBranches(prev => {
      if (prev.includes(branchId)) {
        return prev.filter(id => id !== branchId);
      } else {
        return [...prev, branchId];
      }
    });
  };

  const handleSelectAllBranches = () => {
    if (selectedExportBranches.length === branches.length) {
      setSelectedExportBranches([]);
    } else {
      setSelectedExportBranches(branches.map(b => b.branch_id));
    }
  };

  const handleExportToExcel = async () => {
    if (selectedExportBranches.length === 0) return;
    try {
      setExportLoading(true);
      
      const limit = 100;
      const fetchPage = async (branchId, page = 1) => {
        const url = `/payments?branch_id=${branchId}&limit=${limit}&page=${page}`;
        return apiRequest(url);
      };
      const fetchAllForBranch = async (branchId) => {
        const result = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const res = await fetchPage(branchId, page);
          const data = res.data || [];
          result.push(...data);
          const total = res.pagination?.total ?? 0;
          hasMore = result.length < total;
          page += 1;
        }
        return result;
      };

      const promises = selectedExportBranches.map(bid => fetchAllForBranch(bid));
      const results = await Promise.all(promises);
      const allPayments = results.flat();

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
        'Branch': payment.branch_name || 'N/A',
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
        { wch: 25 },  // Branch
        { wch: 15 },  // Issue Date
        { wch: 20 },  // Reference Number
        { wch: 30 },  // Remarks
      ];

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Payment Logs');

      // Generate filename
      const branchName = selectedExportBranches.length === 1
        ? branches.find(b => b.branch_id === selectedExportBranches[0])?.branch_name.replace(/[^a-zA-Z0-9]/g, '_') || 'Selected_Branch'
        : 'Selected_Branches';
      const date = new Date().toISOString().split('T')[0];
      const filename = `Payment_Logs_${branchName}_${date}.xlsx`;

      // Save file
      XLSX.writeFile(wb, filename);

      setShowExportModal(false);
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
          onClick={handleExportClick}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export to Excel
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
            {searchTerm || filterBranch || filterStatus || filterPaymentMethod
              ? 'No payments found matching your criteria.'
              : 'No payment records found.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          {/* Table View - Horizontal Scroll on All Screens */}
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1400px' }}>
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1">
                        {searchTerm && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                      </div>
                      <div className="relative">
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
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    INVOICE
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    STUDENT
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="relative payment-method-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenPaymentMethodDropdown(!openPaymentMethodDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Payment Method</span>
                        {filterPaymentMethod && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openPaymentMethodDropdown && (
                        <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                          <div className="py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterPaymentMethod('');
                                setOpenPaymentMethodDropdown(false);
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFilterPaymentMethod(method);
                                  setOpenPaymentMethodDropdown(false);
                                }}
                                className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
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
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    PAYMENT TYPE
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    AMOUNT
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="relative status-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenStatusDropdown(!openStatusDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Status</span>
                        {filterStatus && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openStatusDropdown && (
                        <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                          <div className="py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterStatus('');
                                setOpenStatusDropdown(false);
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFilterStatus(status);
                                  setOpenStatusDropdown(false);
                                }}
                                className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
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
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <div className="relative branch-filter-dropdown">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenBranchDropdown(!openBranchDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Branch</span>
                        {filterBranch && (
                          <span className="inline-flex items-center justify-center w-1.5 h-1.5 bg-primary-600 rounded-full"></span>
                        )}
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openBranchDropdown && (
                        <div className="absolute left-0 mt-2 w-48 bg-white rounded-md shadow-lg z-50 border border-gray-200 max-h-60 overflow-y-auto">
                          <div className="py-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setFilterBranch('');
                                setOpenBranchDropdown(false);
                              }}
                              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                !filterBranch ? 'bg-gray-100 font-medium' : 'text-gray-700'
                              }`}
                            >
                              All Branches
                            </button>
                            {branches.map((branch) => (
                              <button
                                key={branch.branch_id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFilterBranch(branch.branch_id.toString());
                                  setOpenBranchDropdown(false);
                                }}
                                className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                                  filterBranch === branch.branch_id.toString() ? 'bg-gray-100 font-medium' : 'text-gray-700'
                                }`}
                              >
                                {branch.branch_name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ISSUE DATE
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex flex-col">
                        <span className="font-medium">{payment.invoice_description || `INV-${payment.invoice_id}`}</span>
                        <span className="text-xs text-gray-500">Amount: {formatCurrency(payment.invoice_amount)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <div className="flex flex-col">
                        <span className="font-medium">{payment.student_name || 'N/A'}</span>
                        {payment.student_email && (
                          <span className="text-xs text-gray-500">{payment.student_email}</span>
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(() => {
                        const branchName = payment.branch_name || getBranchName(payment.branch_id);
                        if (!branchName || branchName === 'N/A') {
                          return <span className="text-gray-400">-</span>;
                        }
                        const formatted = formatBranchName(branchName);
                        return (
                          <div className="flex flex-col leading-tight">
                            <span className="font-medium">{formatted.company}</span>
                            {formatted.location && (
                              <span className="text-xs text-gray-500">{formatted.location}</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(payment.issue_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {payment.reference_number || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Export Payment Logs</h2>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                  disabled={exportLoading}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Branches to Export</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Select at least one branch to include in the export. The Export button is disabled until you select a branch.
                </p>

                {/* Select All Button */}
                <div className="mb-4">
                  <button
                    onClick={handleSelectAllBranches}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm font-medium"
                    disabled={exportLoading}
                  >
                    {selectedExportBranches.length === branches.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                {/* Branch List */}
                <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-4">
                  {branches.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No branches available</p>
                  ) : (
                    branches.map((branch) => (
                      <label
                        key={branch.branch_id}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedExportBranches.includes(branch.branch_id)}
                          onChange={() => handleExportBranchToggle(branch.branch_id)}
                          disabled={exportLoading}
                          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                        />
                        <span className="text-gray-900">{branch.branch_name}</span>
                      </label>
                    ))
                  )}
                </div>

                {/* Export Info */}
                <div className={`mt-4 p-4 rounded-lg ${selectedExportBranches.length === 0 ? 'bg-amber-50' : 'bg-blue-50'}`}>
                  <p className={`text-sm ${selectedExportBranches.length === 0 ? 'text-amber-800' : 'text-blue-800'}`}>
                    <strong>Selected:</strong>{' '}
                    {selectedExportBranches.length === 0
                      ? 'No branches selected — select at least one to export'
                      : selectedExportBranches.length === branches.length
                      ? 'All Branches'
                      : `${selectedExportBranches.length} Branch${selectedExportBranches.length !== 1 ? 'es' : ''}`}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowExportModal(false)}
                  disabled={exportLoading}
                  className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleExportToExcel}
                  disabled={exportLoading || branches.length === 0 || selectedExportBranches.length === 0}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancePaymentLogs;

