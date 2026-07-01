import { useCallback, useState } from 'react';

/** Map a matrix enrollment track row to the student object shape expected by StudentHistoryModal. */
export const matrixTrackToHistoryStudent = (track) => {
  const userId = track?.student_id;
  if (userId == null) return null;
  return {
    user_id: userId,
    full_name: track.full_name || track.display_name || '',
    email: track.email || '',
  };
};

/** Shared open/close state for Student history from enrollment matrix tables. */
export const useEnrollmentMatrixStudentHistory = () => {
  const [historyStudent, setHistoryStudent] = useState(null);

  const openHistory = useCallback((track) => {
    const student = matrixTrackToHistoryStudent(track);
    if (student?.user_id) setHistoryStudent(student);
  }, []);

  const closeHistory = useCallback(() => setHistoryStudent(null), []);

  return {
    historyStudent,
    isHistoryOpen: Boolean(historyStudent),
    openHistory,
    closeHistory,
  };
};
