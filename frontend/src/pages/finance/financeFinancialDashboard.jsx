import { useState, useEffect } from 'react';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const FinanceFinancialDashboard = () => {
  const { userInfo } = useAuth();
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

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError('');

      // Fetch invoices and payments in parallel
      const [invoicesResponse, paymentsResponse] = await Promise.all([
        apiRequest('/invoices?limit=100'),
        apiRequest('/payments?limit=100'),
      ]);

      const invoices = invoicesResponse.data || [];
      const payments = paymentsResponse.data || [];

      // Calculate metrics
      const completedPayments = payments.filter(p => p.status === 'Completed');
      const totalRevenue = completedPayments.reduce((sum, p) => sum + (parseFloat(p.payable_amount) || 0), 0);
      const pendingInvoices = invoices.filter(i => i.status === 'Unpaid' || i.status === 'Partial').length;
      const unpaidInvoices = invoices.filter(i => i.status === 'Unpaid').length;

      setMetrics({
        totalRevenue,
        pendingInvoices,
        completedPayments: completedPayments.length,
        unpaidInvoices,
      });

      // Get recent invoices (last 2)
      const recentInvoicesList = invoices
        .sort((a, b) => new Date(b.issue_date || 0) - new Date(a.issue_date || 0))
        .slice(0, 2);
      setRecentInvoices(recentInvoicesList);

      // Get recent payments (last 2)
      const recentPaymentsList = payments
        .filter(p => p.status === 'Completed')
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 2);
      setRecentPayments(recentPaymentsList);

    } catch (err) {
      setError(err.message || 'Failed to load dashboard data');
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

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
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Financial Dashboard</h1>
        <p className="mt-2 text-sm text-gray-600">Welcome to the Finance Dashboard</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Revenue Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Revenue</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {formatCurrency(metrics.totalRevenue)}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Completed Payments Card */}
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

        {/* Pending Invoices Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Pending Invoices</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.pendingInvoices}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-yellow-100 flex items-center justify-center">
              <svg className="h-6 w-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Unpaid Invoices Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Unpaid Invoices</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.unpaidInvoices}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Invoices</h2>
          </div>
          <div className="p-6">
            {recentInvoices.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No recent invoices</p>
            ) : (
              <div className="space-y-4">
                {recentInvoices.map((invoice) => (
                  <div key={invoice.invoice_id} className="flex items-center justify-between pb-4 border-b border-gray-100 last:border-b-0 last:pb-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        INV-{invoice.invoice_id}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {invoice.invoice_description || '-'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDate(invoice.issue_date)}
                      </p>
                    </div>
                    <div className="ml-4 text-right">
                      <p className="text-sm font-semibold text-gray-900">
                        {formatCurrency(invoice.amount)}
                      </p>
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

        {/* Recent Payments */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Payments</h2>
          </div>
          <div className="p-6">
            {recentPayments.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No recent payments</p>
            ) : (
              <div className="space-y-4">
                {recentPayments.map((payment) => (
                  <div key={payment.payment_id} className="flex items-center justify-between pb-4 border-b border-gray-100 last:border-b-0 last:pb-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {payment.student_name || 'N/A'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        INV-{payment.invoice_id} • {payment.payment_method || '-'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {formatDate(payment.issue_date)}
                      </p>
                    </div>
                    <div className="ml-4 text-right">
                      <p className="text-sm font-semibold text-green-600">
                        {formatCurrency(payment.payable_amount)}
                      </p>
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
