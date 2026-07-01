import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { parseClassAttendanceSearchParams } from '../utils/classAttendanceDeepLink';

/**
 * Opens a class detail view and optionally the attendance modal from URL query params.
 */
export default function useClassAttendanceDeepLink({
  classes,
  viewMode,
  selectedClassForDetails,
  classSessions,
  loadingClassSessions,
  handleViewClass,
  openAttendanceModal,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const pendingRef = useRef(null);
  const openedClassRef = useRef(false);

  useEffect(() => {
    const parsed = parseClassAttendanceSearchParams(location.search);
    if (!parsed) {
      pendingRef.current = null;
      openedClassRef.current = false;
      return;
    }
    pendingRef.current = parsed;
    openedClassRef.current = false;
  }, [location.search]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || openedClassRef.current || classes.length === 0) return;

    const targetClass = classes.find((item) => String(item.class_id) === String(pending.classId));
    if (!targetClass) return;

    if (viewMode !== 'detail' || String(selectedClassForDetails?.class_id) !== String(pending.classId)) {
      openedClassRef.current = true;
      handleViewClass(targetClass);
    }
  }, [classes, viewMode, selectedClassForDetails, handleViewClass]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending?.openAttendance) return;
    if (viewMode !== 'detail' || !selectedClassForDetails) return;
    if (String(selectedClassForDetails.class_id) !== String(pending.classId)) return;
    if (loadingClassSessions) return;

    const classSession = pending.sessionId
      ? (classSessions || []).find(
          (session) => String(session.classsession_id) === String(pending.sessionId)
        )
      : null;

    openAttendanceModal(
      classSession,
      pending.phaseNumber ? parseInt(pending.phaseNumber, 10) : classSession?.phase_number,
      pending.phaseSessionNumber
        ? parseInt(pending.phaseSessionNumber, 10)
        : classSession?.phase_session_number,
      pending.scheduledDate || classSession?.scheduled_date
    );

    pendingRef.current = null;
    navigate(location.pathname, { replace: true });
  }, [
    viewMode,
    selectedClassForDetails,
    classSessions,
    loadingClassSessions,
    openAttendanceModal,
    navigate,
    location.pathname,
  ]);
}
