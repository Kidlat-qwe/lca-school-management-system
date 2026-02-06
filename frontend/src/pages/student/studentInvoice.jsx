import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import API_BASE_URL, { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const StudentInvoice = () => {
  const { userInfo } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [selectedInvoiceForDetails, setSelectedInvoiceForDetails] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [packageDetails, setPackageDetails] = useState({});

  const studentId = userInfo?.userId || userInfo?.user_id;

  useEffect(() => {
    if (studentId) {
      fetchInvoices();
    }
  }, [studentId]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.status-filter-dropdown')) {
        setOpenStatusDropdown(false);
      }
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
    };

    if (openMenuId || openStatusDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openStatusDropdown]);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const response = await apiRequest(`/invoices/student/${studentId}`);
      setInvoices(response.data || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to fetch invoices');
      console.error('Error fetching invoices:', err);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch package details by package name
  const fetchPackageDetails = async (packageName) => {
    if (packageDetails[packageName]) {
      return packageDetails[packageName];
    }

    try {
      const response = await apiRequest('/packages?limit=1000');
      const packages = response.data || [];
      const packageData = packages.find(pkg => pkg.package_name === packageName);
      
      if (packageData) {
        setPackageDetails(prev => ({
          ...prev,
          [packageName]: packageData.details || []
        }));
        return packageData.details || [];
      }
      return [];
    } catch (err) {
      console.error('Error fetching package details:', err);
      return [];
    }
  };

  // Get expanded invoice items (package + inclusions)
  const getExpandedInvoiceItems = async (items) => {
    const expandedItems = [];
    
    for (const item of items) {
      // Check if item is a package
      if (item.description && item.description.startsWith('Package:')) {
        const packageName = item.description.replace('Package:', '').trim();
        expandedItems.push(item); // Add the package item itself
        
        // Fetch and add package details
        const details = await fetchPackageDetails(packageName);
        for (const detail of details) {
          if (detail.pricing_name) {
            expandedItems.push({
              invoice_item_id: `pricing-${detail.packagedtl_id}`,
              description: `Pricing: ${detail.pricing_name}`,
              amount: null, // No price for pricing list
              isInclusion: true
            });
          } else if (detail.merchandise_name) {
            expandedItems.push({
              invoice_item_id: `merchandise-${detail.packagedtl_id}`,
              description: `Merchandise: ${detail.merchandise_name}${detail.size ? ` (${detail.size})` : ''}`,
              amount: null, // No price for merchandise
              isInclusion: true
            });
          }
        }
      } else {
        expandedItems.push(item);
      }
    }
    
    return expandedItems;
  };

  const openDetailsModal = async (invoice) => {
    setOpenMenuId(null);
    try {
      const response = await apiRequest(`/invoices/${invoice.invoice_id}`);
      const invoiceData = response.data;
      
      // Expand invoice items with package details
      if (invoiceData.items && invoiceData.items.length > 0) {
        const expandedItems = await getExpandedInvoiceItems(invoiceData.items);
        invoiceData.expandedItems = expandedItems;
      }
      
      setSelectedInvoiceForDetails(invoiceData);
      setShowDetailsModal(true);
    } catch (err) {
      console.error('Error fetching invoice details:', err);
      setSelectedInvoiceForDetails(invoice);
      setShowDetailsModal(true);
    }
  };

  const closeDetailsModal = () => {
    setShowDetailsModal(false);
    setSelectedInvoiceForDetails(null);
  };

  const handleMenuClick = (invoiceId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === invoiceId) {
      setOpenMenuId(null);
      setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
    } else {
      // Calculate available space
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedDropdownHeight = 100; // Approximate height for 2 menu items
      const dropdownWidth = 192; // w-48 = 12rem = 192px
      
      // Determine vertical position (above or below)
      let top, bottom;
      if (spaceBelow >= estimatedDropdownHeight) {
        // Enough space below - position below button with small gap (4px)
        top = rect.bottom + 4;
        bottom = 'auto';
      } else if (spaceAbove >= estimatedDropdownHeight) {
        // Not enough space below, but enough above - position above button
        bottom = viewportHeight - rect.top + 4;
        top = 'auto';
      } else {
        // Not enough space in either direction - use the side with more space
        if (spaceBelow > spaceAbove) {
          top = rect.bottom + 4;
          bottom = 'auto';
        } else {
          bottom = viewportHeight - rect.top + 4;
          top = 'auto';
        }
      }
      
      // Determine horizontal position (right or left)
      let right, left;
      right = viewportWidth - rect.right;
      left = 'auto';
      
      setMenuPosition({
        top: top !== 'auto' ? top : undefined,
        bottom: bottom !== 'auto' ? bottom : undefined,
        right: right !== 'auto' ? right : undefined,
        left: left !== 'auto' ? left : undefined,
      });
      setOpenMenuId(invoiceId);
    }
  };

  const handleDownloadPDF = async (invoice) => {
    setOpenMenuId(null);
    try {
      const token = localStorage.getItem('firebase_token');
      const response = await fetch(`${API_BASE_URL}/invoices/${invoice.invoice_id}/pdf`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Failed to download invoice PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Download invoice PDF failed:', err);
      alert(err.message || 'Failed to download invoice PDF');
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
      'Paid': 'bg-green-100 text-green-800',
      'Unpaid': 'bg-red-100 text-red-800',
      'Partial': 'bg-yellow-100 text-yellow-800',
      'Draft': 'bg-gray-100 text-gray-800',
    };
    const colorClass = statusColors[status] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
        {status || 'N/A'}
      </span>
    );
  };

  const getUniqueStatuses = () => {
    const statuses = [...new Set(invoices.map(i => i.status).filter(Boolean))];
    return statuses.sort();
  };

  const filteredInvoices = invoices.filter((invoice) => {
    const invoiceIdStr = `INV-${invoice.invoice_id}`;
    const matchesSearch = !nameSearchTerm || 
      invoiceIdStr.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      invoice.invoice_id?.toString().includes(nameSearchTerm) ||
      invoice.invoice_description?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    const matchesStatus = !filterStatus || invoice.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  const calculateItemTotal = (item) => {
    const amount = parseFloat(item.amount) || 0;
    const discount = parseFloat(item.discount_amount) || 0;
    const penalty = parseFloat(item.penalty_amount) || 0;
    const taxPercent = parseFloat(item.tax_percentage) || 0;
    const subtotal = amount - discount + penalty;
    const tax = subtotal * (taxPercent / 100);
    return subtotal + tax;
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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Invoices</h1>
          <p className="text-sm text-gray-500 mt-1">View and download your invoices</p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <input
              type="text"
              value={nameSearchTerm}
              onChange={(e) => setNameSearchTerm(e.target.value)}
              placeholder="Search by invoice ID or description..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent"
            />
            {nameSearchTerm && (
              <button
                onClick={() => setNameSearchTerm('')}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
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
        </div>
      </div>

      {/* Invoices List */}
      {filteredInvoices.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterStatus
              ? 'No invoices found matching your criteria.'
              : 'No invoices found.'}
          </p>
        </div>
      ) : (
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
              style={{ width: '100%', minWidth: '1000px' }}
            >
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Invoice ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Issue Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Due Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.invoice_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                      INV-{invoice.invoice_id}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {invoice.invoice_description || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {formatCurrency(invoice.amount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(invoice.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(invoice.issue_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(invoice.due_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="relative action-menu-container flex items-center justify-end">
                        <button
                          onClick={(e) => handleMenuClick(invoice.invoice_id, e)}
                          className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                        >
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredInvoices.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredInvoices.length} of {invoices.length} invoices
        </div>
      )}

      {/* Action Menu Overlay */}
      {openMenuId && createPortal(
        <>
          <div 
            className="fixed inset-0 z-40 bg-transparent" 
            onClick={() => {
              setOpenMenuId(null);
              setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
            }}
          />
          <div
            className="fixed action-menu-overlay bg-white rounded-md shadow-lg z-50 border border-gray-200 w-48 max-h-[calc(100vh-2rem)] overflow-y-auto"
            style={{
              ...(menuPosition.top !== undefined && { top: `${menuPosition.top}px` }),
              ...(menuPosition.bottom !== undefined && { bottom: `${menuPosition.bottom}px` }),
              ...(menuPosition.right !== undefined && { right: `${menuPosition.right}px` }),
              ...(menuPosition.left !== undefined && { left: `${menuPosition.left}px` }),
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedInvoice = filteredInvoices.find(i => i.invoice_id === openMenuId);
                  if (selectedInvoice) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openDetailsModal(selectedInvoice);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                View Invoice
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedInvoice = filteredInvoices.find(i => i.invoice_id === openMenuId);
                  if (selectedInvoice) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    handleDownloadPDF(selectedInvoice);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Download Receipt
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Invoice Details Modal */}
      {showDetailsModal && selectedInvoiceForDetails && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeDetailsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Invoice Details - INV-{selectedInvoiceForDetails.invoice_id}
                </h2>
                <p className="text-sm text-gray-500 mt-1">{selectedInvoiceForDetails.invoice_description || '-'}</p>
              </div>
              <button
                onClick={closeDetailsModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-6">
                {/* Invoice Information */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-4 border-b border-gray-200">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</label>
                    <p className="mt-1">{getStatusBadge(selectedInvoiceForDetails.status)}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Issue Date</label>
                    <p className="mt-1 text-sm text-gray-900">{formatDate(selectedInvoiceForDetails.issue_date)}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Due Date</label>
                    <p className="mt-1 text-sm text-gray-900">{formatDate(selectedInvoiceForDetails.due_date)}</p>
                  </div>
                </div>

                {/* Invoice Items */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Invoice Items</h3>
                  {selectedInvoiceForDetails.expandedItems && selectedInvoiceForDetails.expandedItems.length > 0 ? (
                    <div className="space-y-2">
                      {selectedInvoiceForDetails.expandedItems.map((item, index) => (
                        <div
                          key={item.invoice_item_id || index}
                          className={`border border-gray-200 rounded-lg p-4 ${
                            item.isInclusion ? 'bg-gray-50' : 'bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2">
                                <span className="text-sm font-medium text-gray-900">
                                  {item.description || '-'}
                                </span>
                                {item.isInclusion && (
                                  <span className="text-xs text-gray-500 italic">(Included)</span>
                                )}
                              </div>
                              {item.tax_item && (
                                <p className="text-xs text-gray-500 mt-1">Tax: {item.tax_item}</p>
                              )}
                              {(item.discount_amount && parseFloat(item.discount_amount) > 0) && (
                                <p className="text-xs text-red-600 mt-1">
                                  Discount: {formatCurrency(item.discount_amount)}
                                </p>
                              )}
                              {(item.penalty_amount && parseFloat(item.penalty_amount) > 0) && (
                                <p className="text-xs text-orange-600 mt-1">
                                  Penalty: {formatCurrency(item.penalty_amount)}
                                </p>
                              )}
                            </div>
                            {!item.isInclusion && item.amount !== null && (
                              <div className="text-right">
                                <p className="text-sm font-medium text-gray-900">
                                  {formatCurrency(calculateItemTotal(item))}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : selectedInvoiceForDetails.items && selectedInvoiceForDetails.items.length > 0 ? (
                    <div className="space-y-2">
                      {selectedInvoiceForDetails.items.map((item) => (
                        <div key={item.invoice_item_id} className="border border-gray-200 rounded-lg p-4 bg-white">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <span className="text-sm font-medium text-gray-900">
                                {item.description || '-'}
                              </span>
                              {item.tax_item && (
                                <p className="text-xs text-gray-500 mt-1">Tax: {item.tax_item}</p>
                              )}
                              {(item.discount_amount && parseFloat(item.discount_amount) > 0) && (
                                <p className="text-xs text-red-600 mt-1">
                                  Discount: {formatCurrency(item.discount_amount)}
                                </p>
                              )}
                              {(item.penalty_amount && parseFloat(item.penalty_amount) > 0) && (
                                <p className="text-xs text-orange-600 mt-1">
                                  Penalty: {formatCurrency(item.penalty_amount)}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium text-gray-900">
                                {formatCurrency(calculateItemTotal(item))}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No items in this invoice.</p>
                  )}
                </div>

                {/* Total Amount */}
                <div className="pt-4 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold text-gray-900">Total Amount:</span>
                    <span className="text-xl font-bold text-gray-900">
                      {formatCurrency(selectedInvoiceForDetails.amount)}
                    </span>
                  </div>
                </div>

                {/* Remarks */}
                {selectedInvoiceForDetails.remarks && (
                  <div className="pt-4 border-t border-gray-200">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Remarks</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedInvoiceForDetails.remarks}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
              <button
                type="button"
                onClick={() => handleDownloadPDF(selectedInvoiceForDetails)}
                className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg transition-colors"
              >
                Download PDF
              </button>
              <button
                type="button"
                onClick={closeDetailsModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default StudentInvoice;
