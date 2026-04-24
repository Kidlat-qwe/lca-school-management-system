import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import FinancialDashboardDateFilter from '../../components/dashboard/FinancialDashboardDateFilter';
import { appAlert } from '../../utils/appAlert';
import { firstDayOfMonthManilaYMD, formatDateManila, todayManilaYMD } from '../../utils/dateUtils';
import { DashboardStatIcon } from '../../components/dashboard/DashboardStatIcons';

const SuperfinanceFinancialDashboard = () => {
  const navigate = useNavigate();
  const { selectedBranchId, branches, selectedBranchName } = useGlobalBranchFilter();
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    pendingInvoices: 0,
    completedPayments: 0,
    unpaidInvoices: 0,
    totalBranches: 0,
    revenueByBranch: [],
    verifiedPaymentsCount: 0,
    verifiedPaymentsAmount: 0,
    unverifiedPaymentsCount: 0,
    unverifiedPaymentsAmount: 0,
    arSalesCount: 0,
    arSalesAmount: 0,
    arVerifiedCount: 0,
    arVerifiedAmount: 0,
    arUnverifiedCount: 0,
    arUnverifiedAmount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recentInvoices, setRecentInvoices] = useState([]);
  const [recentPayments, setRecentPayments] = useState([]);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const [issueDateFrom, setIssueDateFrom] = useState('');
  const [issueDateTo, setIssueDateTo] = useState('');

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      let branchesData = branches;
      if (branchesData.length === 0) {
        try {
          const branchesResponse = await apiRequest('/branches');
          branchesData = branchesResponse.data || [];
        } catch (err) {
          console.error('Error fetching branches in dashboard:', err);
        }
      }

      const baseParams = new URLSearchParams();
      if (selectedBranchId) {
        baseParams.append('branch_id', selectedBranchId);
      }
      if (issueDateFrom.trim()) {
        baseParams.append('issue_date_from', issueDateFrom.trim());
      }
      if (issueDateTo.trim()) {
        baseParams.append('issue_date_to', issueDateTo.trim());
      }

      const fetchAllPayments = async () => {
        const limit = 100;
        let page = 1;
        let allPayments = [];
        let totalPages = 1;

        do {
          const pageParams = new URLSearchParams(baseParams.toString());
          pageParams.append('limit', String(limit));
          pageParams.append('page', String(page));

          const response = await apiRequest(`/payments?${pageParams.toString()}`);
          const pageData = response.data || [];
          allPayments = allPayments.concat(pageData);
          totalPages = response.pagination?.totalPages || 1;
          page += 1;
        } while (page <= totalPages);

        return allPayments;
      };
      const fetchAllAcknowledgementReceipts = async () => {
        const limit = 100;
        let page = 1;
        let allReceipts = [];
        let totalPages = 1;
        do {
          const pageParams = new URLSearchParams();
          if (selectedBranchId) {
            pageParams.append('branch_id', selectedBranchId);
          }
          pageParams.append('limit', String(limit));
          pageParams.append('page', String(page));
          const response = await apiRequest(`/acknowledgement-receipts?${pageParams.toString()}`);
          const pageData = response.data || [];
          allReceipts = allReceipts.concat(pageData);
          totalPages = response.pagination?.totalPages || 1;
          page += 1;
        } while (page <= totalPages);
        return allReceipts;
      };

      const invoiceQs = baseParams.toString();
      const [invoicesResponse, payments, acknowledgementReceipts] = await Promise.all([
        apiRequest(invoiceQs ? `/invoices?${invoiceQs}` : '/invoices'),
        fetchAllPayments(),
        fetchAllAcknowledgementReceipts(),
      ]);

      const invoices = invoicesResponse.data || [];

      const paymentTotalAmount = (payment) => (parseFloat(payment?.payable_amount) || 0) + (parseFloat(payment?.tip_amount) || 0);
      const completedPayments = payments.filter((p) => p.status === 'Completed');
      const totalRevenue = completedPayments.reduce((sum, p) => sum + paymentTotalAmount(p), 0);
      const verifiedPayments = completedPayments.filter((p) => (p.approval_status || 'Pending') === 'Approved');
      const unverifiedPayments = completedPayments.filter((p) => (p.approval_status || 'Pending') !== 'Approved');
      const pendingInvoices = invoices.filter((i) => i.status === 'Unpaid' || i.status === 'Partial').length;
      const unpaidInvoices = invoices.filter((i) => i.status === 'Unpaid').length;
      const packageAr = (acknowledgementReceipts || []).filter((ar) => ar.ar_type === 'Package');
      const arIncludedSales = packageAr.filter((ar) => !['Rejected', 'Cancelled'].includes(ar.status || 'Submitted'));
      const arVerified = packageAr.filter((ar) => ['Verified', 'Applied'].includes(ar.status));
      const arUnverified = packageAr.filter((ar) => !['Verified', 'Applied', 'Rejected', 'Cancelled'].includes(ar.status || 'Submitted'));
      const arAmount = (ar) => (parseFloat(ar.payment_amount) || 0) + (parseFloat(ar.tip_amount) || 0);

      const revenueByBranchMap = new Map();
      completedPayments.forEach((payment) => {
        const branchId = payment.branch_id;
        let branchName = payment.branch_name;
        if (!branchName && branchId && branchesData.length > 0) {
          const branch = branchesData.find((b) => b.branch_id === branchId);
          branchName = branch?.branch_name || null;
        }
        if (!branchName && branchId) {
          branchName = `Branch ${branchId}`;
        }
        const amount = paymentTotalAmount(payment);

        if (revenueByBranchMap.has(branchId)) {
          revenueByBranchMap.set(branchId, {
            branch_id: branchId,
            branch_name: branchName || `Branch ${branchId}`,
            revenue: revenueByBranchMap.get(branchId).revenue + amount,
          });
        } else {
          revenueByBranchMap.set(branchId, {
            branch_id: branchId,
            branch_name: branchName || `Branch ${branchId}`,
            revenue: amount,
          });
        }
      });
      const revenueByBranch = Array.from(revenueByBranchMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      setMetrics({
        totalRevenue,
        pendingInvoices,
        completedPayments: completedPayments.length,
        unpaidInvoices,
        totalBranches: branchesData.length,
        revenueByBranch,
        verifiedPaymentsCount: verifiedPayments.length,
        verifiedPaymentsAmount: verifiedPayments.reduce((sum, p) => sum + paymentTotalAmount(p), 0),
        unverifiedPaymentsCount: unverifiedPayments.length,
        unverifiedPaymentsAmount: unverifiedPayments.reduce((sum, p) => sum + paymentTotalAmount(p), 0),
        arSalesCount: arIncludedSales.length,
        arSalesAmount: arIncludedSales.reduce((sum, ar) => sum + arAmount(ar), 0),
        arVerifiedCount: arVerified.length,
        arVerifiedAmount: arVerified.reduce((sum, ar) => sum + arAmount(ar), 0),
        arUnverifiedCount: arUnverified.length,
        arUnverifiedAmount: arUnverified.reduce((sum, ar) => sum + arAmount(ar), 0),
      });

      const recentInvoicesList = invoices
        .sort((a, b) => new Date(b.issue_date || 0) - new Date(a.issue_date || 0))
        .slice(0, 3);
      setRecentInvoices(recentInvoicesList);

      const recentPaymentsList = payments
        .filter((p) => p.status === 'Completed')
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 3);
      setRecentPayments(recentPaymentsList);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, issueDateFrom, issueDateTo]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleApplyFilter = () => {
    if (draftFrom && draftTo && draftFrom > draftTo) {
      appAlert('Start date must be on or before end date.');
      return;
    }
    setIssueDateFrom(draftFrom.trim());
    setIssueDateTo(draftTo.trim());
  };

  const handleClearFilter = () => {
    setDraftFrom('');
    setDraftTo('');
    setIssueDateFrom('');
    setIssueDateTo('');
  };

  const handleThisMonth = () => {
    const from = firstDayOfMonthManilaYMD();
    const to = todayManilaYMD();
    setDraftFrom(from);
    setDraftTo(to);
    setIssueDateFrom(from);
    setIssueDateTo(to);
  };

  const activeSummary =
    issueDateFrom || issueDateTo
      ? `Applied: ${issueDateFrom ? formatDateManila(issueDateFrom) : '…'} — ${
          issueDateTo ? formatDateManila(issueDateTo) : '…'
        } (issue dates, inclusive)`
      : 'No date filter — totals include all invoice and payment issue dates.';

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '₱0.00';
    return `₱${parseFloat(amount).toFixed(2)}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
  const openArByVerification = (type) => {
    const params = new URLSearchParams();
    params.set('page', '1');
    if (type === 'verified') {
      params.set('status', 'Verified,Applied');
    } else {
      params.set('status', 'Submitted,Pending,Paid');
    }
    navigate(`/superfinance/acknowledgement-receipts?${params.toString()}`);
  };
  const openPaymentLogsByVerification = (type) => {
    const params = new URLSearchParams();
    params.set('notificationTab', 'main');
    params.set('financeApproval', type === 'verified' ? 'approved' : 'pending');
    navigate(`/superfinance/payment-logs?${params.toString()}`);
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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Financial Dashboard</h1>
          <p className="mt-2 text-sm text-gray-600">Welcome to the Superfinance Dashboard - Manage all branches</p>
          {issueDateFrom || issueDateTo ? (
            <p className="mt-2 text-xs text-primary-700 font-medium">{activeSummary}</p>
          ) : (
            <p className="mt-2 text-xs text-gray-500">{activeSummary}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <FinancialDashboardDateFilter
            draftFrom={draftFrom}
            draftTo={draftTo}
            onDraftFromChange={setDraftFrom}
            onDraftToChange={setDraftTo}
            onApply={handleApplyFilter}
            onClear={handleClearFilter}
            onThisMonth={handleThisMonth}
            activeSummary={activeSummary}
            onPrepareOpen={() => {
              setDraftFrom(issueDateFrom);
              setDraftTo(issueDateTo);
            }}
          />
          <button
            type="button"
            onClick={fetchDashboardData}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 014 9m0 0h5m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {selectedBranchId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <p className="text-sm text-blue-700">
            Showing data for: <span className="font-semibold">{selectedBranchName}</span>
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Revenue</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatCurrency(metrics.totalRevenue)}
              </p>
              <p className="mt-1 text-xs text-gray-500">Completed payments in range</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
              <DashboardStatIcon name="currency" className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Acknowledgement Receipt Sales</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{formatCurrency(metrics.arSalesAmount)}</p>
              <p className="mt-1 text-xs text-gray-500">{metrics.arSalesCount} receipt(s) in selected range</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-violet-100 flex items-center justify-center">
              <DashboardStatIcon name="clipboardList" className="h-6 w-6 text-violet-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Branches</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.totalBranches}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
              <DashboardStatIcon name="building" className="h-6 w-6 text-purple-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Completed Payments</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.completedPayments}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
              <DashboardStatIcon name="checkCircle" className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Pending Invoices</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.pendingInvoices}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-yellow-100 flex items-center justify-center">
              <DashboardStatIcon name="clock" className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Unpaid Invoices</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.unpaidInvoices}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
              <DashboardStatIcon name="exclamationTriangle" className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button
          type="button"
          onClick={() => openPaymentLogsByVerification('verified')}
          className="bg-white rounded-lg shadow p-6 text-left hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Verified Payments</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{metrics.verifiedPaymentsCount}</p>
              <p className="mt-1 text-xs text-gray-500">{formatCurrency(metrics.verifiedPaymentsAmount)} total amount</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-teal-100 flex items-center justify-center">
              <DashboardStatIcon name="shieldCheck" className="h-6 w-6 text-teal-600" />
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => openPaymentLogsByVerification('unverified')}
          className="bg-white rounded-lg shadow p-6 text-left hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Unverified Payments</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">{metrics.unverifiedPaymentsCount}</p>
              <p className="mt-1 text-xs text-gray-500">{formatCurrency(metrics.unverifiedPaymentsAmount)} total amount</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
              <DashboardStatIcon name="clock" className="h-6 w-6 text-amber-600" />
            </div>
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button
          type="button"
          onClick={() => openArByVerification('verified')}
          className="bg-white rounded-lg shadow p-6 text-left hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Verified AR</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.arVerifiedCount}
              </p>
              <p className="mt-1 text-xs text-gray-500">{formatCurrency(metrics.arVerifiedAmount)} total amount</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
              <DashboardStatIcon name="shieldCheck" className="h-6 w-6 text-emerald-600" />
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => openArByVerification('unverified')}
          className="bg-white rounded-lg shadow p-6 text-left hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Unverified AR</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.arUnverifiedCount}
              </p>
              <p className="mt-1 text-xs text-gray-500">{formatCurrency(metrics.arUnverifiedAmount)} total amount</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
              <DashboardStatIcon name="clock" className="h-6 w-6 text-amber-600" />
            </div>
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Top Revenue by Branch</h2>
            <p className="text-xs text-gray-500 mt-0.5">From completed payments in current filter (issue dates)</p>
          </div>
          <div className="p-6">
            {metrics.revenueByBranch.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No revenue data available</p>
            ) : (
              <div className="space-y-4">
                {metrics.revenueByBranch.map((branch, index) => {
                  const formattedBranch = formatBranchName(branch.branch_name);
                  return (
                    <div key={branch.branch_id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <div
                          className={`flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                            index === 0
                              ? 'bg-yellow-100 text-yellow-800'
                              : index === 1
                                ? 'bg-gray-100 text-gray-800'
                                : index === 2
                                  ? 'bg-orange-100 text-orange-800'
                                  : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          {formattedBranch ? (
                            <>
                              <p className="text-sm font-medium text-gray-900 leading-tight">{formattedBranch.company}</p>
                              {formattedBranch.location && (
                                <p className="text-xs text-gray-600 leading-tight mt-0.5">{formattedBranch.location}</p>
                              )}
                            </>
                          ) : (
                            <p className="text-sm font-medium text-gray-900 leading-tight">{branch.branch_name}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 ml-2 text-right">
                        <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(branch.revenue)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Invoices</h2>
            <p className="text-xs text-gray-500 mt-0.5">Latest in current filter (by issue date)</p>
          </div>
          <div className="p-6">
            {recentInvoices.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No recent invoices</p>
            ) : (
              <div className="space-y-4">
                {recentInvoices.map((invoice) => (
                  <div
                    key={invoice.invoice_id}
                    className="flex items-center justify-between pb-4 border-b border-gray-100 last:border-b-0 last:pb-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">INV-{invoice.invoice_id}</p>
                      <p className="text-xs text-gray-500 mt-1 truncate">{invoice.invoice_description || '-'}</p>
                      <p className="text-xs text-gray-400 mt-1">{formatDate(invoice.issue_date)}</p>
                    </div>
                    <div className="ml-4 text-right">
                      <p className="text-sm font-semibold text-gray-900">{formatCurrency(invoice.amount)}</p>
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
                          invoice.status === 'Paid'
                            ? 'bg-green-100 text-green-800'
                            : invoice.status === 'Unpaid'
                              ? 'bg-red-100 text-red-800'
                              : invoice.status === 'Partial'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {invoice.status || 'Draft'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Payments</h2>
            <p className="text-xs text-gray-500 mt-0.5">Latest completed in current filter (by issue date)</p>
          </div>
          <div className="p-6">
            {recentPayments.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No recent payments</p>
            ) : (
              <div className="space-y-4">
                {recentPayments.map((payment) => (
                  <div
                    key={payment.payment_id}
                    className="flex items-center justify-between pb-4 border-b border-gray-100 last:border-b-0 last:pb-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{payment.student_name || 'N/A'}</p>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        INV-{payment.invoice_id} • {payment.payment_method || '-'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">{formatDate(payment.issue_date)}</p>
                    </div>
                    <div className="ml-4 text-right">
                      <p className="text-sm font-semibold text-green-600">{formatCurrency((parseFloat(payment.payable_amount) || 0) + (parseFloat(payment.tip_amount) || 0))}</p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium mt-1 bg-green-100 text-green-800">
                        {payment.status || 'Completed'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuperfinanceFinancialDashboard;
