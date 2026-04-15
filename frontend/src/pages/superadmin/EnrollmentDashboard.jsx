import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import { DashboardStatIcon } from '../../components/dashboard/DashboardStatIcons';

const COLORS = ['#22C55E', '#94A3B8', '#F7C844', '#4F46E5'];

const StatsCard = ({ title, value, iconName, accent, description }) => (
  <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition-all hover:shadow-md">
    <div className="flex items-start justify-between">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{value.toLocaleString()}</p>
        {description && (
          <p className="mt-2 text-xs text-gray-500 leading-snug">{description}</p>
        )}
      </div>
      <div className={`ml-4 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${accent}`}>
        <DashboardStatIcon name={iconName} className="h-6 w-6 text-white drop-shadow-sm" />
      </div>
    </div>
  </div>
);

const ChartCard = ({ title, subtitle, children, className = '' }) => (
  <div className={`rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 ${className}`}>
    <div className="mb-4">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
    </div>
    <div className="h-72">{children}</div>
  </div>
);

const EnrollmentDashboard = () => {
  const { userInfo } = useAuth();
  const { selectedBranchId } = useGlobalBranchFilter();
  const userType = userInfo?.userType || userInfo?.user_type;
  const branchId = userInfo?.branchId ?? userInfo?.branch_id;
  const showBranchFilter = userType === 'Superadmin' || (userType === 'Finance' && (branchId === null || branchId === undefined));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (selectedBranchId) params.set('branch_id', selectedBranchId);
      const res = await apiRequest(`/dashboard/enrollment?${params.toString()}`);
      setData(res.data);
    } catch (err) {
      setError(err?.message || 'Failed to load enrollment dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedBranchId]);

  const pieData = useMemo(() => {
    if (!data) return [];
    const active = data.active_students ?? 0;
    const inactive = data.inactive_students ?? 0;
    return [
      { name: 'Active', value: active, fill: COLORS[0] },
      { name: 'Inactive', value: inactive, fill: COLORS[1] },
    ].filter((d) => d.value > 0);
  }, [data]);

  const monthlyEnrollments = useMemo(() => data?.monthly_enrollments ?? [], [data]);
  const byBranch = useMemo(() => data?.active_inactive_by_branch ?? [], [data]);
  const branches = useMemo(() => data?.branches ?? [], [data]);
  const selectedBranchName = useMemo(() => {
    if (!selectedBranchId) return 'All Branches';
    const b = branches.find((x) => String(x.branch_id) === String(selectedBranchId));
    return b?.branch_name ?? 'All Branches';
  }, [selectedBranchId, branches]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-[#F7C844] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-800">{error}</p>
      </div>
    );
  }

  const totalStudents = data?.total_students ?? 0;
  const activeStudents = data?.active_students ?? 0;
  const inactiveStudents = data?.inactive_students ?? 0;
  const reservedOnly = data?.reserved_only_count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enrollment Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Active and inactive students, reservations, and enrollment trends.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={fetchData}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {showBranchFilter && selectedBranchId && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-800">
          Viewing: <span className="font-semibold">{selectedBranchName}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Students"
          value={totalStudents}
          iconName="users"
          accent="bg-gradient-to-br from-slate-400 to-slate-500"
          description="All students in the system (active + inactive)."
        />
        <StatsCard
          title="Active Students"
          value={activeStudents}
          iconName="checkCircle"
          accent="bg-gradient-to-br from-emerald-400 to-emerald-500"
          description="Currently enrolled in at least one class."
        />
        <StatsCard
          title="Inactive Students"
          value={inactiveStudents}
          iconName="userMinus"
          accent="bg-gradient-to-br from-amber-400 to-amber-500"
          description="Not enrolled in any class (e.g. new, dropped, or reserved only)."
        />
        <StatsCard
          title="Reserved Only"
          value={reservedOnly}
          iconName="clipboardList"
          accent="bg-gradient-to-br from-indigo-400 to-indigo-500"
          description="Have a reservation but no active enrollment yet."
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="Active vs Inactive"
          subtitle="Students currently enrolled in at least one class vs not enrolled."
        >
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, '']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              No student data to display.
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Enrollments by Month"
          subtitle="New enrollments in the last 6 months."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyEnrollments} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Enrollments" fill="#F7C844" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {byBranch.length > 0 && (
        <ChartCard
          title="Active vs Inactive by Branch"
          subtitle="Student counts per branch (all branches view)."
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={byBranch}
              margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              layout="vertical"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
              <YAxis type="category" dataKey="branch_name" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="active" name="Active" stackId="a" fill={COLORS[0]} radius={[0, 0, 0, 0]} />
              <Bar dataKey="inactive" name="Inactive" stackId="a" fill={COLORS[1]} radius={[0, 0, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
};

export default EnrollmentDashboard;
