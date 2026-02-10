import { useState, useEffect } from 'react';
import { apiRequest } from '../../config/api';

const OperationalDashboard = () => {
  const [cohortData, setCohortData] = useState([]);
  const [studentsPerClass, setStudentsPerClass] = useState([]);
  const [studentsPerTeacher, setStudentsPerTeacher] = useState([]);
  const [studentsPerRoom, setStudentsPerRoom] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branches, setBranches] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [filterProgram, setFilterProgram] = useState('');

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    if (filterBranch) {
      fetchBranchFilters(filterBranch);
    } else {
      setTeachers([]);
      setRooms([]);
      setPrograms([]);
      setFilterTeacher('');
      setFilterRoom('');
      setFilterProgram('');
    }
  }, [filterBranch]);

  useEffect(() => {
    fetchCohortData();
  }, [filterBranch, filterTeacher, filterRoom, filterProgram]);

  const fetchBranches = async () => {
    try {
      const res = await apiRequest('/branches?limit=100');
      setBranches(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Error fetching branches:', err);
    }
  };

  const fetchBranchFilters = async (branchId) => {
    try {
      const [teacherRes, roomRes, programRes] = await Promise.all([
        apiRequest(`/users?user_type=Teacher&branch_id=${branchId}&limit=100`),
        apiRequest(`/rooms?branch_id=${branchId}`),
        apiRequest('/programs?limit=100'),
      ]);
      setTeachers(Array.isArray(teacherRes.data) ? teacherRes.data : []);
      setRooms(Array.isArray(roomRes.data) ? roomRes.data : []);
      setPrograms(Array.isArray(programRes.data) ? programRes.data : []);
    } catch (err) {
      console.error('Error fetching branch filters:', err);
    }
  };

  const fetchCohortData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterBranch) params.append('branch_id', filterBranch);
      if (filterTeacher) params.append('teacher_id', filterTeacher);
      if (filterRoom) params.append('room_id', filterRoom);
      if (filterProgram) params.append('program_id', filterProgram);

      const [cohortRes, summaryRes] = await Promise.all([
        apiRequest(`/dashboard/cohort-retention?${params.toString()}`),
        apiRequest(`/dashboard/operational-summary?${params.toString()}`),
      ]);
      setCohortData(cohortRes.data?.cohorts || []);
      setStudentsPerClass(summaryRes.data?.studentsPerClass || []);
      setStudentsPerTeacher(summaryRes.data?.studentsPerTeacher || []);
      setStudentsPerRoom(summaryRes.data?.studentsPerRoom || []);
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  // Get all unique activity months from all cohorts
  const getAllActivityMonths = () => {
    const monthsSet = new Set();
    cohortData.forEach(cohort => {
      Object.keys(cohort.months || {}).forEach(month => monthsSet.add(month));
    });
    return Array.from(monthsSet).sort((a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateA - dateB;
    });
  };

  const activityMonths = getAllActivityMonths();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Operational Dashboard</h1>
        <p className="text-sm text-gray-600 mt-1">
          Cohort retention analysis: track student retention by enrollment month
        </p>
      </div>

      {/* Filters - Branch first; Teacher, Room, Program appear when branch is selected */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Filters</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Branch</label>
            <select
              value={filterBranch}
              onChange={(e) => setFilterBranch(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">All Branches</option>
              {branches.map(b => (
                <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
              ))}
            </select>
          </div>
          {filterBranch && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Teacher</label>
                <select
                  value={filterTeacher}
                  onChange={(e) => setFilterTeacher(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">All Teachers</option>
                  {teachers.map(t => (
                    <option key={t.user_id} value={t.user_id}>{t.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Room</label>
                <select
                  value={filterRoom}
                  onChange={(e) => setFilterRoom(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">All Rooms</option>
                  {rooms.map(r => (
                    <option key={r.room_id} value={r.room_id}>{r.room_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Program</label>
                <select
                  value={filterProgram}
                  onChange={(e) => setFilterProgram(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">All Programs</option>
                  {programs.map(p => (
                    <option key={p.program_id} value={p.program_id}>{p.program_name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Students per class / per teacher / per room */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-3">Students per Class</h3>
          {studentsPerClass.length === 0 ? (
            <p className="text-sm text-gray-500">No classes</p>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-80 rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: '200px' }} className="border-collapse text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase border-b border-gray-200">Class</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase border-b border-gray-200">Students</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {studentsPerClass.map((row) => (
                    <tr key={row.class_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-900">{row.class_name || row.level_tag}</td>
                      <td className="px-3 py-2 text-right font-medium">{row.student_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-3">Students per Teacher</h3>
          {studentsPerTeacher.length === 0 ? (
            <p className="text-sm text-gray-500">No teachers</p>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-80 rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: '200px' }} className="border-collapse text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase border-b border-gray-200">Teacher</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase border-b border-gray-200">Students</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {studentsPerTeacher.map((row) => (
                    <tr key={row.teacher_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-900">{row.teacher_name}</td>
                      <td className="px-3 py-2 text-right font-medium">{row.student_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-3">Students per Room</h3>
          {studentsPerRoom.length === 0 ? (
            <p className="text-sm text-gray-500">No rooms</p>
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-80 rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: '200px' }} className="border-collapse text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-700 uppercase border-b border-gray-200">Room</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase border-b border-gray-200">Students</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {studentsPerRoom.map((row) => (
                    <tr key={row.room_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-900">{row.room_name}</td>
                      <td className="px-3 py-2 text-right font-medium">{row.student_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Cohort Retention Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Cohort Retention Analysis</h3>
        
        {cohortData.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No cohort data available</p>
        ) : (
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: `${180 + activityMonths.length * 120}px` }} className="border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th className="sticky left-0 bg-gray-50 z-10 px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider border-b-2 border-gray-300" style={{ minWidth: '180px' }}>
                    Enrollment Month
                  </th>
                  {activityMonths.map(month => (
                    <th key={month} className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider border-b-2 border-gray-300" style={{ minWidth: '120px' }}>
                      {month}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {cohortData.map((cohort, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="sticky left-0 bg-white z-10 px-4 py-3 text-sm font-medium text-gray-900 border-r border-gray-200">
                      {cohort.cohort_label}
                    </td>
                    {activityMonths.map(month => {
                      const data = cohort.months[month];
                      if (!data) {
                        return <td key={month} className="px-4 py-3 text-sm text-center text-gray-400">-</td>;
                      }
                      return (
                        <td key={month} className="px-4 py-3 text-sm text-center">
                          <div className="flex flex-col">
                            <span className="font-semibold text-gray-900">{data.active}</span>
                            <span className="text-xs text-gray-500">({data.percentage}%)</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default OperationalDashboard;
