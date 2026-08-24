import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';

/**
 * Program + class multi-select for announcement create/edit.
 * Default: unset (null) — not All. User must pick All or specific ids.
 * API still uses [] for All once chosen.
 *
 * Classes API max limit is 100 — we page until all rows are loaded.
 */
async function fetchAllClasses({ branchId = null } = {}) {
  const pageSize = 100;
  let page = 1;
  const all = [];

  while (page <= 50) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
    });
    if (branchId) params.set('branch_id', String(branchId));
    const res = await apiRequest(`/classes?${params.toString()}`);
    const rows = res.data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    page += 1;
  }

  return all;
}

export default function AnnouncementAudienceFilters({
  programIds = null,
  classIds = null,
  onChange,
  branchId = null,
  compact = false,
  errors = {},
}) {
  const [programs, setPrograms] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [classesError, setClassesError] = useState('');

  const programsUnset = programIds == null;
  const classesUnset = classIds == null;
  const allPrograms = Array.isArray(programIds) && programIds.length === 0;
  const allClasses = Array.isArray(classIds) && classIds.length === 0;
  const selectedProgramIds = Array.isArray(programIds) ? programIds : [];
  const selectedClassIds = Array.isArray(classIds) ? classIds : [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingPrograms(true);
        const res = await apiRequest('/programs?page=1&limit=500');
        if (cancelled) return;
        setPrograms(res.data || []);
      } catch (err) {
        console.error('Failed to load programs for announcement audience:', err);
        if (!cancelled) setPrograms([]);
      } finally {
        if (!cancelled) setLoadingPrograms(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingClasses(true);
        setClassesError('');
        const rows = await fetchAllClasses({ branchId });
        if (cancelled) return;
        setClasses(rows);
      } catch (err) {
        console.error('Failed to load classes for announcement audience:', err);
        if (!cancelled) {
          setClasses([]);
          setClassesError(err.message || 'Failed to load classes');
        }
      } finally {
        if (!cancelled) setLoadingClasses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const visibleClasses = useMemo(() => {
    if (programsUnset || allPrograms) return classes;
    const selected = new Set(selectedProgramIds.map(Number));
    return classes.filter((c) => selected.has(Number(c.program_id)));
  }, [programsUnset, allPrograms, selectedProgramIds, classes]);

  const selectedProgramNames = useMemo(() => {
    if (programsUnset || allPrograms) return [];
    const selected = new Set(selectedProgramIds.map(Number));
    return programs
      .filter((p) => selected.has(Number(p.program_id)))
      .map((p) => p.program_name || p.program_code || `Program ${p.program_id}`);
  }, [programsUnset, allPrograms, selectedProgramIds, programs]);

  const emit = (nextPrograms, nextClasses) => {
    onChange?.({
      program_ids: nextPrograms,
      class_ids: nextClasses,
    });
  };

  const toggleProgram = (programId) => {
    const id = Number(programId);
    if (programsUnset || allPrograms) {
      emit(
        [id],
        classesUnset
          ? null
          : selectedClassIds.filter((cid) =>
              classes.some(
                (c) => Number(c.class_id) === Number(cid) && Number(c.program_id) === id
              )
            )
      );
      return;
    }
    const has = selectedProgramIds.includes(id);
    const nextPrograms = has
      ? selectedProgramIds.filter((p) => Number(p) !== id)
      : [...selectedProgramIds, id];
    if (nextPrograms.length === 0) {
      emit(null, classesUnset ? null : classIds);
      return;
    }
    const nextClasses = classesUnset
      ? null
      : selectedClassIds.filter((cid) => {
          const cls = classes.find((c) => Number(c.class_id) === Number(cid));
          if (!cls) return false;
          return nextPrograms.includes(Number(cls.program_id));
        });
    emit(nextPrograms, nextClasses);
  };

  const setAllPrograms = (checked) => {
    if (checked) {
      emit([], classesUnset ? null : classIds);
    } else {
      emit(null, classesUnset ? null : classIds);
    }
  };

  const toggleClass = (classId) => {
    const id = Number(classId);
    if (classesUnset || allClasses) {
      emit(programsUnset ? null : programIds, [id]);
      return;
    }
    const has = selectedClassIds.includes(id);
    const next = has
      ? selectedClassIds.filter((c) => Number(c) !== id)
      : [...selectedClassIds, id];
    emit(programsUnset ? null : programIds, next.length === 0 ? null : next);
  };

  const setAllClasses = (checked) => {
    if (checked) {
      emit(programsUnset ? null : programIds, []);
    } else {
      emit(programsUnset ? null : programIds, null);
    }
  };

  const labelCls = compact
    ? 'mb-1 block text-sm font-medium text-gray-700'
    : 'label-field';
  const boxCls =
    'max-h-40 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2.5 space-y-1 shadow-sm';

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>
          Programs <span className="text-red-500">*</span>
        </label>
        <div className={`${boxCls} ${errors.program_ids ? 'border-red-500' : ''}`}>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={allPrograms}
              onChange={(e) => setAllPrograms(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            All programs
          </label>
          {loadingPrograms ? (
            <p className="pl-6 text-xs text-gray-500">Loading programs…</p>
          ) : (
            programs.map((p) => (
              <label
                key={p.program_id}
                className="flex items-center gap-2 pl-1 text-sm text-gray-800"
              >
                <input
                  type="checkbox"
                  checked={
                    !programsUnset &&
                    !allPrograms &&
                    selectedProgramIds.includes(Number(p.program_id))
                  }
                  onChange={() => toggleProgram(p.program_id)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="truncate">
                  {p.program_name || p.program_code || `Program ${p.program_id}`}
                  {p.program_code ? (
                    <span className="text-gray-400"> ({p.program_code})</span>
                  ) : null}
                </span>
              </label>
            ))
          )}
        </div>
        {errors.program_ids && (
          <p className="mt-1 text-sm text-red-600">{errors.program_ids}</p>
        )}
      </div>

      <div>
        <label className={labelCls}>
          Classes <span className="text-red-500">*</span>
        </label>
        <div className={`${boxCls} ${errors.class_ids ? 'border-red-500' : ''}`}>
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={allClasses}
              onChange={(e) => setAllClasses(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            All classes
            {!programsUnset && !allPrograms ? ' in selected programs' : ''}
          </label>
          {loadingClasses ? (
            <p className="pl-6 text-xs text-gray-500">Loading classes…</p>
          ) : classesError ? (
            <p className="pl-6 text-xs text-red-600">{classesError}</p>
          ) : visibleClasses.length === 0 ? (
            <div className="space-y-1 pl-6 text-xs text-gray-500">
              <p>No classes available for the selected program(s).</p>
              {selectedProgramNames.length > 0 && (
                <p>
                  Selected: {selectedProgramNames.join(', ')}. Classes are matched by{' '}
                  <span className="font-medium text-gray-700">program</span>, not level tag
                  (e.g. Pre-Kindergarten on the Classes page is often a level under another
                  program such as Test Program).
                </p>
              )}
            </div>
          ) : (
            visibleClasses.map((c) => (
              <label
                key={c.class_id}
                className="flex items-center gap-2 pl-1 text-sm text-gray-800"
              >
                <input
                  type="checkbox"
                  checked={
                    !classesUnset &&
                    !allClasses &&
                    selectedClassIds.includes(Number(c.class_id))
                  }
                  onChange={() => toggleClass(c.class_id)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="min-w-0 truncate" title={`${c.class_name || ''} ${c.program_code || ''} ${c.level_tag || ''}`}>
                  {c.class_name || `Class ${c.class_id}`}
                  {c.program_code ? ` [${c.program_code}]` : ''}
                  {c.level_tag ? ` (${c.level_tag})` : ''}
                </span>
              </label>
            ))
          )}
        </div>
        {errors.class_ids && (
          <p className="mt-1 text-sm text-red-600">{errors.class_ids}</p>
        )}
        <p className="mt-1 text-xs text-gray-500">
          Applies to Students, Guardians, and Teachers. Only actively enrolled students
          (new / re-enrolled / upsell / rejoin) and their guardians receive email and board
          visibility. Not selected by default — choose All or specific items.
        </p>
      </div>
    </div>
  );
}
