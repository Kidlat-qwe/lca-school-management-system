import { useState, useEffect } from 'react';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const SuperfinanceFinancialDashboard = () => {
  const { userInfo } = useAuth();
  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    pendingInvoices: 0,
    completedPayments: 0,
    unpaidInvoices: 0,
    totalBranches: 0,
    revenueByBranch: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recentInvoices, setRecentInvoices] = useState([]);
  const [recentPayments, setRecentPayments] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [branches, setBranches] = useState([]);

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [selectedBranchId]);

  const fetchBranches = async () => {
    try {
      const response = await apiRequest('/branches');
      setBranches(response.data || []);
      setMetrics(prev => ({
        ...prev,
        totalBranches: response.data?.length || 0,
      }));
    } catch (err) {
      console.error('Error fetching branches:', err);
    }
  };

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError('');

      // Ensure branches are loaded first - fetch if needed
      let branchesData = branches;
      if (branchesData.length === 0) {
        try {
          const branchesResponse = await apiRequest('/branches');
          branchesData = branchesResponse.data || [];
        } catch (err) {
          console.error('Error fetching branches in dashboard:', err);
        }
      }

      // Build query params
      const params = new URLSearchParams();
      params.append('limit', '100');
      if (selectedBranchId) {
        params.append('branch_id', selectedBranchId);
      }

      // Fetch invoices and payments in parallel
      const [invoicesResponse, paymentsResponse] = await Promise.all([
        apiRequest(`/invoices?${params.toString()}`),
        apiRequest(`/payments?${params.toString()}`),
      ]);

      const invoices = invoicesResponse.data || [];
      const payments = paymentsResponse.data || [];

      // Calculate metrics
      const completedPayments = payments.filter(p => p.status === 'Completed');
      const totalRevenue = completedPayments.reduce((sum, p) => sum + (parseFloat(p.payable_amount) || 0), 0);
      const pendingInvoices = invoices.filter(i => i.status === 'Unpaid' || i.status === 'Partial').length;
      const unpaidInvoices = invoices.filter(i => i.status === 'Unpaid').length;

      // Calculate revenue by branch
      const revenueByBranchMap = new Map();
      completedPayments.forEach(payment => {
        const branchId = payment.branch_id;
        // Try to get branch name from payment data first, then from branches array
        let branchName = payment.branch_name;
        if (!branchName && branchId && branchesData.length > 0) {
          const branch = branchesData.find(b => b.branch_id === branchId);
          branchName = branch?.branch_name || null;
        }
        // If still no name, use a fallback
        if (!branchName && branchId) {
          branchName = `Branch ${branchId}`;
        }
        const amount = parseFloat(payment.payable_amount) || 0;

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
        .slice(0, 5); // Top 5 branches

      setMetrics({
        totalRevenue,
        pendingInvoices,
        completedPayments: completedPayments.length,
        unpaidInvoices,
        totalBranches: branches.length,
        revenueByBranch,
      });

      // Get recent invoices (last 3)
      const recentInvoicesList = invoices
        .sort((a, b) => new Date(b.issue_date || 0) - new Date(a.issue_date || 0))
        .slice(0, 3);
      setRecentInvoices(recentInvoicesList);

      // Get recent payments (last 3)
      const recentPaymentsList = payments
        .filter(p => p.status === 'Completed')
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 3);
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

  const selectedBranchName = selectedBranchId
    ? branches.find(b => b.branch_id === parseInt(selectedBranchId))?.branch_name || 'All Branches'
    : 'All Branches';

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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Financial Dashboard</h1>
          <p className="mt-2 text-sm text-gray-600">Welcome to the Superfinance Dashboard - Manage all branches</p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          >
            <option value="">All Branches</option>
            {branches.map((branch) => (
              <option key={branch.branch_id} value={branch.branch_id}>
                {branch.branch_name}
              </option>
            ))}
          </select>
          <button
            onClick={fetchDashboardData}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 014 9m0 0h5m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16" />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Branch Filter Indicator */}
      {selectedBranchId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <p className="text-sm text-blue-700">
            Showing data for: <span className="font-semibold">{selectedBranchName}</span>
          </p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
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

        {/* Total Branches Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Branches</p>
              <p className="mt-2 text-2xl font-bold text-gray-900">
                {metrics.totalBranches}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="h-6 w-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
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

      {/* Revenue by Branch and Recent Activity Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue by Branch */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Top Revenue by Branch</h2>
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
                        <div className={`flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                          index === 0 ? 'bg-yellow-100 text-yellow-800' :
                          index === 1 ? 'bg-gray-100 text-gray-800' :
                          index === 2 ? 'bg-orange-100 text-orange-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          {formattedBranch ? (
                            <>
                              <p className="text-sm font-medium text-gray-900 leading-tight">
                                {formattedBranch.company}
                              </p>
                              {formattedBranch.location && (
                                <p className="text-xs text-gray-600 leading-tight mt-0.5">
                                  {formattedBranch.location}
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-sm font-medium text-gray-900 leading-tight">
                              {branch.branch_name}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 ml-2 text-right">
                        <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {formatCurrency(branch.revenue)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

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

export default SuperfinanceFinancialDashboard;
