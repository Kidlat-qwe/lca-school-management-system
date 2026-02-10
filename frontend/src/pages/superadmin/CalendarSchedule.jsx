import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../config/api';

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const HOURS = Array.from({ length: 23 }, (_, i) => i + 1);

const formatHour = (h) => {
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
};

const toYmd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

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
    monthName: new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
  };
};

const getWeekRange = (dateYmd) => {
  const d = new Date(dateYmd + 'T12:00:00');
  const day = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: toYmd(start),
    end: toYmd(end),
    startDate: start,
    endDate: end,
    label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
  };
};

const getDayLabel = (dateYmd) => {
  const d = new Date(dateYmd + 'T12:00:00');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${dayNames[d.getDay()].toUpperCase()} ${d.getDate()}`;
};

const getDayLongLabel = (dateYmd) => {
  const d = new Date(dateYmd + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const formatTime = (time) => {
  if (!time) return 'TBD';
  const parts = String(time).split(':');
  const hour = parseInt(parts[0], 10);
  const minutes = parts[1] ?? '00';
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes.padStart(2, '0')} ${period}`;
};

const startTimeToHour = (startTime) => {
  if (!startTime) return 0;
  const parts = String(startTime).split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) || 0;
  return h + m / 60;
};

const CalendarSchedule = () => {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const todayYmd = toYmd(today);

  const [viewMode, setViewMode] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [selectedDate, setSelectedDate] = useState(todayYmd);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [teacherFilter, setTeacherFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [roomFilter, setRoomFilter] = useState('');
  const [events, setEvents] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ teachers: [], branches: [], rooms: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [classDetails, setClassDetails] = useState(null);
  const [loadingClassDetails, setLoadingClassDetails] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const navigate = useNavigate();

  const monthMeta = useMemo(() => getMonthRange(selectedMonth), [selectedMonth]);
  const weekMeta = useMemo(() => getWeekRange(selectedDate), [selectedDate]);

  const fetchRange = useMemo(() => {
    if (viewMode === 'month') return { start: monthMeta.start, end: monthMeta.end };
    if (viewMode === 'week') return { start: weekMeta.start, end: weekMeta.end };
    return { start: selectedDate, end: selectedDate };
  }, [viewMode, monthMeta.start, monthMeta.end, weekMeta.start, weekMeta.end, selectedDate]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchRange.start, fetchRange.end, teacherFilter, branchFilter, roomFilter]);

  useEffect(() => {
    const loadHolidays = async () => {
      try {
        const res = await apiRequest(`/holidays?start_date=${fetchRange.start}&end_date=${fetchRange.end}`);
        setHolidays(res.data || []);
      } catch {
        setHolidays([]);
      }
    };
    loadHolidays();
  }, [fetchRange.start, fetchRange.end]);

  useEffect(() => {
    if (!branchFilter) {
      setRoomFilter('');
      setTeacherFilter('');
    }
  }, [branchFilter]);

  const fetchSchedules = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        start_date: fetchRange.start,
        end_date: fetchRange.end,
      });
      if (branchFilter) params.append('branch_id', branchFilter);
      if (teacherFilter) params.append('teacher_id', teacherFilter);
      if (roomFilter) params.append('room_id', roomFilter);
      const response = await apiRequest(`/calendar/schedules?${params.toString()}`);
      setEvents(response.data || []);
      setFilterOptions({
        teachers: response.filters?.teachers || [],
        branches: response.filters?.branches || [],
        rooms: response.filters?.rooms || [],
      });
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Unable to load schedules.');
      setEvents([]);
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
    const classId = classDetails?.class_id || selectedEvent?.class_id;
    if (classId) navigate(`/superadmin/classes?classId=${classId}`);
    else navigate('/superadmin/classes');
  };

  const eventsByDate = useMemo(() => {
    const map = {};
    events.forEach((ev) => {
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    });
    return map;
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
    const cells = [];
    const firstOfMonth = new Date(monthMeta.year, monthMeta.monthIndex, 1);
    const firstDayIndex = firstOfMonth.getDay();
    for (let i = 0; i < firstDayIndex; i++) cells.push({ type: 'placeholder', key: `prev-${i}` });
    for (let day = 1; day <= monthMeta.daysInMonth; day++) {
      const dateKey = `${monthMeta.year}-${String(monthMeta.monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push({ type: 'day', key: `day-${dateKey}`, dayNumber: day, dateKey, events: eventsByDate[dateKey] || [] });
    }
    while (cells.length % 7 !== 0) cells.push({ type: 'placeholder', key: `next-${cells.length}` });
    return cells;
  }, [monthMeta, eventsByDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekMeta.startDate);
      d.setDate(weekMeta.startDate.getDate() + i);
      const dateKey = toYmd(d);
      return { dateKey, dayNumber: d.getDate(), dayLabel: DAY_LABELS[i], events: eventsByDate[dateKey] || [] };
    });
  }, [weekMeta.startDate, eventsByDate]);

  const eventsForDayByHour = useMemo(() => {
    const byHour = {};
    HOURS.forEach((h) => { byHour[h] = []; });
    const dayHasHoliday = holidays.some((h) => h.date === selectedDate);
    if (dayHasHoliday) return byHour;
    const dayEvents = events.filter((e) => e.date === selectedDate);
    dayEvents.forEach((ev) => {
      const hour = Math.floor(startTimeToHour(ev.start_time));
      if (hour >= 1 && hour <= 23) {
        if (!byHour[hour]) byHour[hour] = [];
        byHour[hour].push(ev);
      }
    });
    return byHour;
  }, [events, selectedDate, holidays]);

  const currentTime = useMemo(() => {
    if (selectedDate !== todayYmd) return null;
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }, [selectedDate, todayYmd]);

  const goToToday = () => {
    setSelectedMonth(defaultMonth);
    setSelectedDate(todayYmd);
  };

  const prev = () => {
    if (viewMode === 'month') {
      const [y, m] = selectedMonth.split('-').map(Number);
      setSelectedMonth(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
    } else if (viewMode === 'week') {
      const d = new Date(selectedDate + 'T12:00:00');
      d.setDate(d.getDate() - 7);
      setSelectedDate(toYmd(d));
    } else {
      const d = new Date(selectedDate + 'T12:00:00');
      d.setDate(d.getDate() - 1);
      setSelectedDate(toYmd(d));
    }
  };

  const next = () => {
    if (viewMode === 'month') {
      const [y, m] = selectedMonth.split('-').map(Number);
      setSelectedMonth(m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`);
    } else if (viewMode === 'week') {
      const d = new Date(selectedDate + 'T12:00:00');
      d.setDate(d.getDate() + 7);
      setSelectedDate(toYmd(d));
    } else {
      const d = new Date(selectedDate + 'T12:00:00');
      d.setDate(d.getDate() + 1);
      setSelectedDate(toYmd(d));
    }
  };

  const headerTitle = viewMode === 'month' ? monthMeta.monthName : viewMode === 'week' ? weekMeta.label : getDayLongLabel(selectedDate);

  const syncMonthFromSelectedDate = () => {
    const [y, m] = selectedDate.split('-');
    setSelectedMonth(`${y}-${m}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendar Schedule</h1>
          <p className="text-sm text-gray-600">
            Track which teachers have classes scheduled and filter by teacher, branch, or room.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={goToToday} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50">
            Today
          </button>
          <div className="flex items-center rounded-lg border border-gray-300 bg-white shadow-sm">
            <button type="button" onClick={prev} className="p-2 text-gray-600 hover:bg-gray-50 rounded-l-lg" aria-label="Previous">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="min-w-[140px] px-4 py-2 text-center text-sm font-semibold text-gray-900 sm:min-w-[180px]">{headerTitle}</span>
            <button type="button" onClick={next} className="p-2 text-gray-600 hover:bg-gray-50 rounded-r-lg" aria-label="Next">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
          <div className="relative">
            <button type="button" onClick={() => setViewDropdownOpen((o) => !o)} className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 min-w-[100px] justify-center">
              <span>{viewMode === 'month' ? 'Month' : viewMode === 'week' ? 'Week' : 'Day'}</span>
              <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {viewDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setViewDropdownOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-full z-20 mt-1 w-[100px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <button type="button" onClick={() => { setViewMode('month'); syncMonthFromSelectedDate(); setViewDropdownOpen(false); }} className={`block w-full px-4 py-2 text-left text-sm ${viewMode === 'month' ? 'bg-[#F7C844] font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>Month</button>
                  <button type="button" onClick={() => { if (viewMode === 'month') setSelectedDate(monthMeta.start); setViewMode('week'); setViewDropdownOpen(false); }} className={`block w-full px-4 py-2 text-left text-sm ${viewMode === 'week' ? 'bg-[#F7C844] font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>Week</button>
                  <button type="button" onClick={() => { if (viewMode === 'month') setSelectedDate(monthMeta.start); setViewMode('day'); setViewDropdownOpen(false); }} className={`block w-full px-4 py-2 text-left text-sm ${viewMode === 'day' ? 'bg-[#F7C844] font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>Day</button>
                </div>
              </>
            )}
          </div>
          <button type="button" onClick={fetchSchedules} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 014 9m0 0h5m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H16" /></svg>
            Refresh
          </button>
        </div>
      </div>

      <div className={`grid gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm ${branchFilter ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2'}`}>
        {viewMode === 'month' && (
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Month</label>
            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]" />
          </div>
        )}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Branch</label>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]">
            <option value="">All Branches</option>
            {filterOptions.branches.sort((a, b) => (a.branch_name || '').localeCompare(b.branch_name || '')).map((b) => (
              <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
            ))}
          </select>
        </div>
        {branchFilter && (
          <>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Room</label>
              <select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]">
                <option value="">All Rooms</option>
                {filterOptions.rooms.sort((a, b) => (a.room_name || '').localeCompare(b.room_name || '')).map((r) => (
                  <option key={r.room_id ?? 'unassigned'} value={r.room_id ?? ''}>{r.room_name || 'Unassigned'}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Teacher</label>
              <select value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]">
                <option value="">All Teachers</option>
                {filterOptions.teachers.sort((a, b) => (a.teacher_name || '').localeCompare(b.teacher_name || '')).map((t) => (
                  <option key={t.teacher_id} value={t.teacher_id}>{t.teacher_name}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {lastUpdated && <p className="text-xs text-gray-500">Last updated: {lastUpdated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: '280px' }}>
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center py-12"><p className="text-sm text-gray-500">Loading calendar...</p></div>
          ) : viewMode === 'month' ? (
            <>
              <div className="grid grid-cols-7 gap-px border-b border-gray-200 bg-gray-100 text-center text-xs font-semibold uppercase tracking-wide text-gray-600">
                {DAY_LABELS.map((day) => <div key={day} className="bg-white py-2">{day}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-px bg-gray-200">
                {calendarCells.map((cell) => {
                  if (cell.type === 'placeholder') return <div key={cell.key} className="min-h-[100px] bg-gray-50 sm:min-h-[120px]" />;
                  const isToday = cell.dateKey === todayYmd;
                  return (
                    <div key={cell.key} className="min-h-[100px] flex flex-col bg-white p-1 sm:min-h-[120px]">
                      <span className={`text-sm font-medium self-start ${isToday ? 'flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white' : 'text-gray-700'}`}>{cell.dayNumber}</span>
                      <div className="mt-1 flex flex-1 flex-col gap-1 overflow-y-auto">
                        {((holidaysByDate[cell.dateKey]) || []).map((h) => (
                          <span key={h.source === 'custom' ? h.holiday_id : `${h.date}-${h.name}`} className={`truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${h.source === 'national' ? 'bg-[#0f766e]' : 'bg-[#1d4ed8]'}`} title={h.name}>{h.name}</span>
                        ))}
                        {((holidaysByDate[cell.dateKey] || []).length > 0 ? [] : (cell.events || [])).map((ev) => (
                          <div key={ev.event_id} onClick={() => handleEventClick(ev)} className="rounded border border-yellow-100 bg-yellow-50/80 px-1.5 py-1 text-[11px] leading-snug text-gray-700 cursor-pointer hover:bg-yellow-100">
                            <p className="font-semibold text-gray-900 truncate">{ev.class_code || ev.program_code || ev.title || 'N/A'}</p>
                            {ev.room_name && <p className="text-[10px] text-gray-500">{ev.room_name}</p>}
                            {ev.teachers?.length > 0 && <p className="text-[10px] text-gray-600 truncate">{ev.teachers.map((t) => t.teacher_name).join(', ')}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : viewMode === 'week' ? (
            <>
              <div className="grid grid-cols-8 border-b border-gray-200 text-xs">
                <div className="py-2 pr-2 text-gray-500 font-medium" />
                {weekDays.map((wd) => {
                  const isToday = wd.dateKey === todayYmd;
                  return (
                    <div key={wd.dateKey} className="py-2 text-center border-l border-gray-100">
                      <div className="font-semibold uppercase tracking-wide text-gray-600">{wd.dayLabel}</div>
                      <span className={`mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${isToday ? 'bg-blue-600 text-white' : 'text-gray-700'}`}>{wd.dayNumber}</span>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-8 border-b border-gray-200 min-h-[40px]">
                <div className="py-1.5 pr-2 text-xs font-medium text-gray-500 border-r border-gray-100">All day</div>
                {weekDays.map((wd) => (
                  <div key={wd.dateKey} className="py-1 px-1 border-l border-gray-100 flex flex-wrap gap-1 content-start">
                    {((holidaysByDate[wd.dateKey]) || []).map((h) => (
                      <span key={h.source === 'custom' ? h.holiday_id : `${h.date}-${h.name}`} className={`rounded px-1.5 py-0.5 text-[10px] font-medium text-white truncate max-w-full ${h.source === 'national' ? 'bg-[#0f766e]' : 'bg-[#1d4ed8]'}`} title={h.name}>{h.name}</span>
                    ))}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-8 flex-1">
                <div className="border-r border-gray-100 py-1 pr-2 text-xs text-gray-500">
                  <span className="block">GMT+8</span>
                  {HOURS.map((h) => <div key={h} className="h-12 leading-12">{formatHour(h)}</div>)}
                </div>
                {weekDays.map((wd) => (
                  <div key={wd.dateKey} className="border-l border-gray-100 relative">
                    {HOURS.map((h) => {
                      const isHoliday = (holidaysByDate[wd.dateKey] || []).length > 0;
                      const hourEvents = isHoliday ? [] : (wd.events || []).filter((e) => Math.floor(startTimeToHour(e.start_time)) === h);
                      return (
                        <div key={h} className="h-12 border-b border-gray-50 relative">
                          {hourEvents.slice(0, 2).map((ev) => (
                            <div key={ev.event_id} onClick={() => handleEventClick(ev)} className="absolute inset-x-0.5 top-0.5 bottom-0 rounded bg-amber-100 border border-amber-200 text-[10px] p-1 overflow-hidden cursor-pointer hover:bg-amber-200">
                              <span className="font-semibold truncate block">{ev.class_code || ev.program_code || ev.title}</span>
                              <span className="text-gray-600">{formatTime(ev.start_time)}</span>
                            </div>
                          ))}
                          {hourEvents.length > 2 && <span className="absolute bottom-0 right-1 text-[9px] text-gray-400">+{hourEvents.length - 2}</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-4 border-b border-gray-200 pb-4">
                <div className="flex flex-col">
                  <span className={`inline-flex h-10 w-14 items-center justify-center rounded-full text-sm font-bold ${selectedDate === todayYmd ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'}`}>{getDayLabel(selectedDate)}</span>
                  <span className="mt-1 text-xs text-gray-500">GMT+8</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-500 mb-2">All day</div>
                  <div className="flex flex-wrap gap-2">
                    {((holidaysByDate[selectedDate]) || []).map((h) => (
                      <span key={h.source === 'custom' ? h.holiday_id : `${h.date}-${h.name}`} className={`rounded px-2 py-1 text-xs font-medium text-white ${h.source === 'national' ? 'bg-[#0f766e]' : 'bg-[#1d4ed8]'}`}>{h.name}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="relative mt-4 flex gap-4">
                <div className="w-14 flex-shrink-0 text-xs text-gray-500 pt-1">
                  {HOURS.map((h) => <div key={h} className="h-12 leading-12">{formatHour(h)}</div>)}
                </div>
                <div className="flex-1 relative border-l border-gray-200" style={{ minHeight: `${HOURS.length * 48}px` }}>
                  {HOURS.map((h) => {
                    const hourEvents = eventsForDayByHour[h] || [];
                    return (
                      <div key={h} className="h-12 border-b border-gray-100 relative">
                        {hourEvents.map((ev) => (
                          <div key={ev.event_id} onClick={() => handleEventClick(ev)} className="absolute left-1 right-1 top-1 bottom-1 rounded bg-amber-100 border border-amber-200 p-2 text-xs cursor-pointer hover:bg-amber-200">
                            <p className="font-semibold text-gray-900">{ev.class_code || ev.program_code || ev.title}</p>
                            <p className="text-gray-600">{formatTime(ev.start_time)} – {formatTime(ev.end_time)}</p>
                            {ev.room_name && <p className="text-gray-500">{ev.room_name}</p>}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {selectedDate === todayYmd && currentTime != null && currentTime >= 1 && currentTime < 24 && (
                    <div className="absolute left-0 right-0 flex items-center pointer-events-none z-10" style={{ top: `${((currentTime - 1) / 23) * 100}%` }}>
                      <span className="h-0.5 w-3 bg-red-500 rounded-r flex-shrink-0" />
                      <span className="flex-1 h-0.5 bg-red-500" />
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {!loading && events.length === 0 && !error && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
          No schedules found for this {viewMode === 'week' ? 'week' : viewMode === 'day' ? 'day' : 'month'}. Try adjusting your filters.
        </div>
      )}

      {isModalOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeModal}>
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h2 className="text-xl font-bold text-gray-900">Class Details</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="p-6">
              {loadingClassDetails ? (
                <div className="flex justify-center py-8 text-sm text-gray-500">Loading class details...</div>
              ) : selectedEvent && classDetails ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Class Name</label><p className="mt-1 text-sm text-gray-900">{classDetails.class_name || classDetails.level_tag || 'N/A'}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Program</label><p className="mt-1 text-sm text-gray-900">{classDetails.program_name || selectedEvent?.program_name || 'N/A'}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Level Tag</label><p className="mt-1 text-sm text-gray-900">{classDetails.level_tag || 'N/A'}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Phase</label><p className="mt-1 text-sm text-gray-900">{classDetails.class_phase_number ? `Phase ${classDetails.class_phase_number}` : 'Phase 1'}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Branch</label><p className="mt-1 text-sm text-gray-900">{classDetails.branch_name || selectedEvent?.branch_name || 'N/A'}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Room</label><p className="mt-1 text-sm text-gray-900">{classDetails.room_name || selectedEvent?.room_name || 'Unassigned'}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Date</label><p className="mt-1 text-sm text-gray-900">{new Date(selectedEvent.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Time</label><p className="mt-1 text-sm text-gray-900">{formatTime(selectedEvent.start_time)}{selectedEvent.end_time ? ` – ${formatTime(selectedEvent.end_time)}` : ''}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Teachers</label><p className="mt-1 text-sm text-gray-900">{selectedEvent.teachers?.length > 0 ? selectedEvent.teachers.map((t) => t.teacher_name).join(', ') : 'N/A'}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Enrolled Students</label><p className="mt-1 text-sm text-gray-900">{classDetails.enrolled_students ?? 0}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Max Students</label><p className="mt-1 text-sm text-gray-900">{classDetails.max_students || 'N/A'}</p></div>
                    <div><label className="text-xs font-semibold uppercase text-gray-500">Status</label><p className="mt-1"><span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${classDetails.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{classDetails.status || 'N/A'}</span></p></div>
                  </div>
                  {classDetails.days_of_week?.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold uppercase text-gray-500">Schedule</label>
                      <div className="mt-2 space-y-2">
                        {classDetails.days_of_week.map((schedule, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 p-2 rounded">
                            <span className="font-medium">{schedule.day_of_week}:</span>
                            <span>{formatTime(schedule.start_time)} – {formatTime(schedule.end_time)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-sm text-gray-500">Unable to load class details.</div>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
              <button type="button" onClick={handleGoToClassPage} className="text-sm font-medium text-blue-600 hover:underline">Go to Class Page</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default CalendarSchedule;
