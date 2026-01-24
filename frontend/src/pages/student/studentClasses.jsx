import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const StudentClasses = () => {
  const { userInfo } = useAuth();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterProgram, setFilterProgram] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: undefined, bottom: undefined, right: undefined, left: undefined });
  const [openProgramDropdown, setOpenProgramDropdown] = useState(false);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'detail'
  const [selectedClassForDetails, setSelectedClassForDetails] = useState(null);
  const [phaseSessions, setPhaseSessions] = useState([]);
  const [loadingPhaseSessions, setLoadingPhaseSessions] = useState(false);
  const [classSessions, setClassSessions] = useState([]);
  const [loadingClassSessions, setLoadingClassSessions] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState(new Set([1])); // Phase 1 open by default
  const [programs, setPrograms] = useState([]);
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');

  // Get student's user_id from userInfo
  const studentId = userInfo?.user_id || userInfo?.userId;
  const studentBranchId = userInfo?.branch_id || userInfo?.branchId;

  useEffect(() => {
    if (studentId) {
      fetchClasses();
      fetchPrograms();
      fetchBranchName();
    }
  }, [studentId]);

  // Fetch branch name if not available
  const fetchBranchName = async () => {
    if (studentBranchId && !userInfo?.branch_name) {
      try {
        const response = await apiRequest(`/branches/${studentBranchId}`);
        if (response.data?.branch_name) {
          setSelectedBranchName(response.data.branch_name);
        }
      } catch (err) {
        console.error('Error fetching branch name:', err);
      }
    }
  };

  const fetchClasses = async () => {
    try {
      setLoading(true);
      // Fetch classes the student is enrolled in
      const response = await apiRequest(`/students/${studentId}/classes`);
      const enrolledClasses = response.data || [];
      
      setClasses(enrolledClasses);
    } catch (err) {
      setError(err.message || 'Failed to fetch classes');
      console.error('Error fetching classes:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPrograms = async () => {
    try {
      const response = await apiRequest('/programs?limit=100');
      setPrograms(response.data || []);
    } catch (err) {
      console.error('Error fetching programs:', err);
    }
  };

  const handleMenuClick = (classId, event) => {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openMenuId === classId) {
      setOpenMenuId(null);
      setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
    } else {
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const estimatedDropdownHeight = 100;
      
      let top, bottom;
      if (spaceBelow >= estimatedDropdownHeight) {
        top = rect.bottom + 4;
        bottom = 'auto';
      } else if (spaceAbove >= estimatedDropdownHeight) {
        bottom = viewportHeight - rect.top + 4;
        top = 'auto';
      } else {
        if (spaceBelow > spaceAbove) {
          top = rect.bottom + 4;
          bottom = 'auto';
        } else {
          bottom = viewportHeight - rect.top + 4;
          top = 'auto';
        }
      }
      
      let right, left;
      right = viewportWidth - rect.right;
      left = 'auto';
      
      setMenuPosition({
        top: top !== 'auto' ? top : undefined,
        bottom: bottom !== 'auto' ? bottom : undefined,
        right: right !== 'auto' ? right : undefined,
        left: left !== 'auto' ? left : undefined,
      });
      setOpenMenuId(classId);
    }
  };

  // Calculate session date based on start date, days of week, phase, and session number
  const calculateSessionDate = (startDate, daysOfWeek, phaseNumber, sessionNumber, sessionsPerPhase) => {
    if (!startDate || !daysOfWeek || daysOfWeek.length === 0) {
      return null;
    }

    const dayMap = {
      'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
      'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };

    const sortedDays = [...daysOfWeek].sort((a, b) => {
      const dayA = typeof a === 'string' ? dayMap[a] : dayMap[a.day_of_week];
      const dayB = typeof b === 'string' ? dayMap[b] : dayMap[b.day_of_week];
      return dayA - dayB;
    });

    const dayNames = sortedDays.map(day => typeof day === 'string' ? day : day.day_of_week);
    const dayNumbers = dayNames.map(day => dayMap[day]);

    const [year, month, day] = startDate.split('-').map(Number);
    const start = new Date(year, month - 1, day, 12, 0, 0);
    const startDayOfWeek = start.getDay();

    const overallSessionNumber = sessionsPerPhase 
      ? (phaseNumber - 1) * sessionsPerPhase + sessionNumber
      : sessionNumber;

    const sessionIndex = overallSessionNumber - 1;
    const dayIndexInCycle = sessionIndex % dayNames.length;
    const weekOffset = Math.floor(sessionIndex / dayNames.length);

    const targetDayName = dayNames[dayIndexInCycle];
    const targetDayNumber = dayMap[targetDayName];
    const firstDayNumber = dayNumbers[0];
    
    let baseDate;
    let baseDayOfWeek;
    
    if (dayNumbers.includes(startDayOfWeek)) {
      baseDate = new Date(year, month - 1, day, 12, 0, 0);
      baseDayOfWeek = startDayOfWeek;
    } else {
      let daysUntilFirstDay = firstDayNumber - startDayOfWeek;
      if (daysUntilFirstDay < 0) {
        daysUntilFirstDay += 7;
      }
      baseDate = new Date(year, month - 1, day + daysUntilFirstDay, 12, 0, 0);
      baseDayOfWeek = firstDayNumber;
    }
    
    const baseDayIndex = dayNumbers.indexOf(baseDayOfWeek);
    const targetDayIndex = dayIndexInCycle;
    
    let daysToAdd = 0;
    
    if (targetDayIndex >= baseDayIndex) {
      daysToAdd = (targetDayIndex - baseDayIndex) + (weekOffset * 7);
    } else {
      daysToAdd = (dayNames.length - baseDayIndex) + targetDayIndex + (weekOffset * 7);
    }
    
    const sessionDate = new Date(baseDate);
    sessionDate.setDate(baseDate.getDate() + daysToAdd);

    const resultYear = sessionDate.getFullYear();
    const resultMonth = String(sessionDate.getMonth() + 1).padStart(2, '0');
    const resultDay = String(sessionDate.getDate()).padStart(2, '0');
    return `${resultYear}-${resultMonth}-${resultDay}`;
  };

  // Calculate which phase is currently active based on today's date
  const calculateActivePhase = (phaseSessions, classSessions, classDetails, daysOfWeek, sessionsPerPhase) => {
    if (!phaseSessions || phaseSessions.length === 0 || !classDetails.start_date) {
      return 1;
    }

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const sessionsByPhase = phaseSessions.reduce((acc, session) => {
      const phaseNum = session.phase_number;
      if (!acc[phaseNum]) {
        acc[phaseNum] = [];
      }
      acc[phaseNum].push(session);
      return acc;
    }, {});

    const sortedPhases = Object.keys(sessionsByPhase)
      .map(Number)
      .sort((a, b) => a - b);

    for (const phaseNum of sortedPhases) {
      const phaseSessionsList = sessionsByPhase[phaseNum].sort((a, b) => a.phase_session_number - b.phase_session_number);
      
      const firstSession = phaseSessionsList[0];
      const lastSession = phaseSessionsList[phaseSessionsList.length - 1];

      let firstSessionDate = classSessions.find(cs => 
        cs.phase_number === firstSession.phase_number && 
        cs.phase_session_number === firstSession.phase_session_number
      )?.scheduled_date;

      let lastSessionDate = classSessions.find(cs => 
        cs.phase_number === lastSession.phase_number && 
        cs.phase_session_number === lastSession.phase_session_number
      )?.scheduled_date;

      if (!firstSessionDate && classDetails.start_date && sessionsPerPhase) {
        firstSessionDate = calculateSessionDate(
          classDetails.start_date,
          daysOfWeek,
          firstSession.phase_number,
          firstSession.phase_session_number,
          sessionsPerPhase
        );
      }

      if (!lastSessionDate && classDetails.start_date && sessionsPerPhase) {
        lastSessionDate = calculateSessionDate(
          classDetails.start_date,
          daysOfWeek,
          lastSession.phase_number,
          lastSession.phase_session_number,
          sessionsPerPhase
        );
      }

      if (firstSessionDate && lastSessionDate) {
        if (todayStr >= firstSessionDate && todayStr <= lastSessionDate) {
          return phaseNum;
        }
      } else if (firstSessionDate && todayStr >= firstSessionDate) {
        return phaseNum;
      }
    }

    const firstPhaseSessions = sessionsByPhase[sortedPhases[0]];
    if (firstPhaseSessions && firstPhaseSessions.length > 0) {
      const firstSession = firstPhaseSessions[0];
      const firstSessionDate = classSessions.find(cs => 
        cs.phase_number === firstSession.phase_number && 
        cs.phase_session_number === firstSession.phase_session_number
      )?.scheduled_date || (classDetails.start_date && sessionsPerPhase
        ? calculateSessionDate(
            classDetails.start_date,
            daysOfWeek,
            firstSession.phase_number,
            firstSession.phase_session_number,
            sessionsPerPhase
          )
        : null);

      if (firstSessionDate && todayStr < firstSessionDate) {
        return sortedPhases[0];
      }
    }

    // If today is past all phases' date ranges, find the first completed phase
    // and return the next phase if it exists, otherwise return the last phase
    // Loop forward through phases to find the first one that's completed
    for (let i = 0; i < sortedPhases.length; i++) {
      const phaseNum = sortedPhases[i];
      const phaseSessionsList = sessionsByPhase[phaseNum].sort((a, b) => a.phase_session_number - b.phase_session_number);
      const lastSession = phaseSessionsList[phaseSessionsList.length - 1];
      
      // Get last session date
      let lastSessionDate = classSessions.find(cs => 
        cs.phase_number === lastSession.phase_number && 
        cs.phase_session_number === lastSession.phase_session_number
      )?.scheduled_date;

      // If not in database, calculate date
      if (!lastSessionDate && classDetails.start_date && sessionsPerPhase) {
        lastSessionDate = calculateSessionDate(
          classDetails.start_date,
          daysOfWeek,
          lastSession.phase_number,
          lastSession.phase_session_number,
          sessionsPerPhase
        );
      }

      // If this phase is completed (today > last session date), check for next phase
      if (lastSessionDate && todayStr > lastSessionDate) {
        // Check if there's a next phase
        if (i < sortedPhases.length - 1) {
          // This phase is completed, return the next phase
          return sortedPhases[i + 1];
        } else {
          // This is the last phase and it's completed, return it
          return phaseNum;
        }
      }
    }

    return sortedPhases[sortedPhases.length - 1] || 1;
  };

  const handleViewClass = async (classItem) => {
    setOpenMenuId(null);
    setViewMode('detail');
    setLoadingPhaseSessions(true);
    setLoadingClassSessions(true);
    setPhaseSessions([]);
    setClassSessions([]);

    try {
      const phaseResponse = await apiRequest(`/classes/${classItem.class_id}/phasesessions`);
      const classDetailsResponse = await apiRequest(`/classes/${classItem.class_id}`);
      const isMergedClass = classDetailsResponse.data?.is_merged_class || false;
      
      let classDetails;
      if (phaseResponse.data?.class) {
        classDetails = {
          ...classItem,
          ...phaseResponse.data.class,
          days_of_week: phaseResponse.data.class.days_of_week || classItem.days_of_week || [],
          is_merged_class: isMergedClass,
          merge_history_id: classDetailsResponse.data?.merge_history_id || null,
        };
        setSelectedClassForDetails(classDetails);
      } else {
        classDetails = {
          ...classItem,
          is_merged_class: isMergedClass,
          merge_history_id: classDetailsResponse.data?.merge_history_id || null,
        };
        setSelectedClassForDetails(classDetails);
      }

      const fetchedPhaseSessions = phaseResponse.data?.phasesessions || [];
      setPhaseSessions(fetchedPhaseSessions);

      let fetchedClassSessions = [];
      try {
        const sessionsResponse = await apiRequest(`/classes/${classItem.class_id}/sessions`);
        if (sessionsResponse.success && sessionsResponse.data) {
          const sortedSessions = sessionsResponse.data.sort((a, b) => {
            if (a.scheduled_date !== b.scheduled_date) {
              return new Date(a.scheduled_date) - new Date(b.scheduled_date);
            }
            if (a.phase_number !== b.phase_number) {
              return a.phase_number - b.phase_number;
            }
            return a.phase_session_number - b.phase_session_number;
          });
          fetchedClassSessions = sortedSessions;
          setClassSessions(sortedSessions);
        } else {
          setClassSessions([]);
        }
      } catch (sessionsErr) {
        console.error('Error fetching class sessions:', sessionsErr);
        setClassSessions([]);
      }

      const daysOfWeek = classDetails.days_of_week || [];
      const sessionsPerPhase = classDetails.number_of_session_per_phase;
      const activePhase = calculateActivePhase(
        fetchedPhaseSessions,
        fetchedClassSessions,
        classDetails,
        daysOfWeek,
        sessionsPerPhase
      );
      setExpandedPhases(new Set([activePhase]));
    } catch (err) {
      console.error('Error fetching phase sessions:', err);
      setSelectedClassForDetails(classItem);
      setPhaseSessions([]);
      setClassSessions([]);
      setExpandedPhases(new Set([1]));
    } finally {
      setLoadingPhaseSessions(false);
      setLoadingClassSessions(false);
    }
  };

  const handleBackToList = () => {
    setViewMode('list');
    setSelectedClassForDetails(null);
    setPhaseSessions([]);
    setClassSessions([]);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      if (openProgramDropdown && !event.target.closest('.program-filter-dropdown')) {
        setOpenProgramDropdown(false);
      }
    };

    if (openMenuId || openProgramDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openProgramDropdown]);

  const formatTime = (time) => {
    if (!time) return 'TBD';
    const [hourStr, minuteStr] = time.split(':');
    const hour = parseInt(hourStr, 10);
    const minutes = minuteStr ?? '00';
    const period = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes.padStart(2, '0')} ${period}`;
  };

  const uniquePrograms = [...new Set(classes.map(c => c.program_id).filter(Boolean))];
  const programOptions = programs.filter(p => uniquePrograms.includes(p.program_id));

  const filteredClasses = classes.filter((classItem) => {
    const matchesNameSearch = !nameSearchTerm || 
      (classItem.class_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
       classItem.level_tag?.toLowerCase().includes(nameSearchTerm.toLowerCase()));
    const matchesProgram = !filterProgram || classItem.program_id === parseInt(filterProgram);
    return matchesNameSearch && matchesProgram;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Detail View Component
  if (viewMode === 'detail' && selectedClassForDetails) {
    const formatTime = (timeString) => {
      if (!timeString) return '';
      const timeParts = timeString.split(':');
      const hours = timeParts[0];
      const minutes = timeParts[1] || '00';
      const hour = parseInt(hours);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      const minutesFormatted = minutes.padStart(2, '0');
      return `${hour12}:${minutesFormatted} ${ampm}`;
    };

    const formatDate = (dateValue) => {
      if (!dateValue) return '-';
      try {
        let date;
        if (typeof dateValue === 'string') {
          const [year, month, day] = dateValue.split('-').map(Number);
          date = new Date(year, month - 1, day);
        } else if (dateValue instanceof Date) {
          date = dateValue;
        } else {
          return '-';
        }
        
        if (isNaN(date.getTime())) {
          return '-';
        }
        
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return date.toLocaleDateString('en-US', options);
      } catch {
        return '-';
      }
    };

    const daysOfWeek = selectedClassForDetails.days_of_week || [];
    const sessionsPerPhase = selectedClassForDetails.number_of_session_per_phase;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBackToList}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Class Details</h1>
              <p className="text-sm text-gray-500 mt-1">
                {selectedClassForDetails.program_name} - {selectedClassForDetails.class_name || selectedClassForDetails.level_tag}
              </p>
            </div>
          </div>
        </div>

        {/* Phase & Sessions Table - Collapsible by Phase */}
        {loadingPhaseSessions ? (
          <div className="bg-white rounded-lg shadow p-12">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
          </div>
        ) : phaseSessions.length > 0 ? (
          <div className="space-y-4">
            {(() => {
              const sessionsByPhase = phaseSessions.reduce((acc, session) => {
                const phaseNum = session.phase_number;
                if (!acc[phaseNum]) {
                  acc[phaseNum] = [];
                }
                acc[phaseNum].push(session);
                return acc;
              }, {});

              const sortedPhases = Object.keys(sessionsByPhase)
                .map(Number)
                .sort((a, b) => a - b)
                .map(phaseNum => ({
                  phaseNumber: phaseNum,
                  sessions: sessionsByPhase[phaseNum].sort((a, b) => a.phase_session_number - b.phase_session_number)
                }));

              const activePhase = calculateActivePhase(
                phaseSessions,
                classSessions,
                selectedClassForDetails,
                daysOfWeek,
                sessionsPerPhase
              );

              return sortedPhases.map(({ phaseNumber, sessions }) => {
                const isExpanded = expandedPhases.has(phaseNumber);
                const isActivePhase = phaseNumber === activePhase;
                
                return (
                  <div key={phaseNumber} className={`bg-white rounded-lg shadow border-2 transition-colors ${
                    isActivePhase ? 'border-primary-500 shadow-md' : 'border-gray-200'
                  }`}>
                    <button
                      onClick={() => {
                        const newExpanded = new Set(expandedPhases);
                        if (isExpanded) {
                          newExpanded.delete(phaseNumber);
                        } else {
                          newExpanded.add(phaseNumber);
                        }
                        setExpandedPhases(newExpanded);
                      }}
                      className={`w-full px-6 py-4 flex items-center justify-between transition-colors ${
                        isActivePhase 
                          ? 'bg-primary-50 hover:bg-primary-100' 
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <svg
                          className={`w-5 h-5 transition-transform ${
                            isExpanded ? 'transform rotate-90' : ''
                          } ${
                            isActivePhase ? 'text-primary-600' : 'text-gray-500'
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <h3 className={`text-lg font-semibold ${
                          isActivePhase ? 'text-primary-700' : 'text-gray-900'
                        }`}>
                          Phase {phaseNumber}
                          {isActivePhase && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                              Current
                            </span>
                          )}
                        </h3>
                        <span className={`text-sm ${
                          isActivePhase ? 'text-primary-600' : 'text-gray-500'
                        }`}>
                          ({sessions.length} session{sessions.length !== 1 ? 's' : ''})
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-200">
                        <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                          <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1000px' }}>
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  CLASS CODE
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  PHASE AND SESSION
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  TOPIC
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  GOAL
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  AGENDA
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  MAX STUDENTS
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  SCHEDULE
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                              {sessions.map((session) => {
                                const classSession = classSessions.find(cs => 
                                  cs.phase_number === session.phase_number && 
                                  cs.phase_session_number === session.phase_session_number
                                );

                                const sessionDate = classSession?.scheduled_date 
                                  ? classSession.scheduled_date
                                  : (selectedClassForDetails.start_date && sessionsPerPhase
                                    ? calculateSessionDate(
                                        selectedClassForDetails.start_date,
                                        daysOfWeek,
                                        session.phase_number,
                                        session.phase_session_number,
                                        sessionsPerPhase
                                      )
                                    : null);

                                const sessionStartTime = classSession?.scheduled_start_time || null;
                                const sessionEndTime = classSession?.scheduled_end_time || null;

                                return (
                                  <tr key={session.phasesessiondetail_id}>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <div className="text-sm font-medium text-gray-900">
                                        {classSession?.class_code || selectedClassForDetails.class_code || '-'}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <div className="text-sm font-medium text-gray-900">
                                        Phase {session.phase_number} - Session {session.phase_session_number}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="text-sm text-gray-900">
                                        {session.topic || '-'}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="text-sm text-gray-900">
                                        {session.goal || '-'}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="text-sm text-gray-900">
                                        {session.agenda || '-'}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                      <div className="text-sm text-gray-900">
                                        {session.enrolled_students !== undefined && session.enrolled_students !== null
                                          ? session.enrolled_students
                                          : '0'}
                                        {selectedClassForDetails.max_students && (
                                          <span className="text-gray-500"> / {selectedClassForDetails.max_students}</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4">
                                      <div className="space-y-1">
                                        {sessionDate && (() => {
                                          let displayStartTime = sessionStartTime;
                                          let displayEndTime = sessionEndTime;
                                          
                                          if (!displayStartTime || !displayEndTime) {
                                            const dateObj = new Date(sessionDate + 'T12:00:00');
                                            const dayOfWeekIndex = dateObj.getDay();
                                            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                                            const dayOfWeekName = dayNames[dayOfWeekIndex];
                                            const daySchedule = daysOfWeek.find(day => day && day.day_of_week === dayOfWeekName);
                                            if (daySchedule && daySchedule.start_time && daySchedule.end_time) {
                                              displayStartTime = daySchedule.start_time;
                                              displayEndTime = daySchedule.end_time;
                                            }
                                          }
                                          
                                          return (
                                            <div>
                                              <div className="text-sm font-medium text-gray-900">
                                                {formatDate(sessionDate)}
                                              </div>
                                              {displayStartTime && displayEndTime && (
                                                <div className="text-sm text-gray-600 font-normal">
                                                  {formatTime(displayStartTime)} - {formatTime(displayEndTime)}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        {!sessionDate && daysOfWeek.length > 0 && (
                                          <div className="space-y-0.5">
                                            {daysOfWeek
                                              .filter(day => day && day.day_of_week)
                                              .map((day, index) => {
                                                const timeStr = day.start_time && day.end_time 
                                                  ? ` (${formatTime(day.start_time)} - ${formatTime(day.end_time)})`
                                                  : '';
                                                return (
                                                  <div key={index} className="text-sm text-gray-500">
                                                    {day.day_of_week}{timeStr}
                                                  </div>
                                                );
                                              })}
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-500">No phase sessions found for this class.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">My Classes</h1>
          <p className="text-sm text-gray-600">View your assigned classes for {selectedBranchName}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="relative">
            <input
              type="text"
              value={nameSearchTerm}
              onChange={(e) => setNameSearchTerm(e.target.value)}
              placeholder="Search by class name or level tag..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent"
            />
            {nameSearchTerm && (
              <button
                onClick={() => setNameSearchTerm('')}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="relative program-filter-dropdown">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpenProgramDropdown(!openProgramDropdown);
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent"
            >
              <span>{filterProgram ? programOptions.find(p => p.program_id === parseInt(filterProgram))?.program_name || 'Select Program' : 'All Programs'}</span>
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openProgramDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                <div className="py-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFilterProgram('');
                      setOpenProgramDropdown(false);
                    }}
                    className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                      !filterProgram ? 'bg-gray-100 font-medium' : 'text-gray-700'
                    }`}
                  >
                    All Programs
                  </button>
                  {programOptions.map((program) => (
                    <button
                      key={program.program_id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilterProgram(program.program_id.toString());
                        setOpenProgramDropdown(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                        filterProgram === program.program_id.toString() ? 'bg-gray-100 font-medium' : 'text-gray-700'
                      }`}
                    >
                      {program.program_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {filteredClasses.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterProgram
              ? 'No classes found matching your criteria.'
              : 'No classes assigned to you yet.'}
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
              style={{ width: '100%', minWidth: '1000px' }}
            >
              <thead className="bg-white">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Program Code
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Class Name
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Level Tag
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Room
                  </th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Max Students
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Start Date & End Date
                  </th>
                  <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredClasses.map((classItem) => (
                  <tr key={classItem.class_id}>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">
                        {classItem.program_code || 'N/A'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {classItem.class_name || classItem.level_tag || 'N/A'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">
                        {classItem.level_tag || 'N/A'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">
                        {classItem.room_name || 'Unassigned'}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-center">
                      <div className="text-sm text-gray-900">
                        {classItem.max_students || 'N/A'}
                      </div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="text-sm text-gray-900">
                        {(() => {
                          const formatDate = (dateValue) => {
                            if (!dateValue) return '-';
                            try {
                              let date;
                              if (typeof dateValue === 'string') {
                                const [year, month, day] = dateValue.split('-').map(Number);
                                date = new Date(year, month - 1, day);
                              } else if (dateValue instanceof Date) {
                                date = dateValue;
                              } else {
                                return '-';
                              }
                              
                              if (isNaN(date.getTime())) {
                                return '-';
                              }
                              
                              const options = { year: 'numeric', month: 'long', day: 'numeric' };
                              return date.toLocaleDateString('en-US', options);
                            } catch {
                              return '-';
                            }
                          };

                          return classItem.start_date || classItem.end_date ? (
                            <div className="space-y-1">
                              {classItem.start_date && (
                                <div>Start: {formatDate(classItem.start_date)}</div>
                              )}
                              {classItem.end_date && (
                                <div>End: {formatDate(classItem.end_date)}</div>
                              )}
                            </div>
                          ) : (
                            '-'
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-4 text-right text-sm font-medium">
                      <div className="relative action-menu-container">
                        <button
                          onClick={(e) => handleMenuClick(classItem.class_id, e)}
                          className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                        >
                          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredClasses.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredClasses.length} of {classes.length} classes
        </div>
      )}

      {openMenuId && createPortal(
        <>
          <div 
            className="fixed inset-0 z-40 bg-transparent" 
            onClick={() => {
              setOpenMenuId(null);
              setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
            }}
          />
          <div
            className="fixed action-menu-overlay bg-white rounded-md shadow-lg z-50 border border-gray-200 w-48"
            style={{
              ...(menuPosition.top !== undefined && { top: `${menuPosition.top}px` }),
              ...(menuPosition.bottom !== undefined && { bottom: `${menuPosition.bottom}px` }),
              ...(menuPosition.right !== undefined && { right: `${menuPosition.right}px` }),
              ...(menuPosition.left !== undefined && { left: `${menuPosition.left}px` }),
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedClass = filteredClasses.find(c => c.class_id === openMenuId);
                  if (selectedClass) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    handleViewClass(selectedClass);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                View Class Details
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default StudentClasses;
