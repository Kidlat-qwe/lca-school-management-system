import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { appAlert } from '../../utils/appAlert';

const formatClassScheduleForConflictApi = (daysOfWeek) => {
  if (!daysOfWeek) return [];

  if (Array.isArray(daysOfWeek)) {
    return daysOfWeek
      .map((row) => ({
        day: row.day || row.day_of_week,
        start_time: String(row.start_time || '').trim(),
        end_time: String(row.end_time || '').trim(),
        enabled: row.enabled !== false,
      }))
      .filter((d) => d.day && d.start_time && d.end_time && d.enabled);
  }

  return Object.entries(daysOfWeek)
    .map(([day, data]) => {
      const capitalizedDay = day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
      return {
        day: capitalizedDay,
        start_time: String(data?.start_time || '').trim(),
        end_time: String(data?.end_time || '').trim(),
        enabled: Boolean(data?.enabled),
      };
    })
    .filter((d) => d.enabled && d.start_time && d.end_time);
};

/**
 * Assign teacher before / while activating a class (previous teacher unavailable or none on file).
 */
const ClassReactivateAssignTeacherModal = ({
  open,
  classItem,
  onClose,
  onAssigned,
  activateOnAssign = true,
}) => {
  const [teachers, setTeachers] = useState([]);
  const [loadingTeachers, setLoadingTeachers] = useState(false);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [schedule, setSchedule] = useState({
    days_of_week: [],
    start_date: null,
    end_date: null,
  });
  const [selectedTeacherIds, setSelectedTeacherIds] = useState([]);
  const [teacherConflicts, setTeacherConflicts] = useState([]);
  const [conflictError, setConflictError] = useState('');
  const [checkingConflicts, setCheckingConflicts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const classId = classItem?.class_id;
  const branchId = classItem?.branch_id;
  const className = classItem?.class_name || 'this class';
  const teachersSkipped = Number(classItem?.teachers_skipped || 0);
  const pendingActivation = classItem?.pending_activation === true;

  const introMessage = pendingActivation
    ? teachersSkipped > 0
      ? `Assign a teacher to activate ${className}. The previous teacher is already assigned to another class.`
      : `Assign a teacher to activate ${className}.`
    : `${className} is active again. The previous teacher is already assigned to another class, so please choose a new teacher.`;

  const formattedSchedule = useMemo(
    () => formatClassScheduleForConflictApi(schedule.days_of_week),
    [schedule.days_of_week]
  );

  const hasBlockingConflicts = teacherConflicts.length > 0;

  const resetModalState = useCallback(() => {
    setSelectedTeacherIds([]);
    setSearchTerm('');
    setTeacherConflicts([]);
    setConflictError('');
    setCheckingConflicts(false);
    setSchedule({ days_of_week: [], start_date: null, end_date: null });
  }, []);

  const checkTeacherConflicts = useCallback(
    async (teacherIds) => {
      if (!teacherIds?.length || formattedSchedule.length === 0) {
        setTeacherConflicts([]);
        setConflictError('');
        return [];
      }

      const validTeacherIds = teacherIds
        .map((id) => parseInt(id, 10))
        .filter((id) => !Number.isNaN(id));

      if (validTeacherIds.length === 0) {
        setTeacherConflicts([]);
        setConflictError('');
        return [];
      }

      try {
        setCheckingConflicts(true);
        setConflictError('');

        const requestBody = {
          teacher_ids: validTeacherIds,
          days_of_week: formattedSchedule,
          exclude_class_id: classId,
        };
        if (schedule.start_date) requestBody.class_start_date = schedule.start_date;
        if (schedule.end_date) requestBody.class_end_date = schedule.end_date;

        const response = await apiRequest('/classes/check-teacher-conflicts', {
          method: 'POST',
          body: requestBody,
        });

        const conflicts =
          response?.success && response?.has_conflicts ? response.conflicts || [] : [];
        setTeacherConflicts(conflicts);
        return conflicts;
      } catch (err) {
        const errorMessage =
          err.response?.data?.message ||
          err.response?.data?.errors?.join(', ') ||
          err.message ||
          'Failed to check teacher schedule conflicts.';
        setConflictError(errorMessage);
        setTeacherConflicts([]);
        return [];
      } finally {
        setCheckingConflicts(false);
      }
    },
    [classId, formattedSchedule, schedule.end_date, schedule.start_date]
  );

  useEffect(() => {
    if (!open) {
      resetModalState();
      return;
    }

    const loadTeachers = async () => {
      try {
        setLoadingTeachers(true);
        const res = await apiRequest('/users?user_type=Teacher&limit=100');
        setTeachers(Array.isArray(res?.data) ? res.data : []);
      } catch (err) {
        appAlert(err.message || 'Failed to load teachers', { variant: 'error' });
        setTeachers([]);
      } finally {
        setLoadingTeachers(false);
      }
    };

    const loadClassSchedule = async () => {
      if (!classId) return;
      try {
        setLoadingSchedule(true);
        const res = await apiRequest(`/classes/${classId}`);
        const data = res?.data || {};
        setSchedule({
          days_of_week: data.days_of_week || classItem?.days_of_week || [],
          start_date: data.start_date || classItem?.start_date || null,
          end_date: data.end_date || classItem?.end_date || null,
        });
      } catch (err) {
        setSchedule({
          days_of_week: classItem?.days_of_week || [],
          start_date: classItem?.start_date || null,
          end_date: classItem?.end_date || null,
        });
        console.error('Failed to load class schedule for conflict check:', err);
      } finally {
        setLoadingSchedule(false);
      }
    };

    loadTeachers();
    loadClassSchedule();
  }, [open, classId, classItem, resetModalState]);

  useEffect(() => {
    if (!open || selectedTeacherIds.length === 0) {
      setTeacherConflicts([]);
      return;
    }
    checkTeacherConflicts(selectedTeacherIds);
  }, [open, selectedTeacherIds, checkTeacherConflicts]);

  const branchTeachers = useMemo(() => {
    if (!branchId) return teachers;
    return teachers.filter(
      (t) => Number(t.branch_id) === Number(branchId) || t.branch_id == null
    );
  }, [teachers, branchId]);

  const filteredTeachers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return branchTeachers;
    return branchTeachers.filter((t) =>
      String(t.full_name || '').toLowerCase().includes(q)
    );
  }, [branchTeachers, searchTerm]);

  const conflictTeacherIds = useMemo(
    () => new Set(teacherConflicts.map((c) => Number(c.teacher_id))),
    [teacherConflicts]
  );

  const toggleTeacher = (teacherId) => {
    const id = String(teacherId);
    setSelectedTeacherIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!classId || selectedTeacherIds.length === 0) {
      appAlert('Please select at least one teacher.', { variant: 'error' });
      return;
    }

    if (formattedSchedule.length === 0) {
      appAlert('This class has no schedule configured. Add a schedule before assigning a teacher.', {
        variant: 'error',
      });
      return;
    }

    const conflicts = await checkTeacherConflicts(selectedTeacherIds);
    if (conflicts.length > 0) {
      appAlert('Cannot assign teacher(s) with schedule conflicts. Please choose another teacher.', {
        variant: 'error',
      });
      return;
    }

    try {
      setSaving(true);
      await apiRequest(`/classes/${classId}`, {
        method: 'PUT',
        body: {
          teacher_ids: selectedTeacherIds
            .map((id) => parseInt(id, 10))
            .filter((id) => !Number.isNaN(id)),
        },
      });

      if (activateOnAssign && pendingActivation) {
        await apiRequest(`/classes/${classId}/status`, {
          method: 'PATCH',
          body: { status: 'Active' },
        });
        appAlert('Teacher assigned and class marked active.', { variant: 'success' });
      } else {
        appAlert('Teacher assigned successfully.', { variant: 'success' });
      }
      onAssigned?.();
      onClose?.();
    } catch (err) {
      appAlert(err.message || 'Failed to assign teacher', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!open || !classItem) return null;

  const scheduleReady = !loadingSchedule && formattedSchedule.length > 0;
  const canAssign =
    selectedTeacherIds.length > 0 &&
    scheduleReady &&
    !hasBlockingConflicts &&
    !checkingConflicts &&
    !saving;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reactivate-assign-teacher-title"
      >
        <div className="px-5 py-4 border-b border-gray-200">
          <h2
            id="reactivate-assign-teacher-title"
            className="text-lg font-semibold text-gray-900"
          >
            Assign teacher
          </h2>
          <p className="mt-1 text-sm text-gray-600">{introMessage}</p>
        </div>

        <div className="px-5 py-4 flex-1 overflow-y-auto">
          {loadingSchedule ? (
            <p className="text-sm text-gray-500 mb-3">Loading class schedule…</p>
          ) : formattedSchedule.length === 0 ? (
            <div className="mb-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
              This class has no weekly schedule on file. Conflict checking requires class days and
              times — edit the class schedule first.
            </div>
          ) : null}

          {conflictError && (
            <div className="mb-3 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
              {conflictError}
            </div>
          )}

          {teacherConflicts.length > 0 && (
            <div className="mb-3 p-3 rounded-lg border border-yellow-200 bg-yellow-50">
              <p className="text-sm font-medium text-yellow-800 mb-2">
                Schedule conflicts detected — assignment blocked
              </p>
              {teacherConflicts.map((conflict) => (
                <div key={conflict.teacher_id} className="mb-2 last:mb-0">
                  <p className="text-sm font-medium text-yellow-900">{conflict.teacher_name}:</p>
                  <ul className="ml-4 mt-1 space-y-1">
                    {(conflict.conflicts || []).map((c, idx) => (
                      <li key={idx} className="text-xs text-yellow-800">
                        • {c.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {checkingConflicts && selectedTeacherIds.length > 0 && (
            <p className="mb-2 text-xs text-gray-500">Checking schedule conflicts…</p>
          )}

          <label
            htmlFor="reactivate-teacher-search"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Search teachers
          </label>
          <input
            id="reactivate-teacher-search"
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Type a name…"
            className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />

          {loadingTeachers ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading teachers…</div>
          ) : filteredTeachers.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              No teachers found for this branch.
            </div>
          ) : (
            <ul className="space-y-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
              {filteredTeachers.map((teacher) => {
                const id = String(teacher.user_id);
                const checked = selectedTeacherIds.includes(id);
                const hasConflict = conflictTeacherIds.has(Number(teacher.user_id));
                return (
                  <li key={teacher.user_id}>
                    <label
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer ${
                        hasConflict && checked ? 'bg-yellow-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTeacher(teacher.user_id)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="flex-1 text-sm text-gray-900">
                        {teacher.full_name || '—'}
                      </span>
                      {hasConflict && checked && (
                        <span className="text-xs font-medium text-yellow-800 shrink-0">
                          Conflict
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Assign later
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canAssign}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : pendingActivation ? 'Assign & activate' : 'Assign teacher'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ClassReactivateAssignTeacherModal;
