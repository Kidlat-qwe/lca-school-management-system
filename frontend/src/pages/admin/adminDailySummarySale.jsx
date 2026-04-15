import { useState, useEffect } from 'react';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { todayManilaYMD, formatDateManila } from '../../utils/dateUtils';

const TAB_SUBMIT = 'submit';
const TAB_DETAILS = 'details';

const AdminDailySummarySale = () => {
  const { userInfo } = useAuth();
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  const [branchName, setBranchName] = useState(userInfo?.branch_nickname || userInfo?.branch_name || '');
  const [activeTab, setActiveTab] = useState(TAB_SUBMIT);
  const [preview, setPreview] = useState(null);
  const [existing, setExisting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [todayPayments, setTodayPayments] = useState([]);
  const [summaryHistory, setSummaryHistory] = useState([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const today = todayManilaYMD();

  const fetchPreview = async () => {
    try {
      const res = await apiRequest(`/daily-summary-sales/preview?date=${today}`);
      if (res.success && res.data) {
        setPreview(res.data);
        if (Array.isArray(res.data.payments)) {
          setTodayPayments(res.data.payments);
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to load preview');
    }
  };

  const fetchCheckToday = async () => {
    try {
      const res = await apiRequest('/daily-summary-sales/check-today');
      if (res.success && res.data?.submitted && res.data?.record) {
        setExisting(res.data.record);
      } else {
        setExisting(null);
      }
    } catch (err) {
      console.error('Check today error:', err);
      setExisting(null);
    }
  };

  const fetchTodayPayments = async () => {
    setDetailsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('issue_date', today);
      params.set('limit', '500');
      if (adminBranchId) {
        params.set('branch_id', String(adminBranchId));
      }
      const res = await apiRequest(`/payments?${params.toString()}`);
      setTodayPayments(res.data || []);
    } catch (err) {
      console.error('Fetch today payments error:', err);
      setTodayPayments([]);
    } finally {
      setDetailsLoading(false);
    }
  };

  const fetchSummaryHistory = async () => {
    try {
      const res = await apiRequest('/daily-summary-sales?limit=100');
      setSummaryHistory(res.data || []);
    } catch (err) {
      console.error('Fetch summary history error:', err);
      setSummaryHistory([]);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      await Promise.all([fetchPreview(), fetchCheckToday()]);
      setLoading(false);
    };
    load();
  }, [today]);

  useEffect(() => {
    const fetchBranchName = async () => {
      if (userInfo?.branch_nickname || userInfo?.branch_name) {
        setBranchName(userInfo.branch_nickname || userInfo.branch_name);
        return;
      }
      if (adminBranchId) {
        try {
          const res = await apiRequest(`/branches/${adminBranchId}`);
          if (res?.data) {
            const d = res.data;
            setBranchName(d.branch_nickname || d.branch_name || '');
          }
        } catch (err) {
          console.error('Fetch branch name error:', err);
        }
      }
    };
    fetchBranchName();
  }, [adminBranchId, userInfo?.branch_nickname, userInfo?.branch_name]);

  useEffect(() => {
    if (activeTab === TAB_DETAILS) {
      // Today payments now come from preview endpoint (kept in sync with total)
      fetchSummaryHistory();
    }
  }, [activeTab, today]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      await apiRequest('/daily-summary-sales', {
        method: 'POST',
        body: JSON.stringify({ summary_date: today }),
      });
      setSuccess('Daily summary submitted successfully and auto-verified.');
      await fetchCheckToday();
      await fetchPreview();
      if (activeTab === TAB_DETAILS) {
        fetchSummaryHistory();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to submit';
      setError(msg);
      if (err.response?.status === 409) {
        fetchCheckToday();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status) => {
    const classes = {
      Submitted: 'bg-yellow-100 text-yellow-800',
      Approved: 'bg-green-100 text-green-800',
      Rejected: 'bg-amber-100 text-amber-800',
    };
    const label = status === 'Approved' ? 'Verified' : status === 'Rejected' ? 'Flagged' : status;
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${classes[status] || 'bg-gray-100 text-gray-800'}`}>
        {label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Daily Summary Sale</h1>
        <p className="mt-1 text-sm text-gray-600">
          Submit your branch&apos;s daily sales closing. Amount is auto-calculated from Payment Logs for today.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4" aria-label="Tabs">
          <button
            type="button"
            onClick={() => setActiveTab(TAB_SUBMIT)}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === TAB_SUBMIT
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Submit Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab(TAB_DETAILS)}
            className={`py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === TAB_DETAILS
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Details
          </button>
        </nav>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      {activeTab === TAB_SUBMIT && (
        <>
          {/* Stat cards row - uses full width */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Branch</p>
              <p className="mt-1 text-base font-semibold text-gray-900 truncate" title={branchName || 'Branch'}>{branchName || '—'}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Summary Date</p>
              <p className="mt-1 text-base font-semibold text-gray-900">{formatDateManila(today)}</p>
              <p className="text-xs text-primary-600 font-medium mt-0.5">Today</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Amount</p>
              <p className="mt-1 text-xl font-bold text-gray-900">
                ₱{(preview?.total_amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">From Payment Logs</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Payments Count</p>
              <p className="mt-1 text-2xl font-bold text-primary-600">{preview?.payment_count ?? 0}</p>
              <p className="text-xs text-gray-500 mt-0.5">transactions today</p>
            </div>
          </div>

          {/* Main action - two columns on md+, no card background */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            {/* Left: status + submit */}
            <div>
              {existing && (
                <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 mb-4">
                  <p className="text-sm font-medium text-green-800">
                    End of day already submitted for today. Status: <span className="font-semibold">{existing.status}</span>
                  </p>
                  {existing.submitted_at && (
                    <p className="text-xs text-green-700 mt-1">
                      Submitted at: {formatDateManila(existing.submitted_at)}
                    </p>
                  )}
                  <p className="text-xs text-green-700 mt-2">Only one EOD per day is allowed. You can submit again on the next business day.</p>
                </div>
              )}
              <form onSubmit={handleSubmit}>
                <button
                  type="submit"
                  disabled={submitting || !!existing}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed py-2 px-4 text-sm font-medium rounded-lg"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Submitting...
                    </span>
                  ) : (
                    'Submit Daily Summary'
                  )}
                </button>
              </form>
            </div>
            {/* Right: guidelines */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Guidelines</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex gap-2">
                  <span className="text-primary-500 mt-0.5 shrink-0">•</span>
                  <span>Only one submission per branch per calendar day. Totals include all payments dated today for this branch.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary-500 mt-0.5 shrink-0">•</span>
                  <span>Amount is calculated from all payments in Payment Logs for your branch with today&apos;s date.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-primary-500 mt-0.5 shrink-0">•</span>
                  <span>Your submission is auto-verified after it is sent.</span>
                </li>
              </ul>
              <p className="mt-4 text-xs text-gray-500">
                Need to verify payments? Switch to the <strong>Details</strong> tab to see today&apos;s payment list and submission history.
              </p>
            </div>
          </div>
        </>
      )}

      {activeTab === TAB_DETAILS && (
        <div className="space-y-8">
          {/* Today's payments breakdown */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-base font-semibold text-gray-900">Today&apos;s Payments ({formatDateManila(today)})</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Payments included in the daily summary total. Total: ₱{(preview?.total_amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({preview?.payment_count ?? 0} payment(s))
              </p>
            </div>
            <div
              className="overflow-x-auto"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
            >
              <table className="min-w-full divide-y divide-gray-200" style={{ width: '100%', minWidth: '640px' }}>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Invoice</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Student</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Method</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700">Amount</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Ref. No.</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {detailsLoading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-500">Loading...</td>
                    </tr>
                  ) : todayPayments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-gray-500">No payments for today yet.</td>
                    </tr>
                  ) : (
                    todayPayments.map((p) => (
                      <tr key={p.payment_id}>
                        <td className="px-4 py-2 text-sm text-gray-900">{p.invoice_description || `INV-${p.invoice_id}`}</td>
                        <td className="px-4 py-2 text-sm text-gray-700">{p.student_name || '-'}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{p.payment_method || '-'}</td>
                        <td className="px-4 py-2 text-sm text-right font-medium text-gray-900">
                          ₱{(Number(p.payable_amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">{p.reference_number || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Submission history */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-base font-semibold text-gray-900">Submission History</h2>
              <p className="text-xs text-gray-500 mt-0.5">Past daily summaries for this branch</p>
            </div>
            <div
              className="overflow-x-auto"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}
            >
              <table className="min-w-full divide-y divide-gray-200" style={{ width: '100%', minWidth: '640px' }}>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Date</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700">Amount</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-gray-700">Payments</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Submitted</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700">Verified By</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {summaryHistory.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-500">No submissions yet.</td>
                    </tr>
                  ) : (
                    summaryHistory.map((s) => (
                      <tr key={s.daily_summary_id}>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{formatDateManila(s.summary_date)}</td>
                        <td className="px-4 py-2 text-sm text-right font-medium text-gray-900">
                          ₱{(Number(s.total_amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-2 text-sm text-center text-gray-600">{s.payment_count ?? 0}</td>
                        <td className="px-4 py-2">{statusBadge(s.status)}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {s.submitted_at ? formatDateManila(s.submitted_at) : '-'}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-600">{s.approved_by_name || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDailySummarySale;
