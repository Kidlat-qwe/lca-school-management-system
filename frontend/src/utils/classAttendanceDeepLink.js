/**
 * Build URLs and role-aware paths for opening class attendance from dashboards.
 */

export function getClassesBasePath(userType) {
  switch (userType) {
    case 'Superadmin':
      return '/superadmin';
    case 'Admin':
      return '/admin';
    case 'Teacher':
      return '/teacher';
    default:
      return '/admin';
  }
}

export function buildClassAttendanceUrl(basePath, session) {
  if (!session?.class_id) return `${basePath}/classes`;

  const params = new URLSearchParams();
  params.set('classId', String(session.class_id));

  if (session.classsession_id) {
    params.set('sessionId', String(session.classsession_id));
  }
  if (session.phase_number != null) {
    params.set('phaseNumber', String(session.phase_number));
  }
  if (session.phase_session_number != null) {
    params.set('phaseSessionNumber', String(session.phase_session_number));
  }
  if (session.scheduled_date) {
    params.set('scheduledDate', session.scheduled_date);
  }
  params.set('openAttendance', '1');

  return `${basePath}/classes?${params.toString()}`;
}

export function parseClassAttendanceSearchParams(search) {
  const params = new URLSearchParams(search);
  const classId = params.get('classId');
  if (!classId) return null;

  return {
    classId,
    sessionId: params.get('sessionId'),
    phaseNumber: params.get('phaseNumber'),
    phaseSessionNumber: params.get('phaseSessionNumber'),
    scheduledDate: params.get('scheduledDate'),
    openAttendance: params.get('openAttendance') === '1',
  };
}
