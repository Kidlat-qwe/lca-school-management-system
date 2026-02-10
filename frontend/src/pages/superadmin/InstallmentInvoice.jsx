import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';

const InstallmentInvoice = () => {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openActionMenu, setOpenActionMenu] = useState(null);
  const [actionMenuPosition, setActionMenuPosition] = useState(null);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [selectedInvoiceForGeneration, setSelectedInvoiceForGeneration] = useState(null);
  const [generateFormData, setGenerateFormData] = useState({
    issue_date: '',
    due_date: '',
    invoice_month: '',
    generation_date: '',
    next_issue_date: '',
    next_due_date: '',
    next_invoice_month: '',
    next_generation_date: '',
  });
  const [generateFormErrors, setGenerateFormErrors] = useState({});
  const [generating, setGenerating] = useState(false);

  const getFrequencyMonths = (frequency) => {
    const match = String(frequency || '1 month(s)').match(/(\d+)/);
    return parseInt(match?.[1] || '1', 10);
  };

  const parseYmdLocalNoon = (ymd) => {
    if (!ymd) return null;
    const [y, m, d] = String(ymd).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  };

  const formatYmd = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openStatusDropdown && !event.target.closest('.status-filter-dropdown')) {
        setOpenStatusDropdown(false);
      }
      if (openActionMenu && !event.target.closest('.action-menu-dropdown') && !event.target.closest('.action-menu-overlay')) {
        setOpenActionMenu(null);
        setActionMenuPosition(null);
      }
    };

    if (openStatusDropdown || openActionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openStatusDropdown, openActionMenu]);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const response = await apiRequest('/installment-invoices/invoices?limit=100');
      setInvoices(response.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch installment invoices');
      console.error('Error fetching invoices:', err);
    } finally {
      setLoading(false);
    }
  };

  const getUniqueStatuses = [...new Set(invoices.map(i => i.status).filter(Boolean))];

  const filteredInvoices = invoices.filter((invoice) => {
    const matchesSearch = !nameSearchTerm || 
      invoice.student_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      invoice.program_name?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    const matchesStatus = !filterStatus || invoice.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });

  const handleViewEdit = (invoice) => {
    console.log('View/Edit invoice:', invoice);
    setOpenActionMenu(null);
    setActionMenuPosition(null);
    // TODO: Implement view/edit functionality
  };

  const handleGenerateInvoice = (invoice) => {
    setOpenActionMenu(null);
    setActionMenuPosition(null);
    
    // The backend will validate if invoice generation is allowed based on paid phases
    // We removed frontend validation to allow the backend to make the final decision
    
    setSelectedInvoiceForGeneration(invoice);
    
    // Calculate dates based on frequency (for manual generation after phase 1 paid)
    const months = getFrequencyMonths(invoice.frequency);

    // Current Invoice Detail = the invoice we're generating NOW (next billing month)
    // - issue_date: today (manual generation date)
    // - due_date: 5th of the month AFTER invoice month (e.g. invoice month March → due April 5)
    // - invoice_month: next month from today (e.g. today Feb 9 → March 2026)
    // - generation_date: 25th of invoice month (when it would have been auto-generated)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const issueDate = new Date(today); // Issue date = today (manual generated)

    // Invoice month = next month from today (e.g. Feb 9 → March 2026); Date(yr, month+1, 1) rolls year if Dec
    const invoiceMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    const dueDate = new Date(invoiceMonth);
    dueDate.setMonth(dueDate.getMonth() + 1); // Month after invoice month
    dueDate.setDate(5); // Due on 5th

    const generationDate = new Date(invoiceMonth);
    generationDate.setDate(25); // 25th of invoice month

    // Next Invoice Detail = the month after current invoice month
    const nextInvoiceMonth = new Date(invoiceMonth);
    nextInvoiceMonth.setMonth(nextInvoiceMonth.getMonth() + months);
    nextInvoiceMonth.setDate(1);

    const nextIssueDate = new Date(nextInvoiceMonth);
    nextIssueDate.setDate(25);

    const nextDueDate = new Date(nextInvoiceMonth);
    nextDueDate.setMonth(nextDueDate.getMonth() + 1);
    nextDueDate.setDate(5);

    setGenerateFormData({
      issue_date: formatYmd(issueDate),
      due_date: formatYmd(dueDate),
      invoice_month: formatYmd(invoiceMonth),
      generation_date: formatYmd(generationDate),
      next_issue_date: formatYmd(nextIssueDate),
      next_due_date: formatYmd(nextDueDate),
      next_invoice_month: formatYmd(nextInvoiceMonth),
      next_generation_date: formatYmd(nextIssueDate),
    });
    
    setIsGenerateModalOpen(true);
  };
  
  const closeGenerateModal = () => {
    setIsGenerateModalOpen(false);
    setSelectedInvoiceForGeneration(null);
    setGenerateFormData({
      issue_date: '',
      due_date: '',
      invoice_month: '',
      generation_date: '',
      next_issue_date: '',
      next_due_date: '',
      next_invoice_month: '',
      next_generation_date: '',
    });
    setGenerateFormErrors({});
  };
  
  const handleGenerateSubmit = async (e) => {
    e.preventDefault();
    setGenerateFormErrors({});
    
    // Validation
    const errors = {};
    if (!generateFormData.issue_date) errors.issue_date = 'Issue date is required';
    if (!generateFormData.due_date) errors.due_date = 'Due date is required';
    if (!generateFormData.invoice_month) errors.invoice_month = 'Invoice month is required';
    if (!generateFormData.next_issue_date) errors.next_issue_date = 'Next issue date is required';
    if (!generateFormData.next_due_date) errors.next_due_date = 'Next due date is required';
    if (!generateFormData.next_invoice_month) errors.next_invoice_month = 'Next invoice month is required';
    if (!generateFormData.next_generation_date) errors.next_generation_date = 'Next generation date is required';
    
    if (Object.keys(errors).length > 0) {
      setGenerateFormErrors(errors);
      return;
    }
    
    try {
      setGenerating(true);
      await apiRequest(
        `/installment-invoices/invoices/${selectedInvoiceForGeneration.installmentinvoicedtl_id}/generate`,
        {
          method: 'POST',
          body: JSON.stringify(generateFormData),
        }
      );
      
      closeGenerateModal();
      fetchInvoices(); // Refresh the list
      
      // Show success message
      setError(''); // Clear any previous errors
      alert('Invoice generated successfully!');
    } catch (err) {
      setGenerateFormErrors({ submit: err.message || 'Failed to generate invoice' });
      console.error('Error generating invoice:', err);
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (invoice) => {
    if (!window.confirm(`Are you sure you want to delete invoice for ${invoice.student_name}?`)) {
      setOpenActionMenu(null);
      setActionMenuPosition(null);
      return;
    }

    try {
      // TODO: Implement delete API call
      // await apiRequest(`/installment-invoices/invoices/${invoice.installmentinvoicedtl_id}`, {
      //   method: 'DELETE'
      // });
      console.log('Delete invoice:', invoice);
      setOpenActionMenu(null);
      setActionMenuPosition(null);
      // Refresh the list
      fetchInvoices();
    } catch (err) {
      setError(err.message || 'Failed to delete invoice');
      console.error('Error deleting invoice:', err);
      setOpenActionMenu(null);
      setActionMenuPosition(null);
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
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Installment Invoice Logs</h1>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Search Bar */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center space-x-4">
          <div className="flex-1 relative">
                            <input
                              type="text"
                              value={nameSearchTerm}
                              onChange={(e) => setNameSearchTerm(e.target.value)}
              placeholder="Search by student name or program..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />
                            {nameSearchTerm && (
                              <button
                onClick={() => setNameSearchTerm('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
          {filterStatus && (
                          <button
              onClick={() => setFilterStatus('')}
              className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Clear Status Filter
                          </button>
                          )}
                        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-lg shadow">
        {/* Desktop Table View */}
        <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
          <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1100px' }}>
            <colgroup>
              <col style={{ width: '140px' }} />
              <col style={{ width: '150px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '100px' }} />
              <col style={{ width: '100px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '120px' }} />
              <col style={{ width: '80px' }} />
            </colgroup>
            <thead className="bg-white">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Student Name
                      </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Program Name
                      </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Amount (Excl.)
                      </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Amount (Incl.)
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        Frequency
                      </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Next Generation
                      </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Next Month
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Phase Progress
                </th>
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  Action
                      </th>
                    </tr>
                  </thead>
            <tbody className="bg-[#ffffff] divide-y divide-gray-200">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-12 text-center">
                    <p className="text-gray-500">
                      {nameSearchTerm || filterStatus
                        ? 'No invoices found matching your criteria.'
                        : 'No installment invoices found.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((invoice) => (
                  <tr key={invoice.installmentinvoicedtl_id}>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {invoice.student_name || '-'}
                          </div>
                        </td>
                    <td className="px-3 py-4">
                          <div className="text-sm text-gray-900">
                        {invoice.program_name || '-'}
                          </div>
                        </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                        {invoice.total_amount_excluding_tax !== null && invoice.total_amount_excluding_tax !== undefined
                          ? `₱${parseFloat(invoice.total_amount_excluding_tax).toFixed(2)}`
                          : '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 font-medium">
                        {invoice.total_amount_including_tax !== null && invoice.total_amount_including_tax !== undefined
                          ? `₱${parseFloat(invoice.total_amount_including_tax).toFixed(2)}`
                          : '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                        {invoice.frequency || '-'}
                          </div>
                        </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                        {invoice.next_generation_date
                          ? formatDateManila(invoice.next_generation_date)
                          : '-'}
                          </div>
                        </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                        {invoice.next_invoice_month
                          ? formatDateManila(invoice.next_invoice_month)
                          : '-'}
                          </div>
                        </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      {invoice.total_phases !== null && invoice.total_phases !== undefined ? (
                        <div className="flex flex-col">
                          <div className="text-sm text-gray-900 font-medium">
                            {/* Use generated_phases (generated invoices count) for phase progress */}
                            {(invoice.generated_phases || invoice.generated_count || 0)} / {invoice.total_phases}
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                            <div 
                              className={`h-2 rounded-full ${
                                (invoice.generated_phases || invoice.generated_count || 0) >= invoice.total_phases 
                                  ? 'bg-green-500' 
                                  : 'bg-blue-500'
                              }`}
                              style={{ 
                                width: `${Math.min(((invoice.generated_phases || invoice.generated_count || 0) / invoice.total_phases) * 100, 100)}%` 
                              }}
                            ></div>
                          </div>
                          {(invoice.generated_phases || invoice.generated_count || 0) >= invoice.total_phases && (
                            <span className="text-xs text-green-600 font-medium mt-1">Completed</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-center">
                      <div className="relative action-menu-dropdown">
                            <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const buttonRect = e.currentTarget.getBoundingClientRect();
                            if (openActionMenu === invoice.installmentinvoicedtl_id) {
                              setOpenActionMenu(null);
                              setActionMenuPosition(null);
                            } else {
                              setOpenActionMenu(invoice.installmentinvoicedtl_id);
                              // Calculate available space
                              const viewportHeight = window.innerHeight;
                              const viewportWidth = window.innerWidth;
                              const spaceBelow = viewportHeight - buttonRect.bottom;
                              const spaceAbove = buttonRect.top;
                              const estimatedDropdownHeight = 150; // Approximate height for menu items
                              
                              // Determine vertical position (above or below)
                              let top, bottom;
                              if (spaceBelow >= estimatedDropdownHeight) {
                                top = buttonRect.bottom + 4;
                                bottom = 'auto';
                              } else if (spaceAbove >= estimatedDropdownHeight) {
                                bottom = viewportHeight - buttonRect.top + 4;
                                top = 'auto';
                              } else {
                                if (spaceBelow > spaceAbove) {
                                  top = buttonRect.bottom + 4;
                                  bottom = 'auto';
                                } else {
                                  bottom = viewportHeight - buttonRect.top + 4;
                                  top = 'auto';
                                }
                              }
                              
                              setActionMenuPosition({
                                top: top !== 'auto' ? top : undefined,
                                bottom: bottom !== 'auto' ? bottom : undefined,
                                right: viewportWidth - buttonRect.right,
                                left: undefined,
                              });
                            }
                          }}
                          className="text-gray-400 hover:text-gray-600 transition-colors"
                          title="More options"
                            >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                ))
              )}
                  </tbody>
                </table>
              </div>
        </div>

      {/* Action Menu Overlay */}
      {openActionMenu && actionMenuPosition && createPortal(
        <>
          <div 
            className="fixed inset-0 z-40 bg-transparent"
            onClick={() => {
              setOpenActionMenu(null);
              setActionMenuPosition(null);
            }}
          />
          <div 
            className="fixed action-menu-overlay bg-white rounded-md shadow-lg z-50 border border-gray-200 w-48 max-h-[calc(100vh-2rem)] overflow-y-auto"
            style={{
              ...(actionMenuPosition.top !== undefined && { top: `${actionMenuPosition.top}px` }),
              ...(actionMenuPosition.bottom !== undefined && { bottom: `${actionMenuPosition.bottom}px` }),
              ...(actionMenuPosition.right !== undefined && { right: `${actionMenuPosition.right}px` }),
              ...(actionMenuPosition.left !== undefined && { left: `${actionMenuPosition.left}px` }),
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              {(() => {
                const invoice = filteredInvoices.find(inv => inv.installmentinvoicedtl_id === openActionMenu);
                if (!invoice) return null;
                return (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewEdit(invoice);
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      View and Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGenerateInvoice(invoice);
                      }}
                      disabled={invoice.total_phases !== null && invoice.total_phases !== undefined && (invoice.generated_count || 0) >= invoice.total_phases}
                      className={`block w-full text-left px-4 py-2 text-sm transition-colors ${
                        invoice.total_phases !== null && invoice.total_phases !== undefined && (invoice.generated_count || 0) >= invoice.total_phases
                          ? 'text-gray-400 cursor-not-allowed'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      Generate Invoice
                      {invoice.total_phases !== null && invoice.total_phases !== undefined && (invoice.generated_count || 0) >= invoice.total_phases && (
                        <span className="ml-2 text-xs">(Limit Reached)</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(invoice);
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      Delete
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Results Count */}
      {filteredInvoices.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredInvoices.length} of {invoices.length} invoices
        </div>
      )}

      {/* Generate Invoice Modal */}
      {isGenerateModalOpen && selectedInvoiceForGeneration && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeGenerateModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  GENERATE INVOICE - SINGLE
                </h2>
                <div className="text-sm text-gray-500 mt-1">
                  <p>Generate invoice for {selectedInvoiceForGeneration.student_name}</p>
                  {selectedInvoiceForGeneration.total_phases !== null && selectedInvoiceForGeneration.total_phases !== undefined && (
                    <p className="mt-1">
                      Phase Progress: {selectedInvoiceForGeneration.generated_count || 0} / {selectedInvoiceForGeneration.total_phases} invoices generated
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={closeGenerateModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleGenerateSubmit} className="flex flex-col flex-1 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Current Invoice Detail */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Current Invoice Detail</h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Issue Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={generateFormData.issue_date}
                        onChange={(e) => {
                          const nextIssueYmd = e.target.value;
                          const issue = parseYmdLocalNoon(nextIssueYmd);
                          if (!issue) {
                            setGenerateFormData({ ...generateFormData, issue_date: nextIssueYmd });
                            return;
                          }

                          // Due date = 5th of next month (automated schedule)
                          const due = new Date(issue);
                          due.setMonth(due.getMonth() + 1); // Next month
                          due.setDate(5); // Due on 5th

                          const invoiceMonth = new Date(issue);
                          invoiceMonth.setDate(1);

                          const months = getFrequencyMonths(selectedInvoiceForGeneration?.frequency);
                          const nextInvoiceMonth = new Date(invoiceMonth);
                          nextInvoiceMonth.setMonth(nextInvoiceMonth.getMonth() + months);
                          nextInvoiceMonth.setDate(1);

                          // Next generation on 25th of next invoice month
                          const nextIssue = new Date(nextInvoiceMonth);
                          nextIssue.setDate(25);

                          // Next due on 5th of month after next invoice month
                          const nextDue = new Date(nextInvoiceMonth);
                          nextDue.setMonth(nextDue.getMonth() + 1);
                          nextDue.setDate(5);

                          setGenerateFormData({
                            ...generateFormData,
                            issue_date: nextIssueYmd,
                            due_date: formatYmd(due),
                            invoice_month: formatYmd(invoiceMonth),
                            generation_date: formatYmd(issue),
                            next_issue_date: formatYmd(nextIssue),
                            next_due_date: formatYmd(nextDue),
                            next_invoice_month: formatYmd(nextInvoiceMonth),
                            next_generation_date: formatYmd(nextIssue),
                          });
                        }}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                          generateFormErrors.issue_date ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      />
                      {generateFormErrors.issue_date && (
                        <p className="text-red-500 text-xs mt-1">{generateFormErrors.issue_date}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Due Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={generateFormData.due_date}
                        onChange={(e) => setGenerateFormData({ ...generateFormData, due_date: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                          generateFormErrors.due_date ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      />
                      {generateFormErrors.due_date && (
                        <p className="text-red-500 text-xs mt-1">{generateFormErrors.due_date}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Invoice Month <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={generateFormData.invoice_month}
                        onChange={(e) => setGenerateFormData({ ...generateFormData, invoice_month: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                          generateFormErrors.invoice_month ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      />
                      {generateFormErrors.invoice_month && (
                        <p className="text-red-500 text-xs mt-1">{generateFormErrors.invoice_month}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Generation Date
                      </label>
                      <input
                        type="date"
                        value={generateFormData.generation_date}
                        onChange={(e) => setGenerateFormData({ ...generateFormData, generation_date: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>

                  {/* Next Invoice Detail */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Next Invoice Detail</h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Next Invoice Issue Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={generateFormData.next_issue_date}
                        onChange={(e) => setGenerateFormData({ ...generateFormData, next_issue_date: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                          generateFormErrors.next_issue_date ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      />
                      {generateFormErrors.next_issue_date && (
                        <p className="text-red-500 text-xs mt-1">{generateFormErrors.next_issue_date}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Next Invoice Due Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={generateFormData.next_due_date}
                        onChange={(e) => setGenerateFormData({ ...generateFormData, next_due_date: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                          generateFormErrors.next_due_date ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      />
                      {generateFormErrors.next_due_date && (
                        <p className="text-red-500 text-xs mt-1">{generateFormErrors.next_due_date}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Next Invoice Month <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={generateFormData.next_invoice_month}
                        onChange={(e) => {
                          const picked = parseYmdLocalNoon(e.target.value);
                          if (!picked) {
                            setGenerateFormData({ ...generateFormData, next_invoice_month: e.target.value });
                            return;
                          }

                          const monthFirst = new Date(picked);
                          monthFirst.setDate(1);
                          const due = new Date(monthFirst);
                          due.setDate(7);

                          setGenerateFormData({
                            ...generateFormData,
                            next_invoice_month: formatYmd(monthFirst),
                            next_issue_date: formatYmd(monthFirst),
                            next_due_date: formatYmd(due),
                            next_generation_date: formatYmd(monthFirst),
                          });
                        }}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                          generateFormErrors.next_invoice_month ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      />
                      {generateFormErrors.next_invoice_month && (
                        <p className="text-red-500 text-xs mt-1">{generateFormErrors.next_invoice_month}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Next Invoice Generation Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={generateFormData.next_generation_date}
                        onChange={(e) => setGenerateFormData({ ...generateFormData, next_generation_date: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                          generateFormErrors.next_generation_date ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      />
                      {generateFormErrors.next_generation_date && (
                        <p className="text-red-500 text-xs mt-1">{generateFormErrors.next_generation_date}</p>
                      )}
                    </div>
                  </div>
                </div>

                {generateFormErrors.submit && (
                  <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                    {generateFormErrors.submit}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 flex-shrink-0">
                <button
                  type="button"
                  onClick={closeGenerateModal}
                  className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  disabled={generating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={generating}
                >
                  {generating ? 'Generating...' : 'Generate'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default InstallmentInvoice;

