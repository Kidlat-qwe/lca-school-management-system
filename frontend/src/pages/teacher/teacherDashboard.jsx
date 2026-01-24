const TeacherDashboard = () => {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-2 text-sm text-gray-600">Welcome to the Teacher Dashboard</p>
        </div>
  
        {/* Placeholder Content */}
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="max-w-md mx-auto">
            <svg
              className="mx-auto h-16 w-16 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <h2 className="mt-4 text-xl font-semibold text-gray-900">Teacher Dashboard</h2>
            <p className="mt-2 text-gray-600">
              This is a placeholder dashboard for Teacher users. Content will be added here in the future.
            </p>
          </div>
        </div>
      </div>
    );
  };
  
  export default TeacherDashboard;
  
  