import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const COLORS = ['#F7C844', '#4F46E5', '#22C55E', '#F97316', '#14B8A6', '#EC4899'];

const StatsCard = ({ title, value, icon, accent, subtitle }) => (
  <div className="group relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition-all duration-300 hover:shadow-lg hover:ring-gray-200">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <p className="mt-3 text-3xl font-bold tracking-tight text-gray-900">{value}</p>
        {subtitle && <p className="mt-2 text-xs font-medium text-gray-500">{subtitle}</p>}
      </div>
      <div className={`ml-4 flex h-14 w-14 items-center justify-center rounded-xl ${accent} shadow-sm transition-transform duration-300 group-hover:scale-110`}>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
    <div className={`absolute inset-x-0 bottom-0 h-1 ${accent.replace('bg-', 'bg-gradient-to-r from-').replace('/80', ' to-transparent')}`} />
  </div>
);

const ChartCard = ({ title, subtitle, children, className = '' }) => (
  <div className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 ${className}`}>
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
    </div>
    <div className="h-72">{children}</div>
  </div>
);

const formatCurrency = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₱0.00';
  return `₱${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const AdminDashboard = () => {
  const { userInfo } = useAuth();
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;

  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [rooms, setRooms] = useState([]);
  const [roomStats, setRoomStats] = useState(null);
  const [loadingRoomStats, setLoadingRoomStats] = useState(false);

  const branchName = useMemo(() => {
    return userInfo?.branch_name || userInfo?.branchName || 'Your Branch';
  }, [userInfo]);

  const fetchDashboardData = async () => {
    if (!adminBranchId) return;
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      params.append('branch_id', String(adminBranchId));
      const response = await apiRequest(`/dashboard?${params.toString()}`);
      setMetrics(response.data);
    } catch (err) {
      setError(err.message || 'Unable to load dashboard data right now.');
    } finally {
      setLoading(false);
    }
  };

  const fetchRooms = async () => {
    if (!adminBranchId) return;
    try {
      const params = new URLSearchParams();
      params.append('branch_id', String(adminBranchId));
      const response = await apiRequest(`/rooms?${params.toString()}`);
      setRooms(response.data || []);
    } catch (err) {
      console.error('Error fetching rooms:', err);
    }
  };

  const fetchRoomStats = async (roomId) => {
    if (!roomId || !adminBranchId) {
      setRoomStats(null);
      return;
    }

    try {
      setLoadingRoomStats(true);

      // Fetch classes for this branch (pagination-safe)
      const params = new URLSearchParams();
      params.append('limit', '100');
      params.append('branch_id', String(adminBranchId));

      let allClasses = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const pageParams = new URLSearchParams(params);
        pageParams.append('page', String(page));
        const classesResponse = await apiRequest(`/classes?${pageParams.toString()}`);
        const classes = classesResponse.data || [];
        allClasses = [...allClasses, ...classes];

        if (classesResponse.pagination) {
          hasMore = page < classesResponse.pagination.totalPages;
          page += 1;
        } else {
          hasMore = classes.length === 100;
          page += 1;
        }
        if (page > 50) break;
      }

      const classesInRoom = allClasses.filter((c) => c.room_id === parseInt(roomId, 10));
      const totalEnrolled = classesInRoom.reduce((sum, cls) => sum + (parseInt(cls.enrolled_students, 10) || 0), 0);
      const selectedRoom = rooms.find((r) => r.room_id === parseInt(roomId, 10));

      setRoomStats({
        room_id: parseInt(roomId, 10),
        room_name: selectedRoom?.room_name || 'Room',
        total_classes: classesInRoom.length,
        total_enrolled_students: totalEnrolled,
        classes: classesInRoom.map((cls) => ({
          class_id: cls.class_id,
          class_name: cls.class_name || cls.level_tag || `Class ${cls.class_id}`,
          program_name: cls.program_name,
          enrolled_students: parseInt(cls.enrolled_students, 10) || 0,
        })),
      });
    } catch (err) {
      console.error('Error fetching room stats:', err);
      setRoomStats(null);
    } finally {
      setLoadingRoomStats(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    fetchRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminBranchId]);

  useEffect(() => {
    if (selectedRoomId) fetchRoomStats(selectedRoomId);
    else setRoomStats(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId, adminBranchId, rooms]);

  const totals = metrics?.totals || { total_branches: 0, total_students: 0, total_teachers: 0, active_classes: 0 };

  const monthlyEnrollments = useMemo(() => metrics?.monthly_enrollments || [], [metrics]);
  const invoiceTrend = useMemo(() => metrics?.invoice_trend || [], [metrics]);
  const invoiceStatus = useMemo(() => metrics?.invoice_status || [], [metrics]);
  const reservationStatus = useMemo(() => metrics?.reservation_status || [], [metrics]);

  const totalInvoiceAmount = useMemo(() => {
    return (invoiceStatus || []).reduce((sum, row) => sum + (Number(row.total_amount) || 0), 0);
  }, [invoiceStatus]);

  const crossingProcedures = useMemo(
    () => metrics?.crossing_procedures || { total_violations: 0, violations: [] },
    [metrics]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      <div className="mx-auto max-w-7xl space-y-8 p-6 lg:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Dashboard</h1>
            <p className="text-sm text-gray-500">Branch overview: {branchName}</p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[220px]">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Filter by Room
              </label>
              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                className="w-full rounded-xl border-0 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition-all focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
                disabled={loading}
              >
                <option value="">All Rooms</option>
                {rooms.map((room) => (
                  <option key={room.room_id} value={room.room_id}>
                    {room.room_name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={fetchDashboardData}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 transition-all hover:bg-gray-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
              disabled={!adminBranchId}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 014 9m0 0h5m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 shadow-sm ring-1 ring-red-100">
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium text-red-800">{error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Students (Branch)"
            value={(totals.total_students || 0).toLocaleString()}
            accent="bg-gradient-to-br from-emerald-400 to-emerald-500"
            icon="🎓"
          />
          <StatsCard
            title="Teachers (Branch)"
            value={(totals.total_teachers || 0).toLocaleString()}
            accent="bg-gradient-to-br from-indigo-400 to-indigo-500"
            icon="👩‍🏫"
          />
          <StatsCard
            title="Active Classes"
            value={(totals.active_classes || 0).toLocaleString()}
            accent="bg-gradient-to-br from-orange-400 to-orange-500"
            icon="📚"
          />
          <StatsCard
            title="Total Invoice Amount"
            value={formatCurrency(totalInvoiceAmount)}
            subtitle="Sum of invoice totals by status"
            accent="bg-gradient-to-br from-yellow-400 to-yellow-500"
            icon="💳"
          />
        </div>

        {selectedRoomId && (
          <div className="rounded-2xl border border-purple-200 bg-white shadow-sm ring-1 ring-purple-100">
            <div className="border-b border-purple-100 bg-gradient-to-r from-purple-50 to-pink-50 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100">
                    <svg className="h-6 w-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-purple-900">
                      Room: {roomStats?.room_name || rooms.find((r) => r.room_id === parseInt(selectedRoomId, 10))?.room_name || 'Room'}
                    </h2>
                    <p className="text-sm text-purple-700">
                      {loadingRoomStats
                        ? 'Loading room statistics...'
                        : roomStats
                          ? `${roomStats.total_classes} class(es) • ${roomStats.total_enrolled_students} enrolled student(s)`
                          : 'No data available'}
                    </p>
                  </div>
                </div>
                {roomStats && !loadingRoomStats && (
                  <div className="text-right">
                    <p className="text-2xl font-bold text-purple-900">{roomStats.total_enrolled_students}</p>
                    <p className="text-xs text-purple-600">Total Enrolled</p>
                  </div>
                )}
              </div>
            </div>
            {loadingRoomStats ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              </div>
            ) : roomStats?.classes?.length ? (
              <div
                className="overflow-x-auto rounded-lg"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 #f7fafc',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <table style={{ width: '100%', minWidth: '600px' }} className="divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Class Name</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Program</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Enrolled Students</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {roomStats.classes.map((cls) => (
                      <tr key={cls.class_id} className="transition-colors hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{cls.class_name}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">{cls.program_name || 'N/A'}</td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                            {cls.enrolled_students}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="px-6 py-12 text-center">
                <p className="text-gray-500">No classes found in this room.</p>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Monthly Enrollment Trend" subtitle="Past 6 months (branch)">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyEnrollments} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="colorEnrollAdmin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F7C844" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#F7C844" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} stroke="#94a3b8" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  }}
                />
                <Area type="monotone" dataKey="count" stroke="#F7C844" strokeWidth={2.5} fill="url(#colorEnrollAdmin)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Monthly Invoice Revenue" subtitle="Issued amounts per month (branch)">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={invoiceTrend} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="colorRevenueAdmin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" stroke="#94a3b8" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value) => [formatCurrency(value), 'Amount']}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  }}
                />
                <Area type="monotone" dataKey="total" stroke="#4F46E5" strokeWidth={2.5} fill="url(#colorRevenueAdmin)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Invoice Status" subtitle="Count of invoices by status (branch)">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={invoiceStatus} dataKey="count" nameKey="status" innerRadius={65} outerRadius={95} paddingAngle={2}>
                  {invoiceStatus.map((entry, index) => (
                    <Cell key={`invoice-${entry.status}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, _name, props) => [`${value}`, props?.payload?.status]}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Reservation Status" subtitle="Current reservations (branch)">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={reservationStatus} dataKey="count" nameKey="status" outerRadius={100} innerRadius={50} paddingAngle={2}>
                  {reservationStatus.map((entry, index) => (
                    <Cell key={`reservation-${entry.status}`} fill={COLORS[(index + 2) % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {crossingProcedures.total_violations > 0 && (
          <div className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm ring-1 ring-red-100">
            <div className="border-b border-red-100 bg-gradient-to-r from-red-50 to-pink-50 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
                    <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-red-900">Crossing Procedures Alert</h2>
                    <p className="text-sm text-red-700">{crossingProcedures.total_violations} record(s) found</p>
                  </div>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-200 text-sm font-bold text-red-900">
                  {crossingProcedures.total_violations}
                </div>
              </div>
            </div>
            <div
              className="overflow-x-auto rounded-lg"
              style={{
                scrollbarWidth: 'thin',
                scrollbarColor: '#cbd5e0 #f7fafc',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <table style={{ width: '100%', minWidth: '1000px' }}>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Student</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Student Branch</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Class</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Class Branch</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Program</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Phase</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-gray-700">Enrolled At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {crossingProcedures.violations.map((violation) => (
                    <tr key={violation.classstudent_id} className="transition-colors hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{violation.student_name}</td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                          {violation.student_branch_name}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                        {violation.class_name || violation.level_tag || `Class ${violation.class_id}`}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800">
                          {violation.class_branch_name}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">{violation.program_name || 'N/A'}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                        {violation.phase_number ? `Phase ${violation.phase_number}` : 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                        {violation.enrolled_at
                          ? new Date(violation.enrolled_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                          : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-gray-200 pt-6">
          {metrics?.updated_at && (
            <p className="text-xs text-gray-500">
              Last updated: <span className="font-medium">{new Date(metrics.updated_at).toLocaleString()}</span>
            </p>
          )}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Loading statistics...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;

