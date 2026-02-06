import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const TeacherClasses = () => {
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
  const [openSessionMenuId, setOpenSessionMenuId] = useState(null);
  const [sessionMenuPosition, setSessionMenuPosition] = useState({ top: 0, right: 0 });
  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const [selectedSessionForAttendance, setSelectedSessionForAttendance] = useState(null);
  const [attendanceData, setAttendanceData] = useState(null);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [attendanceNotes, setAttendanceNotes] = useState('');
  const [attendanceAgenda, setAttendanceAgenda] = useState('');
  const [attendanceJustSaved, setAttendanceJustSaved] = useState(false);
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [isAgendaModalOpen, setIsAgendaModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [agendaDraft, setAgendaDraft] = useState('');
  const [programs, setPrograms] = useState([]);
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  const [isViewStudentsModalOpen, setIsViewStudentsModalOpen] = useState(false);
  const [viewStudentsStep, setViewStudentsStep] = useState('phase-selection'); // 'phase-selection' or 'students-list'
  const [selectedClassForView, setSelectedClassForView] = useState(null);
  const [selectedPhaseForView, setSelectedPhaseForView] = useState(null);
  const [viewEnrolledStudents, setViewEnrolledStudents] = useState([]);
  const [loadingViewStudents, setLoadingViewStudents] = useState(false);

  // Get teacher's user_id and branch_id from userInfo
  const teacherId = userInfo?.user_id || userInfo?.userId;
  const teacherBranchId = userInfo?.branch_id || userInfo?.branchId;

  useEffect(() => {
    if (teacherId && teacherBranchId) {
      fetchClasses();
      fetchPrograms();
      fetchBranchName();
    }
  }, [teacherId, teacherBranchId]);

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

  const fetchClasses = async () => {
    try {
      setLoading(true);
      // Fetch classes for teacher's branch (backend auto-filters by branch for non-superadmin)
      const response = await apiRequest(`/classes?branch_id=${teacherBranchId}&limit=100`);
      const allClasses = response.data || [];
      
      // Filter to only show classes where this teacher is assigned
      // Check both teacher_id (single) and teacher_ids array (multiple teachers)
      const assignedClasses = allClasses.filter(classItem => {
        // Check if teacher is in teacher_ids array
        if (classItem.teacher_ids && Array.isArray(classItem.teacher_ids)) {
          return classItem.teacher_ids.some(id => parseInt(id) === teacherId);
        }
        // Check if teacher matches teacher_id
        if (classItem.teacher_id) {
          return parseInt(classItem.teacher_id) === teacherId;
        }
        return false;
      });
      
      setClasses(assignedClasses);
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

  const handleSessionMenuClick = (sessionKey, event) => {
    event.stopPropagation();
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    
    if (openSessionMenuId === sessionKey) {
      setOpenSessionMenuId(null);
      setSessionMenuPosition({ top: 0, right: 0 });
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
      
      setSessionMenuPosition({
        top: top !== 'auto' ? top : undefined,
        bottom: bottom !== 'auto' ? bottom : undefined,
        right: right !== 'auto' ? right : undefined,
        left: left !== 'auto' ? left : undefined,
      });
      setOpenSessionMenuId(sessionKey);
    }
  };

  const openAttendanceModal = async (classSession, phaseNumber, phaseSessionNumber, sessionDate) => {
    if (!selectedClassForDetails) {
      console.error('Cannot open attendance modal: selectedClassForDetails is null');
      return;
    }

    const sessionData = classSession || {
      classsession_id: null,
      class_id: selectedClassForDetails.class_id,
      phase_number: phaseNumber,
      phase_session_number: phaseSessionNumber,
      scheduled_date: sessionDate,
    };

    setSelectedSessionForAttendance(sessionData);
    setIsAttendanceModalOpen(true);
    setAttendanceData(null);
    setAttendanceNotes('');
    setAttendanceAgenda('');
    
    if (sessionData.classsession_id) {
      fetchAttendanceData(sessionData.classsession_id).catch(err => {
        console.error('Error fetching attendance data:', err);
        if (selectedClassForDetails) {
          fetchEnrolledStudentsForAttendance(selectedClassForDetails.class_id).catch(console.error);
        }
      });
    } else {
      if (selectedClassForDetails) {
        fetchEnrolledStudentsForAttendance(selectedClassForDetails.class_id).catch(err => {
          console.error('Error fetching enrolled students:', err);
        });
      }
    }
  };

  const fetchAttendanceData = async (classsessionId) => {
    try {
      setLoadingAttendance(true);
      const response = await apiRequest(`/attendance/session/${classsessionId}`);
      const attendanceData = response.data || response;
      setAttendanceData(attendanceData);
      
      if (attendanceData?.session) {
        setAttendanceNotes(attendanceData.session.notes || '');
        setAttendanceAgenda(attendanceData.session.agenda || '');
      }
    } catch (err) {
      console.error('Error fetching attendance:', err);
      setError(err.message || 'Failed to fetch attendance data');
      if (selectedClassForDetails) {
        await fetchEnrolledStudentsForAttendance(selectedClassForDetails.class_id);
      }
    } finally {
      setLoadingAttendance(false);
    }
  };

  const fetchEnrolledStudentsForAttendance = async (classId) => {
    try {
      setLoadingAttendance(true);
      const response = await apiRequest(`/students/class/${classId}`);
      const students = response.data || [];
      
      const sessionDate = selectedSessionForAttendance?.scheduled_date || null;
      const sessionStartTime = selectedSessionForAttendance?.scheduled_start_time || null;
      const sessionEndTime = selectedSessionForAttendance?.scheduled_end_time || null;
      const sessionPhaseNumber = selectedSessionForAttendance?.phase_number || null;
      
      // Filter students by phase_number if session has a phase
      // Only show students enrolled in the same phase as the session
      const filteredStudents = sessionPhaseNumber
        ? students.filter(student => {
            // Handle students enrolled in multiple phases (e.g., "Phase 1-10")
            if (student.phase_number && typeof student.phase_number === 'string' && student.phase_number.includes('-')) {
              const [startPhase, endPhase] = student.phase_number.split('-').map(Number);
              return sessionPhaseNumber >= startPhase && sessionPhaseNumber <= endPhase;
            }
            // Handle single phase enrollment
            return Number(student.phase_number) === Number(sessionPhaseNumber);
          })
        : students; // If no phase specified, show all (fallback)
      
      setAttendanceData({
        session: {
          classsession_id: null,
          class_id: classId,
          scheduled_date: sessionDate,
          scheduled_start_time: sessionStartTime,
          scheduled_end_time: sessionEndTime,
          status: 'Scheduled',
          topic: selectedSessionForAttendance?.topic || null,
          goal: selectedSessionForAttendance?.goal || null,
          agenda: selectedSessionForAttendance?.agenda || null,
          class_name: selectedClassForDetails?.class_name || null,
          level_tag: selectedClassForDetails?.level_tag || null,
          program_name: selectedClassForDetails?.program_name || null,
        },
        students: filteredStudents.map(student => ({
          student_id: student.student_id,
          full_name: student.full_name,
          profile_picture_url: student.profile_picture_url,
          phase_number: student.phase_number,
          enrolled_at: student.enrolled_at,
          attendance: null,
        })),
      });
    } catch (err) {
      console.error('Error fetching students:', err);
      setError(err.message || 'Failed to fetch students');
    } finally {
      setLoadingAttendance(false);
    }
  };

  const closeAttendanceModal = () => {
    setIsAttendanceModalOpen(false);
    setSelectedSessionForAttendance(null);
    setAttendanceData(null);
    setAttendanceNotes('');
    setAttendanceAgenda('');
    setAttendanceJustSaved(false);
  };

  const handleAttendanceStatusChange = (studentId, status) => {
    if (!attendanceData) return;

    setAttendanceData(prev => ({
      ...prev,
      students: prev.students.map(student => {
        if (student.student_id === studentId) {
          return {
            ...student,
            attendance: {
              ...student.attendance,
              student_id: studentId,
              status: status,
              notes: student.attendance?.notes || '',
            },
          };
        }
        return student;
      }),
    }));
  };

  const handleSaveAttendance = async () => {
    if (!attendanceData || !selectedSessionForAttendance) return;

    try {
      setSavingAttendance(true);

      if (!attendanceData || !attendanceData.students) {
        alert('No attendance data available');
        return;
      }

      const attendanceRecords = attendanceData.students
        .filter(student => student.attendance && student.attendance.status)
        .map(student => ({
          student_id: student.student_id,
          status: student.attendance?.status || 'Present',
          notes: student.attendance?.notes || '',
        }));

      if (selectedSessionForAttendance.classsession_id) {
        await apiRequest(`/attendance/session/${selectedSessionForAttendance.classsession_id}`, {
          method: 'POST',
          body: JSON.stringify({ attendance: attendanceRecords }),
        });

        await fetchAttendanceData(selectedSessionForAttendance.classsession_id);
        setAttendanceJustSaved(true);

        // Refresh class sessions to update status in the table
        if (selectedClassForDetails) {
          try {
            const sessionsResponse = await apiRequest(`/classes/${selectedClassForDetails.class_id}/sessions`);
            if (sessionsResponse.success && sessionsResponse.data) {
              // Sort sessions by scheduled_date, then phase_number, then phase_session_number
              const sortedSessions = sessionsResponse.data.sort((a, b) => {
                if (a.scheduled_date !== b.scheduled_date) {
                  return new Date(a.scheduled_date) - new Date(b.scheduled_date);
                }
                if (a.phase_number !== b.phase_number) {
                  return a.phase_number - b.phase_number;
                }
                return a.phase_session_number - b.phase_session_number;
              });
              setClassSessions(sortedSessions);
            }
          } catch (sessionsErr) {
            console.error('Error refreshing class sessions:', sessionsErr);
          }
        }
      } else {
        alert('Please generate class sessions first before marking attendance.');
        return;
      }
    } catch (err) {
      console.error('Error saving attendance:', err);
      alert(err.message || 'Failed to save attendance');
    } finally {
      setSavingAttendance(false);
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

  const openViewStudentsModal = (classItem) => {
    setOpenMenuId(null);
    setSelectedClassForView(classItem);
    setViewStudentsStep('phase-selection');
    setSelectedPhaseForView(null);
    setViewEnrolledStudents([]);
    setIsViewStudentsModalOpen(true);
  };

  const closeViewStudentsModal = () => {
    setIsViewStudentsModalOpen(false);
    setSelectedClassForView(null);
    setViewStudentsStep('phase-selection');
    setSelectedPhaseForView(null);
    setViewEnrolledStudents([]);
  };

  const handlePhaseSelectForView = (phaseNumber) => {
    setSelectedPhaseForView(phaseNumber);
    setViewStudentsStep('students-list');
    if (selectedClassForView) {
      fetchEnrolledStudentsForView(selectedClassForView.class_id, phaseNumber);
    }
  };

  const fetchEnrolledStudentsForView = async (classId, phaseNumber = null) => {
    try {
      setLoadingViewStudents(true);
      
      const [enrolledResponse, reservedResponse] = await Promise.all([
        apiRequest(`/students/class/${classId}`).catch(() => ({ data: [] })),
        apiRequest(`/reservations?class_id=${classId}`).catch(() => ({ data: [] }))
      ]);
      
      let enrolledStudents = enrolledResponse.data || [];
      let reservedStudents = reservedResponse.data || [];
      
      if (phaseNumber !== null) {
        enrolledStudents = enrolledStudents.filter(s => s.phase_number === phaseNumber);
      }
      
      const uniqueEnrolledStudents = enrolledStudents.reduce((acc, student) => {
        const existing = acc.find(s => s.user_id === student.user_id);
        if (!existing) {
          acc.push({
            ...student,
            student_type: 'enrolled',
            phases: [student.phase_number],
            highestPhase: student.phase_number,
            earliestEnrollment: student.enrolled_at,
            enrolledBy: student.enrolled_by
          });
        } else {
          if (!existing.phases.includes(student.phase_number)) {
            existing.phases.push(student.phase_number);
            existing.phases.sort((a, b) => a - b);
          }
          if (student.phase_number > existing.highestPhase) {
            existing.highestPhase = student.phase_number;
          }
          if (student.enrolled_at && existing.earliestEnrollment &&
              new Date(student.enrolled_at) < new Date(existing.earliestEnrollment)) {
            existing.earliestEnrollment = student.enrolled_at;
            existing.enrolledBy = student.enrolled_by;
          }
        }
        return acc;
      }, []);
      
      uniqueEnrolledStudents.forEach(student => {
        student.phasesDisplay = student.phases.length > 1 
          ? `Phases ${student.phases.join(', ')}`
          : `Phase ${student.phases[0]}`;
      });
      
      const formattedReservedStudents = reservedStudents.map(reservation => ({
        user_id: reservation.student_id,
        full_name: reservation.student_name,
        email: reservation.student_email,
        level_tag: null,
        phase_number: null,
        enrolled_at: reservation.reserved_at,
        enrolled_by: null,
        student_type: 'reserved',
        reservation_id: reservation.reserved_id,
        reservation_status: reservation.status,
        package_name: reservation.package_name,
        reservation_fee: reservation.reservation_fee,
        phases: [],
        phasesDisplay: 'Reserved',
        highestPhase: null,
        earliestEnrollment: reservation.reserved_at,
      }));
      
      const allStudents = [...uniqueEnrolledStudents, ...formattedReservedStudents];
      allStudents.sort((a, b) => {
        if (a.student_type === 'enrolled' && b.student_type === 'reserved') return -1;
        if (a.student_type === 'reserved' && b.student_type === 'enrolled') return 1;
        return (a.full_name || '').localeCompare(b.full_name || '');
      });
      
      setViewEnrolledStudents(allStudents);
      return allStudents;
    } catch (err) {
      console.error('Error fetching students:', err);
      setViewEnrolledStudents([]);
      return [];
    } finally {
      setLoadingViewStudents(false);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openMenuId && !event.target.closest('.action-menu-container') && !event.target.closest('.action-menu-overlay')) {
        setOpenMenuId(null);
      }
      if (openSessionMenuId && !event.target.closest('.session-action-menu-container') && !event.target.closest('.session-action-menu-overlay')) {
        setOpenSessionMenuId(null);
      }
      if (openProgramDropdown && !event.target.closest('.program-filter-dropdown')) {
        setOpenProgramDropdown(false);
      }
    };

    if (openMenuId || openSessionMenuId || openProgramDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openMenuId, openSessionMenuId, openProgramDropdown]);

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

    // Resolve primary teacher (for header avatar/name) from either class details or teachers list
    let primaryTeacher = null;
    if (selectedClassForDetails.teacher_ids && Array.isArray(selectedClassForDetails.teacher_ids) && selectedClassForDetails.teacher_ids.length > 0) {
      const firstId = selectedClassForDetails.teacher_ids[0]?.toString();
      // Teachers list might not be loaded for teacher view, so just use class details
      primaryTeacher = { full_name: selectedClassForDetails.teacher_name || null };
    } else if (selectedClassForDetails.teacher_id) {
      primaryTeacher = { full_name: selectedClassForDetails.teacher_name || null };
    }

    // Determine if there are any students without an explicit attendance status
    const hasPendingStudents = attendanceData?.students?.some(
      (student) => !student.attendance || !student.attendance.status
    );

    // Check if attendance window is open (allow past sessions, block future sessions)
    const checkAttendanceWindow = () => {
      if (!attendanceData?.session?.scheduled_date) return { isOpen: false, reason: 'No session date available' };
      
      const sessionDate = new Date(attendanceData.session.scheduled_date);
      const today = new Date();
      
      sessionDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      
      const isFuture = today < sessionDate;
      
      // Block only future sessions - allow past and current sessions
      if (isFuture) {
        return { isOpen: false, reason: 'future', message: 'Cannot mark attendance for a future session. Please wait until the session date.' };
      }
      return { isOpen: true, reason: 'current' };
    };

    const attendanceWindow = checkAttendanceWindow();
    const isAttendanceWindowClosed = !attendanceWindow.isOpen;

    // Session is locked if:
    // 1. Already saved/completed, OR
    // 2. Attendance window is closed (future date only - past sessions are allowed)
    const isAttendanceLocked =
      attendanceJustSaved || 
      attendanceData?.session?.status === 'Completed' ||
      isAttendanceWindowClosed;
    
    // Determine lock reason for user messaging
    const lockReason = 
      attendanceData?.session?.status === 'Completed' 
        ? 'Attendance for this session has been saved and can no longer be edited.'
        : isAttendanceWindowClosed
        ? attendanceWindow.message
        : '';

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
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
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
                                <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  ACTIONS
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
                                  <tr key={session.phasesessiondetail_id} className={classSession?.status === 'Cancelled' ? 'bg-gray-100 opacity-60' : ''}>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                      <div className="text-sm font-medium text-gray-900">
                                        {classSession?.class_code || '-'}
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
                                        {classSession?.status && classSession.status !== 'Scheduled' && (
                                          <div className="inline-flex items-center gap-1 mt-1">
                                            <div className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                                            style={{
                                              backgroundColor: classSession.status === 'Completed' ? '#d1fae5' : 
                                                              classSession.status === 'Cancelled' ? '#fee2e2' :
                                                              classSession.status === 'Rescheduled' ? '#fef3c7' :
                                                              classSession.status === 'In Progress' ? '#dbeafe' : '#f3f4f6',
                                              color: classSession.status === 'Completed' ? '#065f46' : 
                                                     classSession.status === 'Cancelled' ? '#991b1b' :
                                                     classSession.status === 'Rescheduled' ? '#92400e' :
                                                     classSession.status === 'In Progress' ? '#1e40af' : '#374151'
                                            }}
                                          >
                                            {classSession.status}
                                          </div>
                                          {(classSession.status === 'Cancelled' || classSession.status === 'Rescheduled') && (
                                            <div 
                                              className="inline-flex items-center text-xs text-amber-600 cursor-help"
                                              title={classSession.status === 'Cancelled' 
                                                ? 'This cancelled session is excluded from end date calculation' 
                                                : 'This rescheduled session may affect end date calculation'}
                                            >
                                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                              </svg>
                                            </div>
                                          )}
                                        </div>
                                      )}
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
                                    <td className="px-3 py-3 whitespace-nowrap text-right">
                                      <div className="relative session-action-menu-container">
                                        <button
                                          onClick={(e) => {
                                            // Prevent action if session is cancelled
                                            if (classSession?.status === 'Cancelled') {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              return;
                                            }
                                            const sessionKey = `${session.phase_number}-${session.phase_session_number}`;
                                            handleSessionMenuClick(sessionKey, e);
                                          }}
                                          disabled={classSession?.status === 'Cancelled'}
                                          className={`p-2 rounded-full transition-colors ${
                                            classSession?.status === 'Cancelled'
                                              ? 'opacity-50 cursor-not-allowed'
                                              : 'hover:bg-gray-100 cursor-pointer'
                                          }`}
                                          title={classSession?.status === 'Cancelled' ? 'Actions unavailable for cancelled sessions' : ''}
                                        >
                                          <svg className={`w-5 h-5 ${classSession?.status === 'Cancelled' ? 'text-gray-400' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                                          </svg>
                                        </button>
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

        {/* Session Action Menu Overlay */}
        {openSessionMenuId && viewMode === 'detail' && selectedClassForDetails && (() => {
          const [phaseNum, sessionNum] = openSessionMenuId.split('-');
          
          const session = phaseSessions.find(s => 
            s.phase_number === parseInt(phaseNum) && 
            s.phase_session_number === parseInt(sessionNum)
          );
          
          const classSession = classSessions.find(cs => 
            cs.phase_number === parseInt(phaseNum) && 
            cs.phase_session_number === parseInt(sessionNum)
          );
          
          let sessionDate = null;
          if (classSession?.scheduled_date) {
            sessionDate = classSession.scheduled_date;
          } else if (selectedClassForDetails.start_date && daysOfWeek && daysOfWeek.length > 0) {
            const sessionsInPhase = phaseSessions.filter(s => s.phase_number === parseInt(phaseNum));
            const sessionsPerPhase = sessionsInPhase.length;
            
            if (sessionsPerPhase > 0) {
              sessionDate = calculateSessionDate(
                selectedClassForDetails.start_date,
                daysOfWeek,
                parseInt(phaseNum),
                parseInt(sessionNum),
                sessionsPerPhase
              );
            }
          }
          
          return (
            <>
              <div 
                className="fixed inset-0 z-40 bg-transparent" 
                onClick={() => setOpenSessionMenuId(null)}
              />
              <div
                className="fixed session-action-menu-overlay bg-white rounded-md shadow-lg z-50 border border-gray-200 w-48 max-h-[calc(100vh-2rem)] overflow-y-auto"
                style={{
                  ...(sessionMenuPosition.top !== undefined && { top: `${sessionMenuPosition.top}px` }),
                  ...(sessionMenuPosition.bottom !== undefined && { bottom: `${sessionMenuPosition.bottom}px` }),
                  ...(sessionMenuPosition.right !== undefined && { right: `${sessionMenuPosition.right}px` }),
                  ...(sessionMenuPosition.left !== undefined && { left: `${sessionMenuPosition.left}px` }),
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 #f7fafc',
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="py-1">
                  <button
                    onClick={() => {
                      setOpenSessionMenuId(null);
                      openAttendanceModal(classSession, parseInt(phaseNum), parseInt(sessionNum), sessionDate);
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Attendance
                  </button>
      </div>
              </div>
            </>
          );
        })()}

        {/* Attendance Modal */}
        {isAttendanceModalOpen && createPortal(
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
            onClick={closeAttendanceModal}
            style={{ zIndex: 9999, position: 'fixed' }}
          >
            {loadingAttendance || !attendanceData ? (
              <div className="bg-white rounded-lg shadow-xl p-8 text-center max-w-md">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading attendance data...</p>
              </div>
            ) : (
            <div 
              className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-gradient-to-r from-[#F7C844] to-[#F5B82E]">
                <div className="flex-1">
                  {/* Schedule line */}
                  <div className="flex items-center text-sm text-gray-900 font-medium mb-2">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>
                      {attendanceData?.session?.scheduled_date 
                        ? formatDate(attendanceData.session.scheduled_date)
                        : selectedSessionForAttendance?.scheduled_date
                        ? formatDate(selectedSessionForAttendance.scheduled_date)
                        : '-'}
                    </span>
                    {attendanceData?.session?.scheduled_start_time && attendanceData?.session?.scheduled_end_time && (
                      <>
                        <span className="mx-2">•</span>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>
                          {formatTime(attendanceData.session.scheduled_start_time)} - {formatTime(attendanceData.session.scheduled_end_time)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Class name */}
                  <h2 className="text-3xl font-bold text-gray-900 mb-1">
                    {attendanceData?.session?.class_name || attendanceData?.session?.level_tag || selectedClassForDetails?.class_name || selectedClassForDetails?.level_tag || 'Class'}
                  </h2>

                  {/* Program + phase/session */}
                  <div className="flex items-center text-sm text-gray-800">
                    <span className="font-medium">{attendanceData?.session?.program_name || selectedClassForDetails?.program_name || ''}</span>
                    {selectedSessionForAttendance?.phase_number && selectedSessionForAttendance?.phase_session_number && (
                      <>
                        <span className="mx-2">•</span>
                        <span className="px-2 py-0.5 bg-white bg-opacity-30 rounded text-gray-900 font-semibold">
                          Phase {selectedSessionForAttendance.phase_number} Session {selectedSessionForAttendance.phase_session_number}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Right: Teacher avatar + name + close */}
                <div className="flex items-center gap-4 ml-4">
                  {(primaryTeacher || selectedClassForDetails?.teacher_name) && (
                    <div className="flex items-center gap-3 bg-white bg-opacity-20 rounded-lg px-3 py-2">
                      <div className="w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center overflow-hidden ring-2 ring-white ring-opacity-50">
                        {primaryTeacher?.profile_picture_url ? (
                          <img 
                            src={primaryTeacher.profile_picture_url} 
                            alt={primaryTeacher.full_name}
                            className="w-full h-full object-cover"
                          />
                        ) : selectedClassForDetails?.teacher_profile_picture ? (
                          <img 
                            src={selectedClassForDetails.teacher_profile_picture} 
                            alt={selectedClassForDetails.teacher_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-lg font-bold text-gray-700">
                            {(primaryTeacher?.full_name || selectedClassForDetails?.teacher_name || '?')
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="text-xs text-gray-800 opacity-90">Teacher</div>
                        <div className="text-sm text-gray-900 font-semibold">
                          {primaryTeacher?.full_name || selectedClassForDetails?.teacher_name}
                        </div>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={closeAttendanceModal}
                    className="text-gray-900 hover:text-gray-700 transition-colors p-2 hover:bg-white hover:bg-opacity-20 rounded-lg"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
                <div className="flex-1 overflow-y-auto p-6">
                  <div className="space-y-6">
                    {/* Quick Actions Bar */}
                    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                          <span className="text-sm font-semibold text-gray-900">Quick Actions</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              if (isAttendanceLocked || !attendanceData) return;
                              if (attendanceData) {
                                setAttendanceData(prev => ({
                                  ...prev,
                                  students: prev.students.map(student => ({
                                    ...student,
                                    attendance: {
                                      ...student.attendance,
                                      student_id: student.student_id,
                                      status: 'Present',
                                      notes: student.attendance?.notes || '',
                                    },
                                  })),
                                }));
                              }
                            }}
                            disabled={isAttendanceLocked}
                            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                            title="Mark all students as present"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>All Present</span>
                          </button>
                          <button 
                            onClick={() => {
                              if (isAttendanceLocked || !attendanceData) return;
                              if (attendanceData) {
                                setAttendanceData(prev => ({
                                  ...prev,
                                  students: prev.students.map(student => ({
                                    ...student,
                                    attendance: {
                                      ...student.attendance,
                                      student_id: student.student_id,
                                      status: 'Absent',
                                      notes: student.attendance?.notes || '',
                                    },
                                  })),
                                }));
                              }
                            }}
                            disabled={isAttendanceLocked}
                            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                            title="Mark all students as absent"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            <span>All Absent</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Attendance Window Status Banner */}
                    {isAttendanceWindowClosed && (
                      <div className="p-4 rounded-lg border bg-blue-50 border-blue-200">
                        <div className="flex items-start gap-3">
                          <svg 
                            className="w-5 h-5 flex-shrink-0 mt-0.5 text-blue-600" 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path 
                              strokeLinecap="round" 
                              strokeLinejoin="round" 
                              strokeWidth={2} 
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
                            />
                          </svg>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-blue-900">
                              Attendance Not Yet Available
                            </p>
                            <p className="text-xs mt-1 text-blue-700">
                              {attendanceWindow.message}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Students Grid */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Students</h3>
                        <span className="text-sm text-gray-600">
                          {attendanceData?.students?.filter(s => s.attendance?.status === 'Present').length || 0} / {attendanceData?.students?.length || 0} Present
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {attendanceData?.students?.map((student) => {
                          const rawStatus = student.attendance?.status || null;
                          const attendanceStatus = rawStatus || 'Pending';
                          const displayLabel = rawStatus ? attendanceStatus : 'Mark Attendance';
                          
                          const statusConfig = {
                            'Present': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: 'bg-green-500', hover: 'hover:bg-green-100' },
                            'Absent': { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'bg-red-500', hover: 'hover:bg-red-100' },
                            'Late': { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', icon: 'bg-yellow-500', hover: 'hover:bg-yellow-100' },
                            'Excused': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', icon: 'bg-blue-500', hover: 'hover:bg-blue-100' },
                            'Leave Early': { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', icon: 'bg-purple-500', hover: 'hover:bg-purple-100' },
                            'Pending': { bg: 'bg-white', border: 'border-gray-200', text: 'text-gray-600', icon: 'bg-gray-400', hover: 'hover:bg-gray-50' }
                          };
                          
                          const config = statusConfig[attendanceStatus];
                          
                          return (
                            <button
                              key={student.student_id}
                              onClick={() => {
                                if (isAttendanceLocked) return;
                                const statuses = ['Present', 'Absent', 'Late', 'Excused', 'Leave Early'];
                                const currentIndex = statuses.indexOf(attendanceStatus);
                                const nextIndex = (currentIndex + 1) % statuses.length;
                                handleAttendanceStatusChange(student.student_id, statuses[nextIndex]);
                              }}
                              disabled={isAttendanceLocked}
                              className={`${config.bg} ${config.border} border-2 rounded-xl p-4 flex flex-col items-center transition-all ${config.hover} disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md relative group`}
                            >
                              {/* Status Indicator Badge */}
                              {attendanceStatus !== 'Pending' && (
                                <div className={`absolute top-2 right-2 ${config.icon} w-3 h-3 rounded-full ring-2 ring-white`}></div>
                              )}
                              
                              {/* Student Avatar */}
                              <div className="w-16 h-16 rounded-full bg-white shadow-md flex items-center justify-center overflow-hidden mb-3 ring-2 ring-gray-100">
                                {student.profile_picture_url ? (
                                  <img 
                                    src={student.profile_picture_url} 
                                    alt={student.full_name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="text-2xl font-bold text-gray-600">
                                    {student.full_name.charAt(0).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              
                              {/* Student Name */}
                              <div className="text-sm font-semibold text-gray-900 text-center mb-2 line-clamp-2">
                                {student.full_name}
                              </div>
                              
                              {/* Attendance Status */}
                              <div className={`text-xs font-bold ${config.text} uppercase tracking-wide`}>
                                {displayLabel}
                              </div>
                              
                              {/* Click hint */}
                              {!isAttendanceLocked && (
                                <div className="mt-2 text-[10px] text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                  Click to change
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Session Details Section */}
                    <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6 border border-gray-200 shadow-sm">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Session Details
                      </h3>
                      <div className="space-y-4">
                        {/* Topic */}
                        <div>
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            Topic
                          </label>
                          <div className="text-sm text-gray-900 bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                            {attendanceData?.session?.topic || <span className="text-gray-400 italic">No topic specified</span>}
                          </div>
                        </div>

                        {/* Notes */}
                        <div>
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Notes
                          </label>
                          <div className="text-sm text-gray-700 min-h-[60px] rounded-lg bg-white px-4 py-3 border border-gray-200 shadow-sm">
                            {attendanceNotes?.trim()
                              ? <div className="whitespace-pre-wrap">{attendanceNotes}</div>
                              : <span className="text-gray-400 italic">No notes added yet. Click "Add Note" to add session notes.</span>}
                          </div>
                        </div>

                        {/* Agenda */}
                        <div>
                          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                            </svg>
                            Agenda
                          </label>
                          <div className="text-sm text-gray-700 min-h-[60px] rounded-lg bg-white px-4 py-3 border border-gray-200 shadow-sm">
                            {attendanceAgenda?.trim()
                              ? <div className="whitespace-pre-wrap">{attendanceAgenda}</div>
                              : <span className="text-gray-400 italic">No agenda added yet. Click "Add Agenda" to add session agenda.</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Sidebar - Actions */}
                <div className="w-80 border-l border-gray-200 bg-gradient-to-br from-gray-50 to-white p-6 flex flex-col">
                  {/* Header with Status */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Actions
                      </h3>
                    </div>
                    
                    {/* Status Badge */}
                    {isAttendanceLocked && attendanceData?.session?.status === 'Completed' && (
                      <div className="bg-green-100 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                        <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <div className="text-sm font-semibold text-green-900">Completed</div>
                          <div className="text-xs text-green-700">Attendance saved successfully</div>
                        </div>
                      </div>
                    )}
                    {isAttendanceLocked && isAttendanceWindowClosed && attendanceWindow.reason === 'future' && (
                      <div className="bg-blue-100 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
                        <svg className="w-5 h-5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <div className="text-sm font-semibold text-blue-900">Not Yet Available</div>
                          <div className="text-xs text-blue-700">Session hasn't started</div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="space-y-3 flex-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (isAttendanceLocked) return;
                        setNoteDraft(attendanceNotes || '');
                        setIsNoteModalOpen(true);
                      }}
                      disabled={isAttendanceLocked}
                      className="w-full px-5 py-4 bg-white text-gray-800 rounded-xl font-semibold hover:bg-gray-50 transition-all border-2 border-gray-200 hover:border-gray-300 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md group"
                    >
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-bold">Add Note</div>
                        <div className="text-xs text-gray-600">Session notes</div>
                      </div>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        if (isAttendanceLocked) return;
                        setAgendaDraft(attendanceAgenda || '');
                        setIsAgendaModalOpen(true);
                      }}
                      disabled={isAttendanceLocked}
                      className="w-full px-5 py-4 bg-white text-gray-800 rounded-xl font-semibold hover:bg-gray-50 transition-all border-2 border-gray-200 hover:border-gray-300 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md group"
                    >
                      <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                        </svg>
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-bold">Add Agenda</div>
                        <div className="text-xs text-gray-600">Session agenda</div>
                      </div>
                    </button>
                  </div>
                  
                  {/* Save Button */}
                  <button
                    onClick={handleSaveAttendance}
                    disabled={
                      savingAttendance ||
                      !selectedSessionForAttendance?.classsession_id ||
                      !attendanceData ||
                      hasPendingStudents ||
                      isAttendanceLocked
                    }
                    className="w-full px-6 py-4 bg-gradient-to-r from-[#F7C844] to-[#F5B82E] text-gray-900 rounded-xl font-bold text-lg hover:from-[#F5B82E] hover:to-[#E5A818] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center gap-3 mt-6"
                    title={
                      isAttendanceLocked
                        ? lockReason
                        : hasPendingStudents
                        ? 'Please take attendance for all students before saving.'
                        : ''
                    }
                  >
                    {savingAttendance ? (
                      <>
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>
                          {isAttendanceLocked && attendanceData?.session?.status === 'Completed'
                            ? 'Attendance Saved'
                            : isAttendanceLocked && isAttendanceWindowClosed
                            ? 'Locked'
                            : 'Save Attendance'}
                        </span>
                      </>
                    )}
                  </button>
                  
                  {hasPendingStudents && !isAttendanceLocked && (
                    <div className="mt-3 text-xs text-center text-amber-600 bg-amber-50 py-2 px-3 rounded-lg border border-amber-200">
                      <svg className="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      Mark all students before saving
                    </div>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>,
          document.body
        )}

        {/* Attendance Note Modal */}
        {isAttendanceModalOpen && isNoteModalOpen && !isAttendanceLocked && createPortal(
          <div
            className="fixed inset-0 z-[10000] bg-black bg-opacity-40 flex items-center justify-center p-4"
            onClick={() => setIsNoteModalOpen(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Add Note</h3>
                <button
                  onClick={() => setIsNoteModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-4">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent resize-none text-sm"
                  placeholder="Add notes for this session..."
                />
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsNoteModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAttendanceNotes(noteDraft || '');
                      setIsNoteModalOpen(false);
                    }}
                    className="px-4 py-2 text-sm font-semibold text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  >
                    Save Note
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Attendance Agenda Modal */}
        {isAttendanceModalOpen && isAgendaModalOpen && !isAttendanceLocked && createPortal(
          <div
            className="fixed inset-0 z-[10000] bg-black bg-opacity-40 flex items-center justify-center p-4"
            onClick={() => setIsAgendaModalOpen(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Add Agenda</h3>
                <button
                  onClick={() => setIsAgendaModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-4">
                <textarea
                  value={agendaDraft}
                  onChange={(e) => setAgendaDraft(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent resize-none text-sm"
                  placeholder="Add agenda items for this session..."
                />
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsAgendaModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAttendanceAgenda(agendaDraft || '');
                      setIsAgendaModalOpen(false);
                    }}
                    className="px-4 py-2 text-sm font-semibold text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  >
                    Save Agenda
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
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
                              // Handle both string (YYYY-MM-DD) and Date object
                              if (typeof dateValue === 'string') {
                                // Parse date string as local date (YYYY-MM-DD format from database)
                                const [year, month, day] = dateValue.split('-').map(Number);
                                // Create date in local timezone (treat as Asia/Manila UTC+8)
                                date = new Date(year, month - 1, day);
                              } else if (dateValue instanceof Date) {
                                date = dateValue;
                              } else {
                                return '-';
                              }
                              
                              // Validate date
                              if (isNaN(date.getTime())) {
                                return '-';
                              }
                              
                              // Format as "Month Day, Year" (e.g., "November 20, 2025")
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
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const selectedClass = filteredClasses.find(c => c.class_id === openMenuId);
                  if (selectedClass) {
                    setOpenMenuId(null);
                    setMenuPosition({ top: undefined, bottom: undefined, right: undefined, left: undefined });
                    openViewStudentsModal(selectedClass);
                  }
                }}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
              >
                View Students
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* View Students Modal */}
      {isViewStudentsModalOpen && selectedClassForView && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeViewStudentsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl relative z-[101] max-w-6xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {viewStudentsStep === 'phase-selection' ? 'Select Phase' : 'Students'}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {selectedClassForView.program_name} - {selectedClassForView.class_name || selectedClassForView.level_tag}
                </p>
              </div>
              <button
                onClick={closeViewStudentsModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {viewStudentsStep === 'phase-selection' ? (
              <div className="flex flex-col overflow-hidden">
                <div className="p-6">
                  <div className="mb-4">
                    <label htmlFor="phase_select" className="block text-sm font-medium text-gray-700 mb-2">
                      Select Phase <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="phase_select"
                      value={selectedPhaseForView !== null ? selectedPhaseForView : 'all'}
                      onChange={(e) => {
                        const phaseValue = e.target.value === 'all' ? null : parseInt(e.target.value);
                        if (e.target.value === 'all') {
                          setSelectedPhaseForView(null);
                          setViewStudentsStep('students-list');
                          if (selectedClassForView) {
                            fetchEnrolledStudentsForView(selectedClassForView.class_id, null);
                          }
                        } else if (phaseValue !== null) {
                          handlePhaseSelectForView(phaseValue);
                        }
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent"
                      required
                    >
                      <option value="all">All Phases</option>
                      {selectedClassForView.number_of_phase && Array.from({ length: selectedClassForView.number_of_phase }, (_, i) => i + 1).map((phaseNum) => (
                        <option key={phaseNum} value={phaseNum}>
                          Phase {phaseNum}
                        </option>
                      ))}
                    </select>
                    {selectedClassForView.number_of_phase && (
                      <p className="mt-2 text-sm text-gray-500">
                        This class has {selectedClassForView.number_of_phase} phase{selectedClassForView.number_of_phase !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end space-x-3 px-6 pb-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                  <button
                    type="button"
                    onClick={closeViewStudentsModal}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const selectElement = document.getElementById('phase_select');
                      if (selectElement && selectElement.value !== '') {
                        const phaseValue = selectElement.value === 'all' ? null : parseInt(selectElement.value);
                        if (phaseValue === null) {
                          setSelectedPhaseForView(null);
                          setViewStudentsStep('students-list');
                          if (selectedClassForView) {
                            fetchEnrolledStudentsForView(selectedClassForView.class_id, null);
                          }
                        } else {
                          handlePhaseSelectForView(phaseValue);
                        }
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 overflow-y-auto flex-1">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                      Students
                      {selectedPhaseForView !== null ? ` - Phase ${selectedPhaseForView}` : ' - All Phases'} ({viewEnrolledStudents.length})
                      {selectedClassForView.max_students && (
                        <span className="text-sm font-normal text-gray-500 ml-2">
                          / {selectedClassForView.max_students} max
                        </span>
                      )}
                    </h3>
                    <button
                      onClick={() => {
                        setViewStudentsStep('phase-selection');
                        setViewEnrolledStudents([]);
                      }}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center space-x-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      <span>Change Phase</span>
                    </button>
                  </div>

                  {loadingViewStudents ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                    </div>
                  ) : viewEnrolledStudents.length === 0 ? (
                    <div className="text-center py-12 bg-gray-50 rounded-lg border border-gray-200">
                      <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No students found</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        {selectedPhaseForView !== null 
                          ? `No students found in Phase ${selectedPhaseForView}.`
                          : 'No enrolled or reserved students in this class.'}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white rounded-lg border border-gray-200">
                      <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                        <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '900px' }}>
                          <thead className="bg-white">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Student Name
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Email
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Status
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Level Tag / Package
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Phase
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Date
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Enrolled By
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                            {viewEnrolledStudents.map((student) => {
                              const isReserved = student.student_type === 'reserved';
                              const uniqueKey = isReserved 
                                ? `reserved-${student.reservation_id}` 
                                : `enrolled-${student.classstudent_id || student.user_id}`;
                              
                              return (
                                <tr key={uniqueKey} className={isReserved ? 'bg-yellow-50' : ''}>
                                  <td className="px-4 py-4">
                                    <div className="text-sm font-medium text-gray-900">{student.full_name}</div>
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="text-sm text-gray-500">{student.email || '-'}</div>
                                  </td>
                                  <td className="px-4 py-4">
                                    {isReserved ? (
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                        student.reservation_status === 'Fee Paid'
                                          ? 'bg-green-100 text-green-800'
                                          : student.reservation_status === 'Upgraded'
                                          ? 'bg-blue-100 text-blue-800'
                                          : student.reservation_status === 'Cancelled'
                                          ? 'bg-red-100 text-red-800'
                                          : 'bg-yellow-100 text-yellow-800'
                                      }`}>
                                        {student.reservation_status || 'Reserved'}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        Enrolled
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="text-sm text-gray-500">
                                      {isReserved ? (student.package_name || '-') : (student.level_tag || '-')}
                                    </div>
                                  </td>
                                  <td className="px-4 py-4">
                                    {isReserved ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                        Reserved
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                        {student.phasesDisplay || `Phase ${student.phase_number || '-'}`}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="text-sm text-gray-500">
                                      {student.earliestEnrollment || student.enrolled_at
                                        ? new Date(student.earliestEnrollment || student.enrolled_at).toLocaleDateString('en-GB', {
                                            day: '2-digit',
                                            month: '2-digit',
                                            year: 'numeric',
                                          })
                                        : '-'}
                                    </div>
                                  </td>
                                  <td className="px-4 py-4">
                                    <div className="text-sm text-gray-500">{student.enrolled_by || '-'}</div>
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
              </div>
            )}

            {viewStudentsStep === 'students-list' && (
              <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                <button
                  type="button"
                  onClick={closeViewStudentsModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default TeacherClasses;

