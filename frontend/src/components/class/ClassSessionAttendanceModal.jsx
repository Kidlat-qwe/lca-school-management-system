import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';
import { appAlert } from '../../utils/appAlert';

const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Late', 'Excused', 'Leave Early'];

const formatTime12h = (time) => {
  if (!time) return '';
  const [hourStr, minuteStr] = String(time).split(':');
  const hour = parseInt(hourStr, 10);
  const minutes = minuteStr ?? '00';
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes.padStart(2, '0')} ${period}`;
};

const statusConfigMap = {
  Present: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: 'bg-green-500', hover: 'hover:bg-green-100' },
  Absent: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'bg-red-500', hover: 'hover:bg-red-100' },
  Late: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', icon: 'bg-yellow-500', hover: 'hover:bg-yellow-100' },
  Excused: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', icon: 'bg-blue-500', hover: 'hover:bg-blue-100' },
  'Leave Early': { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', icon: 'bg-purple-500', hover: 'hover:bg-purple-100' },
  Pending: { bg: 'bg-white', border: 'border-gray-200', text: 'text-gray-600', icon: 'bg-gray-400', hover: 'hover:bg-gray-50' },
};

/**
 * Shared class session attendance modal — same API as Class Details attendance.
 * Saves via POST /attendance/session/:sessionId so data stays in sync with Classes page.
 */
export default function ClassSessionAttendanceModal({
  open,
  onClose,
  classsessionId = null,
  teacherName = '',
  onSaved,
}) {
  const [attendanceData, setAttendanceData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [attendanceNotes, setAttendanceNotes] = useState('');
  const [attendanceAgenda, setAttendanceAgenda] = useState('');
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [isAgendaModalOpen, setIsAgendaModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [agendaDraft, setAgendaDraft] = useState('');

  const fetchAttendance = useCallback(async () => {
    if (!classsessionId) return;
    try {
      setLoading(true);
      const response = await apiRequest(`/attendance/session/${classsessionId}`);
      const data = response.data || response;
      setAttendanceData(data);
      setAttendanceNotes(data?.session?.notes || '');
      setAttendanceAgenda(data?.session?.agenda || '');
      setJustSaved(false);
    } catch (err) {
      appAlert(err?.message || 'Failed to load attendance data');
      setAttendanceData(null);
    } finally {
      setLoading(false);
    }
  }, [classsessionId]);

  useEffect(() => {
    if (open && classsessionId) {
      fetchAttendance();
    } else if (!open) {
      setAttendanceData(null);
      setJustSaved(false);
      setIsNoteModalOpen(false);
      setIsAgendaModalOpen(false);
    }
  }, [open, classsessionId, fetchAttendance]);

  const handleAttendanceStatusChange = (studentId, status) => {
    setAttendanceData((prev) => ({
      ...prev,
      students: prev.students.map((student) =>
        student.student_id === studentId
          ? {
              ...student,
              attendance: {
                ...student.attendance,
                student_id: studentId,
                status,
                notes: student.attendance?.notes || '',
              },
            }
          : student
      ),
    }));
  };

  const handleSaveAttendance = async () => {
    if (!attendanceData || !classsessionId) return;

    try {
      setSaving(true);
      const attendanceRecords = (attendanceData.students || [])
        .filter((student) => student.attendance && student.attendance.status)
        .map((student) => ({
          student_id: student.student_id,
          status: student.attendance?.status || 'Present',
          notes: student.attendance?.notes || '',
        }));

      await apiRequest(`/attendance/session/${classsessionId}`, {
        method: 'POST',
        body: JSON.stringify({ attendance: attendanceRecords }),
      });

      await fetchAttendance();
      setJustSaved(true);
      onSaved?.();
    } catch (err) {
      appAlert(err?.message || 'Failed to save attendance');
    } finally {
      setSaving(false);
    }
  };

  const attendanceWindow = useMemo(() => {
    const scheduledDate = attendanceData?.session?.scheduled_date;
    if (!scheduledDate) return { isOpen: false, reason: 'No session date available' };

    const sessionDate = new Date(`${scheduledDate}T12:00:00`);
    const today = new Date();
    sessionDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    if (today < sessionDate) {
      return {
        isOpen: false,
        reason: 'future',
        message: 'Cannot mark attendance for a future session. Please wait until the session date.',
      };
    }
    return { isOpen: true, reason: 'current' };
  }, [attendanceData?.session?.scheduled_date]);

  const hasPendingStudents = useMemo(
    () =>
      (attendanceData?.students || []).some(
        (student) => !student.attendance || !student.attendance.status
      ),
    [attendanceData?.students]
  );

  const isAttendanceWindowClosed = !attendanceWindow.isOpen;
  const isAttendanceLocked =
    justSaved ||
    attendanceData?.session?.status === 'Completed' ||
    isAttendanceWindowClosed;

  const lockReason =
    attendanceData?.session?.status === 'Completed'
      ? 'Attendance for this session has been saved and can no longer be edited.'
      : isAttendanceWindowClosed
        ? attendanceWindow.message
        : '';

  const displayTeacherName = teacherName || '—';
  const session = attendanceData?.session;

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[10050] flex items-center justify-center p-4 backdrop-blur-sm bg-black/40"
        onClick={onClose}
      >
        {loading || !attendanceData ? (
          <div className="rounded-lg bg-white p-8 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-[#F7C844]" />
            <p className="text-gray-600">Loading attendance data...</p>
          </div>
        ) : (
          <div
            className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-gradient-to-r from-[#F7C844] to-[#F5B82E] p-6">
              <div className="flex-1 min-w-0">
                <div className="mb-2 flex flex-wrap items-center text-sm font-medium text-gray-900">
                  <span>{session?.scheduled_date ? formatDateManila(session.scheduled_date) : '-'}</span>
                  {session?.scheduled_start_time && session?.scheduled_end_time ? (
                    <>
                      <span className="mx-2">|</span>
                      <span>
                        {formatTime12h(session.scheduled_start_time)} - {formatTime12h(session.scheduled_end_time)}
                      </span>
                    </>
                  ) : null}
                </div>
                <h2 className="truncate text-2xl font-bold text-gray-900 sm:text-3xl">
                  {session?.class_name || session?.level_tag || 'Class'}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-800">
                  <span className="font-medium">{session?.program_name || ''}</span>
                  {session?.phase_number != null && session?.phase_session_number != null ? (
                    <span className="rounded bg-white/30 px-2 py-0.5 font-semibold text-gray-900">
                      Phase {session.phase_number} Session {session.phase_session_number}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-3">
                <div className="hidden rounded-lg bg-white/20 px-3 py-2 sm:block">
                  <div className="text-xs text-gray-800 opacity-90">Teacher</div>
                  <div className="max-w-[160px] truncate text-sm font-semibold text-gray-900">{displayTeacherName}</div>
                </div>
                <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-900 hover:bg-white/20">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                <div className="space-y-6">
                  {!isAttendanceLocked ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-gray-900">Quick Actions</span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={isAttendanceLocked}
                            onClick={() =>
                              setAttendanceData((prev) => ({
                                ...prev,
                                students: prev.students.map((student) => ({
                                  ...student,
                                  attendance: {
                                    ...student.attendance,
                                    student_id: student.student_id,
                                    status: 'Present',
                                    notes: student.attendance?.notes || '',
                                  },
                                })),
                              }))
                            }
                            className="rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
                          >
                            All Present
                          </button>
                          <button
                            type="button"
                            disabled={isAttendanceLocked}
                            onClick={() =>
                              setAttendanceData((prev) => ({
                                ...prev,
                                students: prev.students.map((student) => ({
                                  ...student,
                                  attendance: {
                                    ...student.attendance,
                                    student_id: student.student_id,
                                    status: 'Absent',
                                    notes: student.attendance?.notes || '',
                                  },
                                })),
                              }))
                            }
                            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
                          >
                            All Absent
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isAttendanceWindowClosed ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                      {attendanceWindow.message}
                    </div>
                  ) : null}

                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-gray-900">Students</h3>
                      <span className="text-sm text-gray-600">
                        {(attendanceData.students || []).filter((s) => s.attendance?.status === 'Present').length} /{' '}
                        {attendanceData.students?.length || 0} Present
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {(attendanceData.students || []).map((student) => {
                        const rawStatus = student.attendance?.status || null;
                        const attendanceStatus = rawStatus || 'Pending';
                        const config = statusConfigMap[attendanceStatus] || statusConfigMap.Pending;

                        return (
                          <button
                            key={student.student_id}
                            type="button"
                            disabled={isAttendanceLocked}
                            onClick={() => {
                              if (isAttendanceLocked) return;
                              const currentIndex = ATTENDANCE_STATUSES.indexOf(attendanceStatus);
                              const nextIndex =
                                currentIndex >= 0 ? (currentIndex + 1) % ATTENDANCE_STATUSES.length : 0;
                              handleAttendanceStatusChange(student.student_id, ATTENDANCE_STATUSES[nextIndex]);
                            }}
                            className={`relative flex flex-col items-center rounded-xl border-2 p-4 shadow-sm transition-all ${config.bg} ${config.border} ${config.hover} disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            {attendanceStatus !== 'Pending' ? (
                              <div className={`absolute right-2 top-2 h-3 w-3 rounded-full ring-2 ring-white ${config.icon}`} />
                            ) : null}
                            <div className="mb-3 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-white shadow-md ring-2 ring-gray-100">
                              {student.profile_picture_url ? (
                                <img src={student.profile_picture_url} alt={student.full_name} className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-2xl font-bold text-gray-600">
                                  {student.full_name?.charAt(0)?.toUpperCase() || '?'}
                                </span>
                              )}
                            </div>
                            <div className="mb-2 line-clamp-2 text-center text-sm font-semibold text-gray-900">
                              {student.full_name}
                            </div>
                            <div className={`text-xs font-bold uppercase tracking-wide ${config.text}`}>
                              {rawStatus || 'Mark Attendance'}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-6">
                    <h3 className="mb-4 text-lg font-semibold text-gray-900">Session Details</h3>
                    <div className="space-y-4">
                      <div>
                        <p className="mb-1 text-sm font-semibold text-gray-700">Topic</p>
                        <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-900">
                          {session?.topic || <span className="italic text-gray-400">No topic specified</span>}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-sm font-semibold text-gray-700">Notes</p>
                        <div className="min-h-[60px] rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
                          {attendanceNotes?.trim() ? (
                            <div className="whitespace-pre-wrap">{attendanceNotes}</div>
                          ) : (
                            <span className="italic text-gray-400">No notes added yet.</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-sm font-semibold text-gray-700">Agenda</p>
                        <div className="min-h-[60px] rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
                          {attendanceAgenda?.trim() ? (
                            <div className="whitespace-pre-wrap">{attendanceAgenda}</div>
                          ) : (
                            <span className="italic text-gray-400">No agenda added yet.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex w-full flex-col border-t border-gray-200 bg-gray-50 p-4 sm:p-6 lg:w-80 lg:border-l lg:border-t-0">
                <h3 className="mb-4 text-lg font-bold text-gray-900">Actions</h3>
                {isAttendanceLocked && session?.status === 'Completed' ? (
                  <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-100 p-3">
                    <svg className="h-5 w-5 shrink-0 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <div className="text-sm font-semibold text-green-900">Completed</div>
                      <div className="text-xs text-green-700">Attendance saved successfully</div>
                    </div>
                  </div>
                ) : null}

                <div className="mb-auto space-y-3">
                  <button
                    type="button"
                    disabled={isAttendanceLocked}
                    onClick={() => {
                      setNoteDraft(attendanceNotes || '');
                      setIsNoteModalOpen(true);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50"
                  >
                    <span className="text-sm font-bold text-gray-800">Add Note</span>
                  </button>
                  <button
                    type="button"
                    disabled={isAttendanceLocked}
                    onClick={() => {
                      setAgendaDraft(attendanceAgenda || '');
                      setIsAgendaModalOpen(true);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50"
                  >
                    <span className="text-sm font-bold text-gray-800">Add Agenda</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleSaveAttendance}
                  disabled={saving || !classsessionId || hasPendingStudents || isAttendanceLocked}
                  title={isAttendanceLocked ? lockReason : hasPendingStudents ? 'Mark all students before saving.' : ''}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#F7C844] to-[#F5B82E] px-6 py-4 text-lg font-bold text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving...' : session?.status === 'Completed' || justSaved ? 'Attendance Saved' : 'Save Attendance'}
                </button>
                {hasPendingStudents && !isAttendanceLocked ? (
                  <p className="mt-3 text-center text-xs text-amber-600">Mark all students before saving</p>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {isNoteModalOpen && !isAttendanceLocked ? (
        <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/40 p-4" onClick={() => setIsNoteModalOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Add Note</h3>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={5}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
              placeholder="Add notes for this session..."
            />
            <div className="mt-4 flex justify-end gap-3">
              <button type="button" onClick={() => setIsNoteModalOpen(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setAttendanceNotes(noteDraft || '');
                  setIsNoteModalOpen(false);
                }}
                className="rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-semibold text-gray-900"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAgendaModalOpen && !isAttendanceLocked ? (
        <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/40 p-4" onClick={() => setIsAgendaModalOpen(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-semibold text-gray-900">Add Agenda</h3>
            <textarea
              value={agendaDraft}
              onChange={(e) => setAgendaDraft(e.target.value)}
              rows={5}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40"
              placeholder="Add agenda for this session..."
            />
            <div className="mt-4 flex justify-end gap-3">
              <button type="button" onClick={() => setIsAgendaModalOpen(false)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setAttendanceAgenda(agendaDraft || '');
                  setIsAgendaModalOpen(false);
                }}
                className="rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-semibold text-gray-900"
              >
                Save Agenda
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body
  );
}
