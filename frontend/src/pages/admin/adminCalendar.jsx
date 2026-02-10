import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const getMonthRange = (monthValue) => {
  if (!monthValue) {
    const today = new Date();
    const fallback = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    return getMonthRange(fallback);
  }
  const [yearStr, monthStr] = monthValue.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`,
    year,
    monthIndex: month - 1,
    daysInMonth,
  };
};

const getWeekRange = (weekStartDate) => {
  const start = new Date(weekStartDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  
  return {
    start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
    end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
    startDate: start,
    endDate: end,
  };
};

const formatTime = (time) => {
  if (!time) return 'TBD';
  const [hourStr, minuteStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const minutes = minuteStr ?? '00';
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes.padStart(2, '0')} ${period}`;
};

const AdminCalendar = () => {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  
  // Get start of current week (Sunday)
  const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  };
  const defaultWeekStart = getStartOfWeek(today);

  const { userInfo } = useAuth();
  const [viewMode, setViewMode] = useState('month'); // 'month' or 'week'
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [selectedWeekStart, setSelectedWeekStart] = useState(defaultWeekStart);
  const [teacherFilter, setTeacherFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [events, setEvents] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ teachers: [], rooms: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [classDetails, setClassDetails] = useState(null);
  const [loadingClassDetails, setLoadingClassDetails] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const navigate = useNavigate();

  const monthMeta = useMemo(() => getMonthRange(selectedMonth), [selectedMonth]);
  const weekMeta = useMemo(() => getWeekRange(selectedWeekStart), [selectedWeekStart]);

  useEffect(() => {
    fetchSchedules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedMonth, selectedWeekStart, teacherFilter, roomFilter]);

  useEffect(() => {
    const dateRange = viewMode === 'week' ? weekMeta : monthMeta;
    const loadHolidays = async () => {
      try {
        const res = await apiRequest(`/holidays?start_date=${dateRange.start}&end_date=${dateRange.end}`);
        setHolidays(res.data || []);
      } catch {
        setHolidays([]);
      }
    };
    loadHolidays();
  }, [viewMode, monthMeta.start, monthMeta.end, weekMeta.start, weekMeta.end]);

  const fetchSchedules = async () => {
    setLoading(true);
    setError('');
    try {
      const dateRange = viewMode === 'week' ? weekMeta : monthMeta;
      const params = new URLSearchParams({
        start_date: dateRange.start,
        end_date: dateRange.end,
      });
      // Admin's branch is automatically filtered by backend based on user's branch_id
      if (teacherFilter && teacherFilter !== '') params.append('teacher_id', teacherFilter);
      if (roomFilter && roomFilter !== '') params.append('room_id', roomFilter);

      const response = await apiRequest(`/calendar/schedules?${params.toString()}`);
      setEvents(response.data || []);
      setFilterOptions({
        teachers: response.filters?.teachers || [],
        rooms: response.filters?.rooms || [],
      });
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Unable to load schedules right now.');
    } finally {
      setLoading(false);
    }
  };

  const fetchClassDetails = async (classId) => {
    setLoadingClassDetails(true);
    try {
      const response = await apiRequest(`/classes/${classId}`);
      setClassDetails(response.data);
    } catch (err) {
      console.error('Error fetching class details:', err);
      setClassDetails(null);
    } finally {
      setLoadingClassDetails(false);
    }
  };

  const handleEventClick = async (event) => {
    setSelectedEvent(event);
    setIsModalOpen(true);
    await fetchClassDetails(event.class_id);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedEvent(null);
    setClassDetails(null);
  };

  const handleGoToClassPage = () => {
    // Admin doesn't have access to classes page, so we'll just close the modal
    // or navigate to dashboard
    closeModal();
    navigate('/admin');
  };

  const eventsByDate = useMemo(() => {
    return events.reduce((acc, event) => {
      if (!acc[event.date]) {
        acc[event.date] = [];
      }
      acc[event.date].push(event);
      return acc;
    }, {});
  }, [events]);

  const holidaysByDate = useMemo(() => {
    const map = {};
    holidays.forEach((h) => {
      if (!map[h.date]) map[h.date] = [];
      map[h.date].push(h);
    });
    return map;
  }, [holidays]);

  const calendarCells = useMemo(() => {
    if (viewMode === 'week') {
      const cells = [];
      const weekStart = new Date(weekMeta.startDate);
      for (let i = 0; i < 7; i += 1) {
        const currentDate = new Date(weekStart);
        currentDate.setDate(weekStart.getDate() + i);
        const dateKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
        cells.push({
          type: 'current',
          key: `day-${dateKey}`,
          dayNumber: currentDate.getDate(),
          dateKey,
          dayName: FULL_DAY_LABELS[i],
          events: eventsByDate[dateKey] || [],
        });
      }
      return cells;
    }

    // Month view
    const cells = [];
    const firstOfMonth = new Date(`${monthMeta.start}T00:00:00`);
    const firstDayIndex = firstOfMonth.getDay();

    for (let i = 0; i < firstDayIndex; i += 1) {
      cells.push({ type: 'placeholder', key: `prev-${i}` });
    }

    for (let day = 1; day <= monthMeta.daysInMonth; day += 1) {
      const currentDate = new Date(monthMeta.year, monthMeta.monthIndex, day);
      const dateKey = `${monthMeta.year}-${String(monthMeta.monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push({
        type: 'current',
        key: `day-${dateKey}`,
        dayNumber: day,
        dateKey,
        events: eventsByDate[dateKey] || [],
      });
    }

    while (cells.length % 7 !== 0) {
      cells.push({ type: 'placeholder', key: `next-${cells.length}` });
    }

    return cells;
  }, [viewMode, monthMeta, weekMeta, eventsByDate]);

  const navigateWeek = (direction) => {
    const newDate = new Date(selectedWeekStart);
    newDate.setDate(newDate.getDate() + (direction * 7));
    setSelectedWeekStart(newDate);
  };

  const goToToday = () => {
    if (viewMode === 'week') {
      setSelectedWeekStart(getStartOfWeek(today));
    } else {
      setSelectedMonth(defaultMonth);
    }
  };

  // Get branch name from user info or events
  const branchName = userInfo?.branch_name || events[0]?.branch_name || 'Your Branch';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendar Schedule</h1>
          <p className="text-sm text-gray-600">
            View class schedules for {branchName}. Filter by teacher or room.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white p-1">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                viewMode === 'month'
                  ? 'bg-[#F7C844] text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Month
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                viewMode === 'week'
                  ? 'bg-[#F7C844] text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Week
            </button>
          </div>
          {viewMode === 'week' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigateWeek(-1)}
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 shadow-sm transition hover:bg-gray-50"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={goToToday}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => navigateWeek(1)}
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white p-2 text-gray-700 shadow-sm transition hover:bg-gray-50"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <span className="px-3 py-1.5 text-sm font-medium text-gray-700">
                {weekMeta.startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekMeta.endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={fetchSchedules}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 014 9m0 0h5m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        {viewMode === 'month' && (
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Month</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]"
            />
          </div>
        )}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Room</label>
          <select
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]"
          >
            <option value="">All Rooms</option>
            {filterOptions.rooms
              .sort((a, b) => (a.room_name || '').localeCompare(b.room_name || ''))
              .map((room) => (
                <option key={room.room_id ?? 'unassigned'} value={room.room_id ?? ''}>
                  {room.room_name || 'Unassigned'}
                </option>
              ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Teacher</label>
          <select
            value={teacherFilter}
            onChange={(e) => setTeacherFilter(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]"
          >
            <option value="">All Teachers</option>
            {filterOptions.teachers
              .sort((a, b) => a.teacher_name.localeCompare(b.teacher_name))
              .map((teacher) => (
                <option key={teacher.teacher_id} value={teacher.teacher_id}>
                  {teacher.teacher_name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {lastUpdated && (
        <p className="text-xs text-gray-500">
          Last updated: {lastUpdated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        {viewMode === 'week' ? (
          <div className="grid grid-cols-7 gap-3 border-b border-gray-100 pb-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
            {FULL_DAY_LABELS.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-3 border-b border-gray-100 pb-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">
            {DAY_LABELS.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[200px] items-center justify-center">
            <div className="text-sm font-medium text-gray-500">Loading calendar...</div>
          </div>
        ) : (
          <div className={`mt-4 grid grid-cols-7 gap-3 text-sm max-lg:text-xs ${viewMode === 'week' ? 'min-h-[500px]' : ''}`}>
            {calendarCells.map((cell) => {
              if (cell.type === 'placeholder') {
                return <div key={cell.key} className="h-28 rounded-xl border border-dashed border-gray-200 bg-gray-50" />;
              }
              return (
                <div
                  key={cell.key}
                  className={`flex flex-col rounded-xl border border-gray-200 bg-white p-2 shadow-sm ${
                    viewMode === 'week' ? 'min-h-[500px]' : 'h-32'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-gray-700">
                    {viewMode === 'week' ? (
                      <span>{cell.dayName} {cell.dayNumber}</span>
                    ) : (
                      <span>Day {cell.dayNumber}</span>
                    )}
                    <span className="text-[10px] text-gray-400">
                      {((holidaysByDate[cell.dateKey] || []).length > 0 ? 0 : (cell.events || []).length)} {((holidaysByDate[cell.dateKey] || []).length > 0 ? 0 : (cell.events || []).length) === 1 ? 'class' : 'classes'}
                    </span>
                  </div>
                  <div className={`flex-1 space-y-2 overflow-y-auto rounded-lg bg-gray-50/60 p-1 ${viewMode === 'week' ? 'min-h-[450px]' : ''}`}>
                    {((holidaysByDate[cell.dateKey]) || []).map((h) => (
                      <span key={h.source === 'custom' ? h.holiday_id : `${h.date}-${h.name}`} className={`block truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${h.source === 'national' ? 'bg-[#0f766e]' : 'bg-[#1d4ed8]'}`} title={h.name}>{h.name}</span>
                    ))}
                    {(holidaysByDate[cell.dateKey] || []).length > 0 ? null : (cell.events || []).length === 0 ? (
                      <p className="text-[11px] text-gray-400">No classes</p>
                    ) : (
                      cell.events.map((event) => (
                        <div
                          key={event.event_id}
                          onClick={() => handleEventClick(event)}
                          className="rounded-lg border border-yellow-100 bg-yellow-50/60 p-1.5 text-[11px] leading-snug text-gray-700 cursor-pointer hover:bg-yellow-100 hover:border-yellow-200 transition-colors"
                        >
                          <p className="font-semibold text-gray-900 break-words">{event.class_code || 'N/A'}</p>
                          {event.room_name && (
                            <p className="text-[10px] text-gray-500">{event.room_name}</p>
                          )}
                          {event.teachers.length > 0 && (
                            <p className="text-[10px] text-gray-600">
                              {event.teachers.map((teacher) => teacher.teacher_name).join(', ')}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && events.length === 0 && !error && (
          <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
            No schedules found for this {viewMode === 'week' ? 'week' : 'month'}. Try adjusting your filters.
          </div>
        )}
      </div>

      {/* Class Details Modal */}
      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={closeModal}>
          <div
            className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold text-gray-900">Class Details</h2>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              {loadingClassDetails ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-sm text-gray-500">Loading class details...</div>
                </div>
              ) : selectedEvent && classDetails ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Class Name</label>
                      <p className="mt-1 text-sm text-gray-900">{classDetails.class_name || classDetails.level_tag || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Program</label>
                      <p className="mt-1 text-sm text-gray-900">{classDetails.program_name || selectedEvent?.program_name || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Level Tag</label>
                      <p className="mt-1 text-sm text-gray-900">{classDetails.level_tag || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Phase</label>
                      <p className="mt-1 text-sm text-gray-900">{classDetails.class_phase_number ? `Phase ${classDetails.class_phase_number}` : 'Phase 1'}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Branch</label>
                      <p className="mt-1 text-sm text-gray-900">{classDetails.branch_name || selectedEvent?.branch_name || branchName}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Room</label>
                      <p className="mt-1 text-sm text-gray-900">{classDetails.room_name || selectedEvent?.room_name || 'Unassigned'}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Date</label>
                      <p className="mt-1 text-sm text-gray-900">
                        {new Date(selectedEvent.date).toLocaleDateString('en-US', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Time</label>
                      <p className="mt-1 text-sm text-gray-900">
                        {formatTime(selectedEvent.start_time)}
                        {selectedEvent.end_time ? ` - ${formatTime(selectedEvent.end_time)}` : ''}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Teachers</label>
                      <p className="mt-1 text-sm text-gray-900">
                        {selectedEvent.teachers.length > 0
                          ? selectedEvent.teachers.map((t) => t.teacher_name).join(', ')
                          : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Enrolled Students</label>
                      <p className="mt-1 text-sm text-gray-900">{classDetails.enrolled_students !== undefined ? classDetails.enrolled_students : 0}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Max Students</label>
                      <p className="mt-1 text-sm text-gray-900">{classDetails.max_students || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</label>
                      <p className="mt-1">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          classDetails.status === 'Active' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {classDetails.status || 'N/A'}
                        </span>
                      </p>
                    </div>
                  </div>
                  {classDetails.days_of_week && classDetails.days_of_week.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Schedule</label>
                      <div className="mt-2 space-y-2">
                        {classDetails.days_of_week.map((schedule, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 p-2 rounded">
                            <span className="font-medium">{schedule.day_of_week}:</span>
                            <span>
                              {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-gray-500">
                  Unable to load class details.
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
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

export default AdminCalendar;

