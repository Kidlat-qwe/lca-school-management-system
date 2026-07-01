import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';
import FixedTablePagination, { TablePaginationSummary } from '../../components/table/FixedTablePagination';
import { appAlert } from '../../utils/appAlert';
import { fetchAllInstallmentInvoicePages } from '../../utils/fetchAllInstallmentInvoicePages';
import InstallmentInvoicePhasesModal from '../../components/installmentInvoice/InstallmentInvoicePhasesModal';

const ITEMS_PER_PAGE = 10;

const FinanceInstallmentInvoice = () => {
  const [searchParams] = useSearchParams();
  const highlightedProfileId = parseInt(searchParams.get('profile_id') || '', 10) || null;
  const highlightedStudentName = searchParams.get('student_name') || '';
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);
  const [openActionMenu, setOpenActionMenu] = useState(null);
  const [actionMenuPosition, setActionMenuPosition] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [phasesModalProfileId, setPhasesModalProfileId] = useState(null);

  useEffect(() => {
    fetchInvoices();
  }, []);

  useEffect(() => {
    if (highlightedStudentName) {
      setNameSearchTerm(highlightedStudentName);
    }
  }, [highlightedStudentName]);

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
      const data = await fetchAllInstallmentInvoicePages(apiRequest);
      setInvoices(data);
    } catch (err) {
      setError(err.message || 'Failed to fetch installment invoices');
      console.error('Error fetching invoices:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredInvoices = invoices.filter((invoice) => {
    const matchesSearch = !nameSearchTerm ||
      invoice.student_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      invoice.class_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      invoice.program_name?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    const matchesStatus = !filterStatus || invoice.status === filterStatus;
    
    return matchesSearch && matchesStatus;
  });
  const totalPages = Math.max(Math.ceil(filteredInvoices.length / ITEMS_PER_PAGE), 1);
  const paginatedInvoices = filteredInvoices.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [nameSearchTerm, filterStatus]);

  useEffect(() => {
    setCurrentPage((prevPage) => Math.min(prevPage, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!highlightedProfileId) return;
    const targetIndex = filteredInvoices.findIndex(
      (invoice) => Number(invoice.installmentinvoiceprofiles_id) === highlightedProfileId
    );
    if (targetIndex >= 0) {
      setCurrentPage(Math.floor(targetIndex / ITEMS_PER_PAGE) + 1);
    }
  }, [filteredInvoices, highlightedProfileId]);

  const handleViewEdit = (invoice) => {
    setOpenActionMenu(null);
    setActionMenuPosition(null);
    const profileId = invoice?.installmentinvoiceprofiles_id;
    if (!profileId) {
      appAlert('No installment plan found for this record.');
      return;
    }
    setPhasesModalProfileId(profileId);
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
              placeholder="Search by student name, class, or program..."
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
        {filteredInvoices.length > 0 && (
          <TablePaginationSummary
            page={currentPage}
            totalItems={filteredInvoices.length}
            itemsPerPage={ITEMS_PER_PAGE}
            itemLabel="invoices"
            className="px-4 pt-4 pb-2"
          />
        )}
        <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
          <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1240px' }}>
            <colgroup>
              <col style={{ width: '140px' }} />
              <col style={{ width: '150px' }} />
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
                  Class Name
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
                  <td colSpan="10" className="px-6 py-12 text-center">
                    <p className="text-gray-500">
                      {nameSearchTerm || filterStatus
                        ? 'No matching invoices. Try adjusting your search or filters.'
                        : 'No installment invoices found.'}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedInvoices.map((invoice) => (
                  <tr
                    key={invoice.installmentinvoicedtl_id ?? `profile-${invoice.installmentinvoiceprofiles_id}`}
                    className={
                      Number(invoice.installmentinvoiceprofiles_id) === highlightedProfileId
                        ? 'bg-amber-50'
                        : ''
                    }
                  >
                    <td className="px-3 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {invoice.student_name || '-'}
                          </div>
                        </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">
                        {invoice.class_name || '-'}
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
                        {(invoice.current_generation_date || invoice.next_generation_date)
                          ? formatDateManila(
                              invoice.current_generation_date || invoice.next_generation_date
                            )
                          : '-'}
                          </div>
                        </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                        {(invoice.current_invoice_month || invoice.next_invoice_month)
                          ? formatDateManila(
                              invoice.current_invoice_month || invoice.next_invoice_month
                            )
                          : '-'}
                          </div>
                        </td>
                    <td className="px-3 py-4 whitespace-nowrap">
                      {(() => {
                        const numerator =
                          invoice.phase_progress_numerator != null
                            ? Number(invoice.phase_progress_numerator)
                            : Number(invoice.display_phase_progress || 0);
                        const denominator =
                          invoice.phase_progress_denominator != null
                            ? Number(invoice.phase_progress_denominator)
                            : invoice.total_phases != null
                              ? Number(invoice.total_phases)
                              : null;
                        if (denominator === null || denominator === undefined) {
                          return <span className="text-sm text-gray-400">-</span>;
                        }
                        const isComplete = numerator >= denominator;
                        // Bar fill reflects the relative paid-vs-billed
                        // progress for THIS plan profile (e.g. 1 of 5
                        // phases paid = 20%), not the absolute calendar
                        // position (6/10 = 60%). Keeps the bar visually
                        // honest about how much of the plan has been paid.
                        const relativePaid = Number(invoice.display_phase_progress || 0);
                        const relativeTotal =
                          invoice.total_phases != null ? Number(invoice.total_phases) : 0;
                        const percent = relativeTotal > 0
                          ? Math.min((relativePaid / relativeTotal) * 100, 100)
                          : 0;
                        return (
                          <div className="flex flex-col">
                            <div className="text-sm text-gray-900 font-medium">
                              {numerator} / {denominator}
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                              <div
                                className={`h-2 rounded-full ${
                                  isComplete ? 'bg-green-500' : 'bg-blue-500'
                                }`}
                                style={{ width: `${percent}%` }}
                              ></div>
                            </div>
                            {isComplete && (
                              <span className="text-xs text-green-600 font-medium mt-1">Completed</span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-center">
                      <div className="relative action-menu-dropdown">
                            <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const buttonRect = e.currentTarget.getBoundingClientRect();
                            if (openActionMenu === (invoice.installmentinvoicedtl_id ?? `profile-${invoice.installmentinvoiceprofiles_id}`)) {
                              setOpenActionMenu(null);
                              setActionMenuPosition(null);
                            } else {
                              setOpenActionMenu(invoice.installmentinvoicedtl_id ?? `profile-${invoice.installmentinvoiceprofiles_id}`);
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
        <FixedTablePagination
          page={currentPage}
          totalPages={totalPages}
          totalItems={filteredInvoices.length}
          itemsPerPage={ITEMS_PER_PAGE}
          itemLabel="invoices"
          onPageChange={setCurrentPage}
        />
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
                const invoice = filteredInvoices.find(inv => (inv.installmentinvoicedtl_id ?? `profile-${inv.installmentinvoiceprofiles_id}`) === openActionMenu);
                if (!invoice) return null;
                return (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleViewEdit(invoice);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    View Details
                  </button>
                );
              })()}
            </div>
          </div>
        </>,
        document.body
      )}

      <InstallmentInvoicePhasesModal
        open={phasesModalProfileId != null}
        profileId={phasesModalProfileId}
        onClose={() => setPhasesModalProfileId(null)}
      />
    </div>
  );
};

export default FinanceInstallmentInvoice;

