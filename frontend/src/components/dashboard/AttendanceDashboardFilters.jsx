const selectClassName =
  'w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/40';

const FilterField = ({ label, children }) => (
  <label className="flex min-w-0 flex-1 flex-col gap-1 sm:min-w-[160px] sm:max-w-[240px]">
    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
    {children}
  </label>
);

const AttendanceDashboardFilters = ({
  programId,
  classId,
  teacherId,
  onProgramChange,
  onClassChange,
  onTeacherChange,
  programs = [],
  classes = [],
  teachers = [],
  loading = false,
  showTeacherFilter = true,
  onClear,
}) => (
  <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
        <p className="text-xs text-gray-500">Narrow sessions by program, class, or teacher for the selected branch.</p>
      </div>
      {(programId || classId || teacherId) && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex shrink-0 self-start rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-600 ring-1 ring-inset ring-gray-300 transition hover:bg-gray-50"
        >
          Clear filters
        </button>
      ) : null}
    </div>
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <FilterField label="Program">
        <select
          value={programId}
          onChange={(e) => onProgramChange(e.target.value)}
          disabled={loading}
          className={selectClassName}
        >
          <option value="">All programs</option>
          {programs.map((program) => (
            <option key={program.program_id} value={String(program.program_id)}>
              {program.program_name || `Program ${program.program_id}`}
            </option>
          ))}
        </select>
      </FilterField>
      <FilterField label="Class">
        <select
          value={classId}
          onChange={(e) => onClassChange(e.target.value)}
          disabled={loading}
          className={selectClassName}
        >
          <option value="">All classes</option>
          {classes.map((classItem) => (
            <option key={classItem.class_id} value={String(classItem.class_id)}>
              {classItem.class_name || `Class ${classItem.class_id}`}
            </option>
          ))}
        </select>
      </FilterField>
      {showTeacherFilter ? (
        <FilterField label="Teacher">
          <select
            value={teacherId}
            onChange={(e) => onTeacherChange(e.target.value)}
            disabled={loading}
            className={selectClassName}
          >
            <option value="">All teachers</option>
            {teachers.map((teacher) => (
              <option key={teacher.user_id} value={String(teacher.user_id)}>
                {teacher.full_name || `Teacher ${teacher.user_id}`}
              </option>
            ))}
          </select>
        </FilterField>
      ) : null}
    </div>
  </div>
);

export default AttendanceDashboardFilters;
