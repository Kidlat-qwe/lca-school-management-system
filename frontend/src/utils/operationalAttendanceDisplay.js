import { formatDateManila } from './dateUtils';

export const OPERATIONAL_ATTENDANCE_VISIBLE_ROW_COUNT = 3;

export const formatOperationalSessionTime = (start, end) => {
  if (!start && !end) return '';
  const trim = (value) => (value ? String(value).slice(0, 5) : '');
  const startText = trim(start);
  const endText = trim(end);
  if (startText && endText) return `${startText} – ${endText}`;
  return startText || endText;
};

export const getOperationalClassLabel = (session) =>
  session.class_name || session.level_tag || `Class #${session.class_id}`;

export const getOperationalSessionLabel = (session) =>
  `Ph ${session.phase_number ?? '-'} · S${session.phase_session_number ?? '-'}`;

export const getOperationalScheduleLabel = (session, { includeDate = true } = {}) => {
  const parts = [];
  if (includeDate && session.scheduled_date) {
    parts.push(formatDateManila(`${session.scheduled_date}T12:00:00`));
  }
  const time = formatOperationalSessionTime(
    session.scheduled_start_time,
    session.scheduled_end_time
  );
  if (time) parts.push(time);
  return parts.join(' · ') || '—';
};

/** Matches class details: attendance saved when classsession status is Completed. */
export const isOperationalSessionAttendanceTaken = (session) =>
  session?.is_taken === true ||
  session?.attendance_status === 'completed' ||
  session?.status === 'Completed';

export const getOperationalAttendanceTakenMeta = (session) => {
  const isTaken = isOperationalSessionAttendanceTaken(session);
  const markedCount = Number(session.marked_count) || 0;
  const enrolledCount = Number(session.enrolled_count) || 0;

  if (isTaken) {
    return {
      label: 'Completed',
      badgeClass: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
      detail:
        markedCount > 0
          ? `${markedCount} of ${enrolledCount || markedCount} student(s) marked`
          : 'Attendance saved in class details',
    };
  }

  if (session.attendance_status === 'pending') {
    return {
      label: 'Not taken yet',
      badgeClass: 'bg-amber-100 text-amber-800 ring-amber-200',
      detail:
        enrolledCount > 0
          ? `${enrolledCount} enrolled student(s) — attendance still needed`
          : 'Attendance still needed',
    };
  }

  if (session.attendance_status === 'upcoming') {
    return {
      label: 'Upcoming',
      badgeClass: 'bg-slate-100 text-slate-700 ring-slate-200',
      detail: 'Session not due yet',
    };
  }

  if (session.status && session.status !== 'Scheduled') {
    return {
      label: session.status,
      badgeClass: 'bg-slate-100 text-slate-700 ring-slate-200',
      detail: null,
    };
  }

  return {
    label: 'Scheduled',
    badgeClass: 'bg-slate-100 text-slate-700 ring-slate-200',
    detail: null,
  };
};

export const getOperationalAttendanceActionMeta = (session) => {
  const isTaken = isOperationalSessionAttendanceTaken(session);

  if (isTaken) {
    return {
      actionLabel: 'View',
      actionClass: 'text-indigo-600 hover:text-indigo-800',
    };
  }

  if (session.attendance_status === 'pending') {
    return {
      actionLabel: 'Update',
      actionClass: 'text-[#b89200] hover:text-[#967800] font-semibold',
    };
  }

  return {
    actionLabel: 'Open',
    actionClass: 'text-indigo-600 hover:text-indigo-800',
  };
};

export const getOperationalSessionRowKey = (session) =>
  session.classsession_id ||
  `${session.class_id}-${session.phase_number}-${session.phase_session_number}-${session.scheduled_date}`;
