import { DashboardStatIcon } from '../../components/dashboard/DashboardStatIcons';

const TeacherDashboard = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-sm text-gray-600">Welcome to the Teacher Dashboard</p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm sm:p-12">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25 ring-1 ring-indigo-500/20">
            <DashboardStatIcon name="academicCap" className="h-10 w-10 text-white drop-shadow-sm" />
          </div>
          <h2 className="mt-6 text-xl font-semibold tracking-tight text-gray-900">Teacher Dashboard</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            This is a placeholder dashboard for Teacher users. Content will be added here in the future.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TeacherDashboard;
