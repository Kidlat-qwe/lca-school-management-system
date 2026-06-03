/**
 * Client-side sort for enrollment matrix student rows (by first enrolled_at from API).
 */

export const sortMatrixStudentsByEnrollmentDate = (students, direction = 'asc') => {
  const mult = direction === 'desc' ? -1 : 1;
  return [...students].sort((a, b) => {
    const aTime = a.first_enrolled_at ? new Date(a.first_enrolled_at).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.first_enrolled_at ? new Date(b.first_enrolled_at).getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return mult * (aTime - bTime);
    const byStudent = (a.student_id || 0) - (b.student_id || 0);
    if (byStudent !== 0) return byStudent;
    return (a.class_id || 0) - (b.class_id || 0);
  });
};

/** Label shown in matrix student column (includes class when enrolled in multiple classes). */
export const matrixTrackDisplayName = (track) =>
  track?.display_name || track?.full_name || '';

export const formatMatrixEnrollmentDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
};

export const toggleEnrollmentDateSort = (current) => (current === 'asc' ? 'desc' : 'asc');
