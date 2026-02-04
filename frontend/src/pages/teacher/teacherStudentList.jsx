import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const TeacherStudentList = () => {
  const { userInfo } = useAuth();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [filterLevelTag, setFilterLevelTag] = useState('');
  const [openLevelTagDropdown, setOpenLevelTagDropdown] = useState(false);
  const [levelTagDropdownRect, setLevelTagDropdownRect] = useState(null);
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  const [imageErrors, setImageErrors] = useState(new Set());

  // Get teacher's branch_id from userInfo
  const teacherBranchId = userInfo?.branch_id || userInfo?.branchId;

  useEffect(() => {
    if (teacherBranchId) {
      fetchStudents();
      fetchBranchName();
    }
  }, [teacherBranchId]);

  // Fetch branch name if not available
  const fetchBranchName = async () => {
    if (teacherBranchId && !userInfo?.branch_name) {
      try {
        const response = await apiRequest(`/branches/${teacherBranchId}`);
        if (response.data?.branch_name) {
          setSelectedBranchName(response.data.branch_name);
        }
      } catch (err) {
        console.error('Error fetching branch name:', err);
      }
    }
  };

  const fetchStudents = async () => {
    try {
      setLoading(true);
      // Get teacher's user_id
      const teacherId = userInfo?.user_id || userInfo?.userId;
      
      if (!teacherId) {
        setError('Teacher ID not found');
        setLoading(false);
        return;
      }

      // Fetch classes assigned to this teacher
      const classesResponse = await apiRequest(`/classes?branch_id=${teacherBranchId}&limit=100`);
      const allClasses = classesResponse.data || [];
      
      // Filter to only classes where this teacher is assigned
      const assignedClasses = allClasses.filter(classItem => {
        if (classItem.teacher_ids && Array.isArray(classItem.teacher_ids)) {
          return classItem.teacher_ids.some(id => parseInt(id) === teacherId);
        }
        if (classItem.teacher_id) {
          return parseInt(classItem.teacher_id) === teacherId;
        }
        return false;
      });

      // Get all students enrolled in these classes
      const studentPromises = assignedClasses.map(async (classItem) => {
        try {
          const response = await apiRequest(`/students/class/${classItem.class_id}`);
          return response.data || [];
        } catch (err) {
          console.error(`Error fetching students for class ${classItem.class_id}:`, err);
          return [];
        }
      });

      const studentsArrays = await Promise.all(studentPromises);
      
      // Flatten and deduplicate students by user_id
      const allStudents = studentsArrays.flat();
      const uniqueStudents = allStudents.reduce((acc, student) => {
        const existing = acc.find(s => s.user_id === student.user_id);
        if (!existing) {
          acc.push(student);
        }
        return acc;
      }, []);

      setStudents(uniqueStudents);
    } catch (err) {
      setError(err.message || 'Failed to fetch students');
      console.error('Error fetching students:', err);
    } finally {
      setLoading(false);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openLevelTagDropdown && !event.target.closest('.leveltag-filter-dropdown') && !event.target.closest('.leveltag-filter-dropdown-portal')) {
        setOpenLevelTagDropdown(false);
        setLevelTagDropdownRect(null);
      }
    };

    if (openLevelTagDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openLevelTagDropdown]);

  const uniqueLevelTags = [...new Set(students.map(s => s.level_tag).filter(Boolean))].sort();

  const filteredStudents = students.filter((student) => {
    const matchesUserSearch = !userSearchTerm || 
      student.full_name?.toLowerCase().includes(userSearchTerm.toLowerCase()) ||
      student.email?.toLowerCase().includes(userSearchTerm.toLowerCase());
    const matchesLevelTag = !filterLevelTag || student.level_tag === filterLevelTag;
    return matchesUserSearch && matchesLevelTag;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Student List</h1>
          <p className="text-sm text-gray-600">View students for {selectedBranchName}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {filteredStudents.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {userSearchTerm || filterLevelTag
              ? 'No students found matching your criteria.'
              : 'No students found.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div
            className="overflow-x-auto rounded-lg"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <table
              className="divide-y divide-gray-200"
              style={{ width: '100%', minWidth: '800px', tableLayout: 'fixed' }}
            >
              <colgroup>
                <col style={{ width: '200px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '90px' }} />
              </colgroup>
              <thead className="bg-white table-header-stable">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ minWidth: '200px', width: '200px' }}>
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center space-x-1 min-h-[6px]">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${userSearchTerm ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                      </div>
                      <div className="relative min-h-[28px]">
                        <input
                          type="text"
                          value={userSearchTerm}
                          onChange={(e) => setUserSearchTerm(e.target.value)}
                          placeholder="Search student..."
                          className="px-2 py-1 pr-6 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 w-full"
                          onClick={(e) => e.stopPropagation()}
                        />
                        {userSearchTerm && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setUserSearchTerm('');
                            }}
                            className="absolute right-1 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    Email
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    <div className="relative leveltag-filter-dropdown">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setLevelTagDropdownRect(rect);
                          setOpenLevelTagDropdown(!openLevelTagDropdown);
                        }}
                        className="flex items-center space-x-1 hover:text-gray-700"
                      >
                        <span>Level Tag</span>
                        <span className={`inline-flex items-center justify-center w-1.5 h-1.5 rounded-full flex-shrink-0 ${filterLevelTag ? 'bg-primary-600' : 'invisible'}`} aria-hidden />
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Phone
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '90px', minWidth: '90px' }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredStudents.map((student) => (
                  <tr key={student.user_id}>
                    <td className="px-3 py-4">
                      <div className="flex items-center min-w-0">
                        <div className="h-10 w-10 rounded-full bg-[#F7C844] flex items-center justify-center flex-shrink-0 overflow-hidden">
                          {student.profile_picture_url && !imageErrors.has(student.user_id) ? (
                            <img
                              src={student.profile_picture_url}
                              alt={student.full_name}
                              className="h-full w-full rounded-full object-cover"
                              onError={() => {
                                // Add to error set to show initials instead
                                setImageErrors(prev => new Set(prev).add(student.user_id));
                              }}
                            />
                          ) : (
                            <span className="text-[#F5B82E] font-bold text-sm">
                              {student.full_name?.charAt(0).toUpperCase() || '-'}
                            </span>
                          )}
                        </div>
                        <div className="ml-3 min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 truncate" title={student.full_name || '-'}>
                            {student.full_name || '-'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900 truncate" title={student.email || '-'}>
                        {student.email || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900 truncate">
                        {student.level_tag || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900 truncate" title={student.phone_number || '-'}>
                        {student.phone_number || '-'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          student.status === 'Active' || !student.status
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {student.status || 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredStudents.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredStudents.length} of {students.length} students
        </div>
      )}

      {/* Level Tag filter dropdown - portaled to avoid table overflow clipping */}
      {openLevelTagDropdown && levelTagDropdownRect && createPortal(
        <div
          className="fixed leveltag-filter-dropdown-portal w-40 bg-white rounded-md shadow-lg z-[100] border border-gray-200 max-h-60 overflow-y-auto py-1"
          style={{
            top: `${levelTagDropdownRect.bottom + 4}px`,
            left: `${levelTagDropdownRect.left}px`,
            minWidth: `${Math.max(levelTagDropdownRect.width, 160)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFilterLevelTag('');
              setOpenLevelTagDropdown(false);
              setLevelTagDropdownRect(null);
            }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
              !filterLevelTag ? 'bg-gray-100 font-medium' : 'text-gray-700'
            }`}
          >
            All Levels
          </button>
          {uniqueLevelTags.map((levelTag) => (
            <button
              key={levelTag}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setFilterLevelTag(levelTag);
                setOpenLevelTagDropdown(false);
                setLevelTagDropdownRect(null);
              }}
              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-100 ${
                filterLevelTag === levelTag ? 'bg-gray-100 font-medium' : 'text-gray-700'
              }`}
            >
              {levelTag}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
};

export default TeacherStudentList;

