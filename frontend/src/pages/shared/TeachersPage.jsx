import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../contexts/GlobalBranchFilterContext';
import FixedTablePagination, { TablePaginationSummary } from '../../components/table/FixedTablePagination';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { appAlert } from '../../utils/appAlert';

/**
 * Teachers management — list teachers with assigned classes and class turnover.
 * Used by Superadmin and Branch Admin under Manage Users.
 */
const TeachersPage = () => {
  const { userInfo } = useAuth();
  const userType = userInfo?.userType || userInfo?.user_type;
  const isSuperadmin = userType === 'Superadmin';
  const { selectedBranchId: globalBranchId } = useGlobalBranchFilter();

  const MAX_VISIBLE_CLASSES = 2;

  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebouncedValue(searchTerm, 300);
  const [programId, setProgramId] = useState('');
  const [programs, setPrograms] = useState([]);
  const [expandedTeachers, setExpandedTeachers] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });

  const [turnoverTeacher, setTurnoverTeacher] = useState(null);
  const [toTeacherId, setToTeacherId] = useState('');
  const [selectedClassIds, setSelectedClassIds] = useState([]);
  const [candidateTeachers, setCandidateTeachers] = useState([]);
  const [turnoverLoading, setTurnoverLoading] = useState(false);
  const [turnoverError, setTurnoverError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [classFit, setClassFit] = useState([]); // per-class status from preview

  const [historyTeacher, setHistoryTeacher] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const branchQuery = useMemo(() => {
    if (!isSuperadmin) return null;
    if (globalBranchId != null && globalBranchId !== '' && Number.isFinite(Number(globalBranchId))) {
      return Number(globalBranchId);
    }
    return null;
  }, [isSuperadmin, globalBranchId]);

  const fetchTeachers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (branchQuery != null) params.set('branch_id', String(branchQuery));
      if (programId) params.set('program_id', String(programId));

      const res = await apiRequest(`/teachers?${params.toString()}`);
      setTeachers(Array.isArray(res?.data) ? res.data : []);
      setPagination({
        total: res?.pagination?.total || 0,
        totalPages: res?.pagination?.totalPages || 1,
      });
      setExpandedTeachers(new Set());
    } catch (err) {
      setError(err.message || 'Failed to load teachers');
      setTeachers([]);
    } finally {
      setLoading(false);
    }
  }, [page, limit, debouncedSearch, branchQuery, programId]);

  useEffect(() => {
    fetchTeachers();
  }, [fetchTeachers]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, branchQuery, programId]);

  useEffect(() => {
    const loadPrograms = async () => {
      try {
        const res = await apiRequest('/programs?limit=500', { cache: 'reference' });
        const list = Array.isArray(res?.data) ? res.data : [];
        setPrograms(
          [...list].sort((a, b) =>
            String(a.program_name || '').localeCompare(String(b.program_name || ''))
          )
        );
      } catch (err) {
        console.error('Failed to load programs for teacher filter:', err);
        setPrograms([]);
      }
    };
    loadPrograms();
  }, []);

  const toggleTeacherClasses = (teacherId) => {
    setExpandedTeachers((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) next.delete(teacherId);
      else next.add(teacherId);
      return next;
    });
  };

  useEffect(() => {
    const onDocClick = (e) => {
      if (!e.target.closest('.teacher-action-menu') && !e.target.closest('.teacher-action-overlay')) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const openMenu = (teacherId, event) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
    setOpenMenuId((prev) => (prev === teacherId ? null : teacherId));
  };

  const openClassHistory = async (teacher) => {
    setOpenMenuId(null);
    setHistoryTeacher(teacher);
    setHistoryRows([]);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      const res = await apiRequest(`/teachers/${teacher.user_id}/class-history`);
      setHistoryRows(Array.isArray(res?.data?.history) ? res.data.history : []);
    } catch (err) {
      setHistoryError(err.message || 'Failed to load class history');
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeClassHistory = () => {
    setHistoryTeacher(null);
    setHistoryRows([]);
    setHistoryError('');
  };

  const openTurnover = async (teacher) => {
    setOpenMenuId(null);
    setTurnoverTeacher(teacher);
    setSelectedClassIds([]);
    setToTeacherId('');
    setTurnoverError('');
    setClassFit([]);
    setPreviewLoading(false);

    try {
      const params = new URLSearchParams({ page: '1', limit: '100' });
      if (teacher.branch_id) params.set('branch_id', String(teacher.branch_id));
      else if (branchQuery != null) params.set('branch_id', String(branchQuery));
      const res = await apiRequest(`/teachers?${params.toString()}`);
      const list = (Array.isArray(res?.data) ? res.data : []).filter(
        (t) => Number(t.user_id) !== Number(teacher.user_id)
      );
      setCandidateTeachers(list);
    } catch (err) {
      setCandidateTeachers([]);
      setTurnoverError(err.message || 'Failed to load destination teachers');
    }
  };

  const closeTurnover = () => {
    if (turnoverLoading) return;
    setTurnoverTeacher(null);
    setToTeacherId('');
    setSelectedClassIds([]);
    setClassFit([]);
    setPreviewLoading(false);
    setTurnoverError('');
  };

  // Live schedule fit as soon as a destination teacher is selected.
  useEffect(() => {
    if (!turnoverTeacher || !toTeacherId) {
      setClassFit([]);
      setPreviewLoading(false);
      return undefined;
    }

    let cancelled = false;
    const runPreview = async () => {
      setPreviewLoading(true);
      setTurnoverError('');
      try {
        const allClassIds = (turnoverTeacher.classes || []).map((c) => c.class_id);
        const res = await apiRequest(`/teachers/${turnoverTeacher.user_id}/turnover/preview`, {
          method: 'POST',
          body: JSON.stringify({
            to_teacher_id: Number(toTeacherId),
            class_ids: allClassIds,
          }),
        });
        if (cancelled) return;
        const classes = Array.isArray(res?.data?.classes) ? res.data.classes : [];
        setClassFit(classes);
        // Auto-select only classes that can transfer (ok or already assigned).
        setSelectedClassIds(
          classes
            .filter((c) => c.status === 'ok' || c.status === 'already_assigned')
            .map((c) => c.class_id)
        );
      } catch (err) {
        if (cancelled) return;
        setClassFit([]);
        setSelectedClassIds([]);
        setTurnoverError(err.response?.data?.message || err.message || 'Failed to check schedule fit');
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };

    runPreview();
    return () => {
      cancelled = true;
    };
  }, [turnoverTeacher, toTeacherId]);

  const toggleClass = (classId) => {
    setSelectedClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  };

  const transferableIds = useMemo(
    () =>
      classFit
        .filter((c) => c.status === 'ok' || c.status === 'already_assigned')
        .map((c) => c.class_id),
    [classFit]
  );

  const toggleAllClasses = () => {
    setSelectedClassIds((prev) =>
      prev.length === transferableIds.length ? [] : [...transferableIds]
    );
  };

  const submitTurnover = async () => {
    if (!turnoverTeacher) return;
    if (!toTeacherId) {
      setTurnoverError('Please select the teacher who will receive the classes.');
      return;
    }
    const allowedSelected = selectedClassIds.filter((id) => transferableIds.includes(id));
    if (allowedSelected.length === 0) {
      setTurnoverError('No transferable classes selected. Resolve schedule conflicts first.');
      return;
    }

    setTurnoverLoading(true);
    setTurnoverError('');
    try {
      const res = await apiRequest(`/teachers/${turnoverTeacher.user_id}/turnover`, {
        method: 'POST',
        body: JSON.stringify({
          to_teacher_id: Number(toTeacherId),
          class_ids: allowedSelected,
        }),
      });
      appAlert(res.message || 'Classes turned over successfully.');
      closeTurnover();
      await fetchTeachers();
    } catch (err) {
      const data = err.response?.data;
      setTurnoverError(data?.message || err.message || 'Turnover failed');
      if (Array.isArray(data?.conflicts)) {
        setClassFit((prev) => {
          const byId = new Map(prev.map((c) => [c.class_id, c]));
          for (const block of data.conflicts) {
            byId.set(block.class_id, {
              ...(byId.get(block.class_id) || {}),
              class_id: block.class_id,
              class_name: block.class_name,
              status: 'conflict',
              conflicts: block.conflicts || [],
            });
          }
          return [...byId.values()];
        });
      }
    } finally {
      setTurnoverLoading(false);
    }
  };

  const fitByClassId = useMemo(() => {
    const map = new Map();
    for (const row of classFit) map.set(row.class_id, row);
    return map;
  }, [classFit]);

  const formatClassRange = (cls) => {
    if (!cls.start_date && !cls.end_date) return '—';
    return `${cls.start_date || '—'} — ${cls.end_date || '—'}`;
  };

  if (userType && userType !== 'Superadmin' && userType !== 'Admin') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-700">
        Access denied. The Teachers page is available to Superadmin and Admin only.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Teachers</h1>
          <p className="text-sm text-gray-600 mt-1">
            View assigned classes and turn over classes when a teacher resigns or changes schedule.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 min-w-0">
            <label htmlFor="teacher-search" className="sr-only">
              Search teachers
            </label>
            <input
              id="teacher-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by teacher name or email..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="sm:w-56 shrink-0">
            <label htmlFor="teacher-program-filter" className="sr-only">
              Filter by program
            </label>
            <select
              id="teacher-program-filter"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All programs</option>
              {programs.map((p) => (
                <option key={p.program_id} value={p.program_id}>
                  {p.program_name || `Program ${p.program_id}`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>
      ) : null}

      <div className="bg-white rounded-lg shadow">
        {pagination.total > 0 ? (
          <TablePaginationSummary
            page={page}
            totalItems={pagination.total}
            itemsPerPage={limit}
            itemLabel="teachers"
            className="px-4 pt-4 pb-2"
          />
        ) : null}

        <div
          className="overflow-x-auto rounded-lg"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#cbd5e0 #f7fafc',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '880px' }}>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Teacher</th>
                {isSuperadmin ? (
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch</th>
                ) : null}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Assigned classes
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={isSuperadmin ? 4 : 3} className="px-4 py-10 text-center text-sm text-gray-600">
                    Loading teachers...
                  </td>
                </tr>
              ) : teachers.length === 0 ? (
                <tr>
                  <td colSpan={isSuperadmin ? 4 : 3} className="px-4 py-10 text-center text-sm text-gray-500">
                    No teachers found.
                  </td>
                </tr>
              ) : (
                teachers.map((teacher) => (
                  <tr key={teacher.user_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-gray-900">{teacher.full_name}</div>
                      <div className="text-xs text-gray-500">{teacher.email}</div>
                      {teacher.phone_number ? (
                        <div className="text-xs text-gray-500">{teacher.phone_number}</div>
                      ) : null}
                    </td>
                    {isSuperadmin ? (
                      <td className="px-4 py-3 align-top text-sm text-gray-700">
                        {teacher.branch_label || '—'}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 align-top text-sm text-gray-700">
                      {(teacher.classes || []).length === 0 ? (
                        <span className="text-gray-400">No active classes</span>
                      ) : (
                        (() => {
                          const classes = teacher.classes || [];
                          const isExpanded = expandedTeachers.has(teacher.user_id);
                          const visibleClasses = isExpanded
                            ? classes
                            : classes.slice(0, MAX_VISIBLE_CLASSES);
                          const hiddenCount = classes.length - MAX_VISIBLE_CLASSES;
                          return (
                            <div className="min-h-[3.25rem]">
                              <ul className="space-y-1">
                                {visibleClasses.map((cls) => (
                                  <li key={cls.class_id} className="leading-snug">
                                    <span className="font-medium text-gray-900">{cls.class_name}</span>
                                    {cls.program_name ? (
                                      <span className="text-gray-500"> · {cls.program_name}</span>
                                    ) : null}
                                    <span className="block text-xs text-gray-500">
                                      {formatClassRange(cls)}
                                      {cls.room_name ? ` · ${cls.room_name}` : ''}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                              {hiddenCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => toggleTeacherClasses(teacher.user_id)}
                                  className="mt-1.5 text-xs font-semibold text-primary-700 hover:text-primary-800"
                                >
                                  {isExpanded
                                    ? 'See less'
                                    : `See more (${hiddenCount} more)`}
                                </button>
                              ) : null}
                            </div>
                          );
                        })()
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <button
                        type="button"
                        onClick={(e) => openMenu(teacher.user_id, e)}
                        className="teacher-action-menu p-2 rounded-full hover:bg-gray-100"
                        aria-label="Teacher actions"
                      >
                        <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 ? (
          <FixedTablePagination
            page={page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            itemsPerPage={limit}
            itemLabel="teachers"
            onPageChange={setPage}
          />
        ) : null}
      </div>

      {openMenuId != null &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40 teacher-action-overlay" onClick={() => setOpenMenuId(null)} />
            <div
              className="fixed z-50 teacher-action-menu bg-white border border-gray-200 rounded-md shadow-lg w-48 py-1"
              style={{ top: menuPosition.top, right: menuPosition.right }}
            >
              <button
                type="button"
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => {
                  const teacher = teachers.find((t) => t.user_id === openMenuId);
                  if (teacher) openClassHistory(teacher);
                }}
              >
                Class history
              </button>
              <button
                type="button"
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                disabled={
                  !(teachers.find((t) => t.user_id === openMenuId)?.classes || []).length
                }
                onClick={() => {
                  const teacher = teachers.find((t) => t.user_id === openMenuId);
                  if (teacher) openTurnover(teacher);
                }}
              >
                Turn over classes
              </button>
            </div>
          </>,
          document.body
        )}

      {turnoverTeacher &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm bg-black/30"
            onClick={closeTurnover}
            role="presentation"
          >
            <div
              className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-[min(96vw,56rem)] max-h-[92vh] sm:max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="turnover-title"
            >
              {/* Header — system primary yellow palette */}
              <div className="relative bg-gradient-to-r from-primary-500 to-primary-600 px-5 sm:px-8 py-5 text-white">
                <button
                  type="button"
                  onClick={closeTurnover}
                  disabled={turnoverLoading}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-white/90 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/50"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="flex items-start gap-3 pr-8">
                  <div className="shrink-0 rounded-xl bg-white/20 p-2.5">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                      />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <h2 id="turnover-title" className="text-lg sm:text-xl font-bold tracking-tight">
                      Turn over classes
                    </h2>
                    <p className="text-sm text-white/90 mt-1">
                      Move classes from a resigning teacher only when the new schedule fits.
                    </p>
                  </div>
                </div>

                {/* From → To flow */}
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <div className="flex-1 rounded-xl bg-white/15 backdrop-blur-sm px-3 py-2.5 min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-white/80 font-semibold">From</p>
                    <p className="text-sm font-semibold truncate" title={turnoverTeacher.full_name}>
                      {turnoverTeacher.full_name}
                    </p>
                    <p className="text-xs text-white/80 truncate">{turnoverTeacher.email}</p>
                  </div>
                  <div className="hidden sm:flex shrink-0 text-white/90">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </div>
                  <div className="flex-1 rounded-xl bg-white/15 backdrop-blur-sm px-3 py-2.5 min-w-0">
                    <p className="text-[11px] uppercase tracking-wide text-white/80 font-semibold">To</p>
                    {toTeacherId ? (
                      <>
                        <p className="text-sm font-semibold truncate">
                          {candidateTeachers.find((t) => String(t.user_id) === String(toTeacherId))
                            ?.full_name || 'Selected teacher'}
                        </p>
                        <p className="text-xs text-white/80 truncate">
                          {candidateTeachers.find((t) => String(t.user_id) === String(toTeacherId))
                            ?.branch_label || '—'}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-white/80 italic">Select a teacher below</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5 space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                {/* Destination picker */}
                <div className="lg:col-span-2 rounded-xl border border-primary-100 bg-primary-50/40 p-4">
                  <label
                    className="block text-sm font-semibold text-gray-900 mb-2"
                    htmlFor="to-teacher"
                  >
                    New teacher
                  </label>
                  <select
                    id="to-teacher"
                    value={toTeacherId}
                    onChange={(e) => setToTeacherId(e.target.value)}
                    className="w-full rounded-xl border border-primary-200 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                  >
                    <option value="">Select teacher who will receive the classes...</option>
                    {candidateTeachers.map((t) => (
                      <option key={t.user_id} value={t.user_id}>
                        {t.full_name}
                        {t.branch_label ? ` · ${t.branch_label}` : ''}
                      </option>
                    ))}
                  </select>

                {/* Summary chips after preview */}
                {toTeacherId && !previewLoading && classFit.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    <div className="rounded-xl border border-green-200 bg-green-50 px-2 py-2 text-center">
                      <p className="text-lg font-bold text-green-800">
                        {classFit.filter((c) => c.status === 'ok').length}
                      </p>
                      <p className="text-[10px] font-medium text-green-700">Can transfer</p>
                    </div>
                    <div className="rounded-xl border border-red-200 bg-red-50 px-2 py-2 text-center">
                      <p className="text-lg font-bold text-red-800">
                        {classFit.filter((c) => c.status === 'conflict').length}
                      </p>
                      <p className="text-[10px] font-medium text-red-700">Conflicts</p>
                    </div>
                    <div className="rounded-xl border border-primary-200 bg-primary-50 px-2 py-2 text-center">
                      <p className="text-lg font-bold text-primary-800">
                        {classFit.filter((c) => c.status === 'already_assigned').length}
                      </p>
                      <p className="text-[10px] font-medium text-primary-700">Already on</p>
                    </div>
                  </div>
                ) : null}
                </div>

                {/* Class list */}
                <div className="lg:col-span-3 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">
                        {toTeacherId ? 'Schedule fit by class' : 'Classes to transfer'}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {(turnoverTeacher.classes || []).length} class
                        {(turnoverTeacher.classes || []).length === 1 ? '' : 'es'} assigned to{' '}
                        {turnoverTeacher.full_name.split(' ')[0]}
                      </p>
                    </div>
                    {toTeacherId && transferableIds.length > 0 && !previewLoading ? (
                      <button
                        type="button"
                        onClick={toggleAllClasses}
                        className="shrink-0 text-xs font-semibold text-primary-700 hover:text-primary-800 px-2 py-1 rounded-md hover:bg-primary-50"
                      >
                        {selectedClassIds.length === transferableIds.length
                          ? 'Clear selection'
                          : 'Select all OK'}
                      </button>
                    ) : null}
                  </div>

                  {!toTeacherId ? (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center">
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-gray-500">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                          />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-700">Choose a new teacher first</p>
                      <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
                        We will check each class against their schedule and show conflicts instantly.
                      </p>
                    </div>
                  ) : previewLoading ? (
                    <div className="rounded-xl border border-gray-200 bg-white px-4 py-10 text-center">
                      <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" />
                      <p className="text-sm font-medium text-gray-700">Checking schedule fit…</p>
                      <p className="text-xs text-gray-500 mt-1">Comparing class times and date ranges</p>
                    </div>
                  ) : (
                    <div
                      className="space-y-2.5 max-h-[min(50vh,420px)] overflow-y-auto pr-0.5"
                      style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#cbd5e0 #f7fafc',
                      }}
                    >
                      {(turnoverTeacher.classes || []).map((cls) => {
                        const fit = fitByClassId.get(cls.class_id);
                        const status = fit?.status || 'ok';
                        const isConflict = status === 'conflict';
                        const isAlready = status === 'already_assigned';
                        const canSelect = !isConflict;
                        const selected = selectedClassIds.includes(cls.class_id);
                        return (
                          <div
                            key={cls.class_id}
                            className={`rounded-xl border px-3.5 py-3 transition-shadow ${
                              isConflict
                                ? 'border-red-200 bg-red-50/90'
                                : isAlready
                                  ? 'border-blue-200 bg-blue-50/90'
                                  : selected
                                    ? 'border-green-300 bg-green-50 shadow-sm ring-1 ring-green-200'
                                    : 'border-green-200 bg-green-50/70'
                            }`}
                          >
                            <label
                              className={`flex items-start gap-3 text-sm text-gray-800 ${
                                canSelect ? 'cursor-pointer' : 'cursor-not-allowed'
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-40"
                                disabled={!canSelect}
                                checked={selected}
                                onChange={() => {
                                  if (canSelect) toggleClass(cls.class_id);
                                }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-gray-900">{cls.class_name}</span>
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                      isConflict
                                        ? 'bg-red-100 text-red-800'
                                        : isAlready
                                          ? 'bg-blue-100 text-blue-800'
                                          : 'bg-green-100 text-green-800'
                                    }`}
                                  >
                                    {isConflict ? (
                                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path
                                          fillRule="evenodd"
                                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 10-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                          clipRule="evenodd"
                                        />
                                      </svg>
                                    ) : (
                                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path
                                          fillRule="evenodd"
                                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                          clipRule="evenodd"
                                        />
                                      </svg>
                                    )}
                                    {isConflict
                                      ? 'Conflict'
                                      : isAlready
                                        ? 'Already assigned'
                                        : 'Can transfer'}
                                  </span>
                                </span>
                                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
                                  <span>{formatClassRange(cls)}</span>
                                  {cls.program_name ? <span>{cls.program_name}</span> : null}
                                  {cls.room_name ? <span>{cls.room_name}</span> : null}
                                </span>
                                {isConflict && (fit?.conflicts || []).length > 0 ? (
                                  <div className="mt-2 rounded-lg border border-red-200 bg-white/70 px-2.5 py-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700 mb-1">
                                      Why it conflicts
                                    </p>
                                    <ul className="space-y-1 text-xs text-red-800">
                                      {fit.conflicts.map((c, idx) => (
                                        <li key={`${cls.class_id}-${idx}`} className="flex gap-1.5">
                                          <span className="shrink-0 text-red-500">•</span>
                                          <span>
                                            {c.message || `${c.day || 'Schedule'} conflict`}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                              </span>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                </div>

                {turnoverError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex gap-2">
                    <svg className="w-5 h-5 shrink-0 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{turnoverError}</span>
                  </div>
                ) : null}
              </div>

              {/* Footer */}
              <div className="px-4 sm:px-8 py-4 bg-primary-50/50 border-t border-primary-100 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-xs text-gray-500 text-center sm:text-left">
                  {toTeacherId && !previewLoading
                    ? `${selectedClassIds.filter((id) => transferableIds.includes(id)).length} of ${transferableIds.length} transferable class(es) selected`
                    : 'Conflicts cannot be transferred until the schedule is free'}
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={closeTurnover}
                    disabled={turnoverLoading}
                    className="px-4 py-2.5 text-sm font-semibold rounded-xl border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitTurnover}
                    disabled={
                      turnoverLoading ||
                      previewLoading ||
                      !toTeacherId ||
                      selectedClassIds.filter((id) => transferableIds.includes(id)).length === 0
                    }
                    className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-primary-600 text-white hover:bg-primary-700 shadow-sm disabled:opacity-50 disabled:shadow-none"
                  >
                    {turnoverLoading ? 'Turning over…' : 'Confirm turnover'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {historyTeacher &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 backdrop-blur-sm bg-black/30"
            onClick={closeClassHistory}
            role="presentation"
          >
            <div
              className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-[min(96vw,64rem)] max-h-[92vh] sm:max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="class-history-title"
            >
              <div className="relative bg-gradient-to-r from-primary-500 to-primary-600 px-5 sm:px-8 py-5 text-white">
                <button
                  type="button"
                  onClick={closeClassHistory}
                  className="absolute top-3 right-3 p-1.5 rounded-lg text-white/90 hover:bg-white/15"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <p className="text-xs font-semibold uppercase tracking-wide text-white/80">View only</p>
                <h2 id="class-history-title" className="text-lg sm:text-xl font-bold mt-0.5">
                  Class history
                </h2>
                <p className="text-sm text-white/90 mt-1">
                  {historyTeacher.full_name}
                  {historyTeacher.email ? (
                    <span className="text-white/80"> · {historyTeacher.email}</span>
                  ) : null}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5">
                {historyLoading ? (
                  <div className="py-12 text-center">
                    <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
                    <p className="text-sm text-gray-600">Loading class history…</p>
                  </div>
                ) : historyError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {historyError}
                  </div>
                ) : historyRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
                    No class assignments found for this teacher.
                  </div>
                ) : (
                  <div
                    className="overflow-x-auto rounded-xl border border-gray-200"
                    style={{
                      scrollbarWidth: 'thin',
                      scrollbarColor: '#cbd5e0 #f7fafc',
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
                    <table
                      className="text-sm divide-y divide-gray-200"
                      style={{ width: '100%', minWidth: '900px' }}
                    >
                      <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-3 py-2.5">Class</th>
                          <th className="px-3 py-2.5">Status</th>
                          <th className="px-3 py-2.5">Assigned</th>
                          <th className="px-3 py-2.5">End / turnover</th>
                          <th className="px-3 py-2.5">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {historyRows.map((row) => (
                          <tr key={row.history_id} className="hover:bg-gray-50/80">
                            <td className="px-3 py-3 align-top">
                              <div className="font-medium text-gray-900">{row.class_name || '—'}</div>
                              <div className="text-xs text-gray-500">
                                {[row.program_name, row.room_name, row.branch_label]
                                  .filter(Boolean)
                                  .join(' · ') || '—'}
                              </div>
                              <div className="text-xs text-gray-400 mt-0.5">
                                Class run: {row.class_start_date || '—'} — {row.class_end_date || '—'}
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                  row.is_turnover
                                    ? 'bg-amber-100 text-amber-900'
                                    : row.is_active
                                      ? 'bg-green-100 text-green-800'
                                      : 'bg-gray-100 text-gray-700'
                                }`}
                              >
                                {row.period_label}
                              </span>
                            </td>
                            <td className="px-3 py-3 align-top whitespace-nowrap text-gray-800">
                              <div className="font-medium">{row.period_start || row.assigned_at || '—'}</div>
                              <div className="text-[11px] text-gray-500">Assigned date</div>
                            </td>
                            <td className="px-3 py-3 align-top whitespace-nowrap text-gray-800">
                              {row.is_turnover ? (
                                <>
                                  <div className="font-medium">{row.period_end || row.ended_at || '—'}</div>
                                  <div className="text-[11px] text-gray-500">Turnover date</div>
                                </>
                              ) : (
                                <>
                                  <div className="font-medium">
                                    {row.period_end || row.class_end_date || '—'}
                                  </div>
                                  <div className="text-[11px] text-gray-500">
                                    {row.is_active ? 'Class end date' : 'End date'}
                                  </div>
                                </>
                              )}
                            </td>
                            <td className="px-3 py-3 align-top text-xs text-gray-600">
                              {row.is_turnover && row.turned_over_to_name ? (
                                <span>
                                  Turned over to{' '}
                                  <span className="font-medium text-gray-900">
                                    {row.turned_over_to_name}
                                  </span>
                                </span>
                              ) : row.is_active ? (
                                <span className="text-green-700">Currently assigned</span>
                              ) : (
                                <span>—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="px-4 sm:px-8 py-4 bg-primary-50/50 border-t border-primary-100 flex justify-end">
                <button
                  type="button"
                  onClick={closeClassHistory}
                  className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-primary-600 text-white hover:bg-primary-700 shadow-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default TeachersPage;
