import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../../config/api';
import FinancialDashboardDateFilter from '../../components/dashboard/FinancialDashboardDateFilter';
import { appAlert } from '../../utils/appAlert';
import { firstDayOfMonthManilaYMD, formatDateManila, todayManilaYMD } from '../../utils/dateUtils';
import { DashboardStatIcon } from '../../components/dashboard/DashboardStatIcons';

const FinanceFinancialDashboard = () => {
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    pendingInvoices: 0,
    completedPayments: 0,
    unpaidInvoices: 0,
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

      const invParams = new URLSearchParams();
      if (issueDateFrom.trim()) invParams.set('issue_date_from', issueDateFrom.trim());
      if (issueDateTo.trim()) invParams.set('issue_date_to', issueDateTo.trim());
      const invoiceQuery = invParams.toString();
      const invoiceUrl = invoiceQuery ? `/invoices?${invoiceQuery}` : '/invoices';

      const fetchAllPayments = async () => {
        const limit = 100;
        let page = 1;
        let allPayments = [];
        let totalPages = 1;
        do {
          const pageParams = new URLSearchParams();
          if (issueDateFrom.trim()) pageParams.set('issue_date_from', issueDateFrom.trim());
          if (issueDateTo.trim()) pageParams.set('issue_date_to', issueDateTo.trim());
          pageParams.set('limit', String(limit));
          pageParams.set('page', String(page));
          const response = await apiRequest(`/payments?${pageParams.toString()}`);
          const pageData = response.data || [];
          allPayments = allPayments.concat(pageData);
          totalPages = response.pagination?.totalPages || 1;
          page += 1;
        } while (page <= totalPages);
        return allPayments;
      };

      const [invoicesResponse, payments] = await Promise.all([
        apiRequest(invoiceUrl),
        fetchAllPayments(),
      ]);

      const invoices = invoicesResponse.data || [];

      const completedPayments = payments.filter((p) => p.status === 'Completed');
      const totalRevenue = completedPayments.reduce((sum, p) => sum + (parseFloat(p.payable_amount) || 0), 0);
      const pendingInvoices = invoices.filter((i) => i.status === 'Unpaid' || i.status === 'Partial').length;
      const unpaidInvoices = invoices.filter((i) => i.status === 'Unpaid').length;

      setMetrics({
        totalRevenue,
        pendingInvoices,
        completedPayments: completedPayments.length,
        unpaidInvoices,
      });

      const recentInvoicesList = invoices
        .sort((a, b) => new Date(b.issue_date || 0) - new Date(a.issue_date || 0))
        .slice(0, 2);
      setRecentInvoices(recentInvoicesList);

      const recentPaymentsList = payments
        .filter((p) => p.status === 'Completed')
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 2);
      setRecentPayments(recentPaymentsList);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [issueDateFrom, issueDateTo]);

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
          <p className="mt-2 text-sm text-gray-600">Welcome to the Finance Dashboard</p>
          {issueDateFrom || issueDateTo ? (
            <p className="mt-2 text-xs text-primary-700 font-medium">
              {activeSummary}
            </p>
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
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
              <p className="text-sm font-medium text-gray-600">Completed Payments</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.completedPayments}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
              <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                      <p className="text-sm font-semibold text-green-600">{formatCurrency(payment.payable_amount)}</p>
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

export default FinanceFinancialDashboard;
