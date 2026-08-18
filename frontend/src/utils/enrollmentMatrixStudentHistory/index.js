import { useCallback, useState } from 'react';

/**
 * True when the matrix row is a full-payment (or converted) enrollment track.
 * Month cells, phase cells, and last_full_pay_month_key all come from the
 * re-enrollment matrix API.
 */
export const matrixTrackIsFullPayment = (track) => {
  if (!track) return false;
  if (track.is_full_payment || track.last_full_pay_month_key) return true;
  const cells = [
    ...Object.values(track.months || {}),
    ...Object.values(track.phases || {}),
  ];
  return cells.some((cell) => Boolean(cell?.is_full_payment));
};

/** Map a matrix enrollment track row to the student object shape expected by StudentHistoryModal. */
export const matrixTrackToHistoryStudent = (track) => {
  const userId = track?.student_id;
  if (userId == null) return null;
  const isFullPayment = matrixTrackIsFullPayment(track);
  return {
    user_id: userId,
    full_name: track.full_name || track.display_name || '',
    email: track.email || '',
    focus_class_id: track.class_id ?? null,
    focus_class_name: track.class_name || track.class_level_tag || '',
    is_full_payment: isFullPayment,
    initial_tab: isFullPayment ? 'full-payment' : 'invoices',
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
