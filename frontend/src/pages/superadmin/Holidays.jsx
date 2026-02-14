import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
// 1 AM–11 AM, then 12 PM–11 PM (hours 1–23)
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

const Holidays = () => {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const todayYmd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const { userInfo } = useAuth();
  const userType = userInfo?.user_type || userInfo?.userType;
  const isSuperadmin = userType === 'Superadmin';
  const basePath = useLocation().pathname.startsWith('/admin') ? '/admin' : '/superadmin';

  const [viewMode, setViewMode] = useState('month');
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [selectedDate, setSelectedDate] = useState(todayYmd);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState(null);
  const [branches, setBranches] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    holiday_date: todayYmd,
    branch_id: '',
    description: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);

  const monthMeta = useMemo(() => getMonthRange(selectedMonth), [selectedMonth]);
  const weekMeta = useMemo(() => getWeekRange(selectedDate), [selectedDate]);

  const fetchRange = useMemo(() => {
    if (viewMode === 'month') return { start: monthMeta.start, end: monthMeta.end };
    if (viewMode === 'week') return { start: weekMeta.start, end: weekMeta.end };
    return { start: selectedDate, end: selectedDate };
  }, [viewMode, monthMeta.start, monthMeta.end, weekMeta.start, weekMeta.end, selectedDate]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchRange.start, fetchRange.end]);

  useEffect(() => {
    if (isSuperadmin && modalOpen) {
      fetchBranches();
    }
  }, [isSuperadmin, modalOpen]);

  const fetchBranches = async () => {
    try {
      const res = await apiRequest('/branches?limit=100');
      setBranches(res.data || []);
    } catch (err) {
      console.error('Failed to load branches', err);
    }
  };

  const fetchHolidays = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest(`/holidays?start_date=${fetchRange.start}&end_date=${fetchRange.end}`);
      setHolidays(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to load holidays');
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  };

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

    for (let i = 0; i < firstDayIndex; i++) {
      cells.push({ type: 'placeholder', key: `prev-${i}` });
    }

    for (let day = 1; day <= monthMeta.daysInMonth; day++) {
      const dateKey = `${monthMeta.year}-${String(monthMeta.monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      cells.push({
        type: 'day',
        key: `day-${dateKey}`,
        dayNumber: day,
        dateKey,
        events: holidaysByDate[dateKey] || [],
      });
    }

    while (cells.length % 7 !== 0) {
      cells.push({ type: 'placeholder', key: `next-${cells.length}` });
    }
    return cells;
  }, [monthMeta, holidaysByDate]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekMeta.startDate);
      d.setDate(weekMeta.startDate.getDate() + i);
      const dateKey = toYmd(d);
      return {
        dateKey,
        dayNumber: d.getDate(),
        dayLabel: DAY_LABELS[i],
        events: holidaysByDate[dateKey] || [],
      };
    });
  }, [weekMeta.startDate, holidaysByDate]);

  const currentTime = useMemo(() => {
    const now = new Date();
    const local = todayYmd === selectedDate;
    if (!local) return null;
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }, [selectedDate, todayYmd]);

  const goToToday = () => {
    setSelectedMonth(defaultMonth);
    setSelectedDate(todayYmd);
  };

  const prev = () => {
    if (viewMode === 'month') {
      const [y, m] = selectedMonth.split('-').map(Number);
      if (m === 1) setSelectedMonth(`${y - 1}-12`);
      else setSelectedMonth(`${y}-${String(m - 1).padStart(2, '0')}`);
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
      if (m === 12) setSelectedMonth(`${y + 1}-01`);
      else setSelectedMonth(`${y}-${String(m + 1).padStart(2, '0')}`);
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

  const headerTitle = viewMode === 'month'
    ? monthMeta.monthName
    : viewMode === 'week'
      ? weekMeta.label
      : getDayLongLabel(selectedDate);

  const syncMonthFromSelectedDate = () => {
    const [y, m] = selectedDate.split('-');
    setSelectedMonth(`${y}-${m}`);
  };

  const getDefaultAddDate = () => {
    if (viewMode === 'day') return selectedDate;
    if (viewMode === 'week') return weekMeta.start;
    return monthMeta.start;
  };

  const openAddModal = (dateKey) => {
    setEditingHoliday(null);
    setFormData({
      name: '',
      holiday_date: dateKey ?? getDefaultAddDate(),
      branch_id: '',
      description: '',
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (holiday) => {
    if (holiday.source !== 'custom') return;
    setEditingHoliday(holiday);
    setFormData({
      name: holiday.name,
      holiday_date: holiday.date,
      branch_id: holiday.branch_id ?? '',
      description: holiday.description || '',
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingHoliday(null);
  };

  const validateForm = () => {
    const err = {};
    if (!formData.name.trim()) err.name = 'Name is required';
    if (!formData.holiday_date) err.holiday_date = 'Date is required';
    setFormErrors(err);
    return Object.keys(err).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm() || submitting) return;
    setSubmitting(true);
    try {
      const payload = {
        name: formData.name.trim(),
        holiday_date: formData.holiday_date,
        description: formData.description.trim() || undefined,
      };
      if (isSuperadmin && formData.branch_id !== undefined && formData.branch_id !== '') {
        payload.branch_id = parseInt(formData.branch_id, 10);
      } else if (isSuperadmin && (formData.branch_id === '' || formData.branch_id === undefined)) {
        payload.branch_id = null;
      }

      if (editingHoliday) {
        await apiRequest(`/holidays/custom/${editingHoliday.holiday_id}`, {
          method: 'PUT',
          body: payload,
        });
        closeModal();
        fetchHolidays();
      } else {
        await apiRequest('/holidays', {
          method: 'POST',
          body: payload,
        });
        closeModal();
        fetchHolidays();
      }
    } catch (err) {
      setFormErrors({ submit: err.response?.data?.message || err.message || 'Request failed' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editingHoliday || editingHoliday.source !== 'custom') return;
    if (!window.confirm(`Delete "${editingHoliday.name}"?`)) return;
    setSubmitting(true);
    try {
      await apiRequest(`/holidays/custom/${editingHoliday.holiday_id}`, { method: 'DELETE' });
      closeModal();
      fetchHolidays();
    } catch (err) {
      setFormErrors({ submit: err.response?.data?.message || err.message || 'Delete failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header - Google Calendar style */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Holidays</h1>
          <p className="text-sm text-gray-600">
            Manage all holidays here. Add school-wide or branch-specific holidays. These are used when scheduling classes and calculating end dates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goToToday}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            Today
          </button>
          <div className="flex items-center rounded-lg border border-gray-300 bg-white shadow-sm">
            <button
              type="button"
              onClick={prev}
              className="p-2 text-gray-600 hover:bg-gray-50 rounded-l-lg"
              aria-label="Previous"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="min-w-[140px] px-4 py-2 text-center text-sm font-semibold text-gray-900 sm:min-w-[180px]">
              {headerTitle}
            </span>
            <button
              type="button"
              onClick={next}
              className="p-2 text-gray-600 hover:bg-gray-50 rounded-r-lg"
              aria-label="Next"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setViewDropdownOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 min-w-[100px] justify-center"
            >
              <span>{viewMode === 'month' ? 'Month' : viewMode === 'week' ? 'Week' : 'Day'}</span>
              <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {viewDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setViewDropdownOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-full z-20 mt-1 w-[100px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => { setViewMode('month'); syncMonthFromSelectedDate(); setViewDropdownOpen(false); }}
                    className={`block w-full px-4 py-2 text-left text-sm ${viewMode === 'month' ? 'bg-[#F7C844] font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (viewMode === 'month') setSelectedDate(monthMeta.start);
                      setViewMode('week');
                      setViewDropdownOpen(false);
                    }}
                    className={`block w-full px-4 py-2 text-left text-sm ${viewMode === 'week' ? 'bg-[#F7C844] font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    Week
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (viewMode === 'month') setSelectedDate(monthMeta.start);
                      setViewMode('day');
                      setViewDropdownOpen(false);
                    }}
                    className={`block w-full px-4 py-2 text-left text-sm ${viewMode === 'day' ? 'bg-[#F7C844] font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    Day
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Legend row - Holiday text on left, Add holiday button on right */}
      <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
        <span className="flex items-center gap-2">
          <span className="h-4 w-5 rounded bg-[#1d4ed8]" style={{ backgroundColor: '#1d4ed8' }} />
          <span className="text-gray-600">Holiday</span>
        </span>
        <button
          type="button"
          onClick={() => openAddModal()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-medium text-gray-900 shadow-sm transition hover:bg-[#e6b73d]"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add holiday
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Calendar - Month / Week / Day */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: '280px' }}>
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center py-12">
              <p className="text-sm text-gray-500">Loading holidays...</p>
            </div>
          ) : viewMode === 'month' ? (
            <>
              <div className="grid grid-cols-7 gap-px border-b border-gray-200 bg-gray-100 text-center text-xs font-semibold uppercase tracking-wide text-gray-600">
                {DAY_LABELS.map((day) => (
                  <div key={day} className="bg-white py-2">{day}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-gray-200">
                {calendarCells.map((cell) => {
                  if (cell.type === 'placeholder') {
                    return <div key={cell.key} className="min-h-[100px] bg-gray-50 sm:min-h-[120px]" />;
                  }
                  const isToday = cell.dateKey === todayYmd;
                  return (
                    <div key={cell.key} className="min-h-[100px] flex flex-col bg-white p-1 sm:min-h-[120px]">
                      <button
                        type="button"
                        onClick={() => openAddModal(cell.dateKey)}
                        className={`text-sm font-medium self-start ${isToday ? 'flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100 rounded'}`}
                      >
                        {cell.dayNumber}
                      </button>
                      <div className="mt-1 flex flex-1 flex-col gap-1 overflow-y-auto">
                        {(cell.events || []).map((ev) => (
                          <button
                            key={ev.source === 'custom' ? ev.holiday_id : `${ev.date}-${ev.name}`}
                            type="button"
                            onClick={() => ev.source === 'custom' ? openEditModal(ev) : undefined}
                            className={`w-full truncate rounded px-1.5 py-1 text-left text-xs font-medium text-white ${ev.source === 'national' ? 'bg-[#0f766e] hover:bg-[#0d6961]' : 'bg-[#1d4ed8] hover:bg-[#1e40af] cursor-pointer'}`}
                            title={ev.name}
                          >
                            {ev.name}
                          </button>
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
                      <button
                        type="button"
                        onClick={() => openAddModal(wd.dateKey)}
                        className={`mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${isToday ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
                      >
                        {wd.dayNumber}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-8 border-b border-gray-200 min-h-[48px]">
                <div className="py-2 pr-2 text-xs font-medium text-gray-500 border-r border-gray-100">All day</div>
                {weekDays.map((wd) => (
                  <div key={wd.dateKey} className="py-1 px-1 border-l border-gray-100 flex flex-col gap-1 min-h-[44px]">
                    {(wd.events || []).map((ev) => (
                      <button
                        key={ev.source === 'custom' ? ev.holiday_id : `${ev.date}-${ev.name}`}
                        type="button"
                        onClick={() => ev.source === 'custom' ? openEditModal(ev) : undefined}
                        className={`w-full truncate rounded px-1.5 py-1 text-left text-xs font-medium text-white ${ev.source === 'national' ? 'bg-[#0f766e] hover:bg-[#0d6961]' : 'bg-[#1d4ed8] hover:bg-[#1e40af] cursor-pointer'}`}
                        title={ev.name}
                      >
                        {ev.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-8 flex-1">
                <div className="border-r border-gray-100 py-1 pr-2 text-xs text-gray-500 space-y-0">
                  <span className="block">GMT+8</span>
                  {HOURS.map((h) => (
                    <div key={h} className="h-12 leading-12">
                      {formatHour(h)}
                    </div>
                  ))}
                </div>
                {weekDays.map((wd) => (
                  <div key={wd.dateKey} className="border-l border-gray-100 relative">
                    {HOURS.map((h) => (
                      <div key={h} className="h-12 border-b border-gray-50" />
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Day view */
            <>
              <div className="flex items-start gap-4 border-b border-gray-200 pb-4">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => openAddModal(selectedDate)}
                    className={`inline-flex h-10 w-14 items-center justify-center rounded-full text-sm font-bold ${selectedDate === todayYmd ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}
                  >
                    {getDayLabel(selectedDate)}
                  </button>
                  <span className="mt-1 text-xs text-gray-500">GMT+8</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-500 mb-2">All day</div>
                  <div className="flex flex-wrap gap-2 min-h-[44px]">
                    {((holidaysByDate[selectedDate]) || []).map((ev) => (
                      <button
                        key={ev.source === 'custom' ? ev.holiday_id : `${ev.date}-${ev.name}`}
                        type="button"
                        onClick={() => ev.source === 'custom' ? openEditModal(ev) : undefined}
                        className={`rounded px-3 py-2 text-sm font-medium text-white ${ev.source === 'national' ? 'bg-[#0f766e] hover:bg-[#0d6961]' : 'bg-[#1d4ed8] hover:bg-[#1e40af] cursor-pointer'}`}
                        title={ev.name}
                      >
                        {ev.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="relative mt-4">
                <div className="flex gap-4">
                  <div className="w-14 flex-shrink-0 text-xs text-gray-500 pt-1">
                    {HOURS.map((h) => (
                      <div key={h} className="h-12 leading-12">
                        {formatHour(h)}
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 relative border-l border-gray-200" style={{ minHeight: `${HOURS.length * 48}px` }}>
                    {HOURS.map((h) => (
                      <div key={h} className="h-12 border-b border-gray-100" />
                    ))}
                    {selectedDate === todayYmd && currentTime != null && currentTime >= 1 && currentTime < 24 && (
                      <div
                        className="absolute left-0 right-0 flex items-center pointer-events-none z-10"
                        style={{ top: `${((currentTime - 1) / 23) * 100}%` }}
                      >
                        <span className="h-0.5 w-3 bg-red-500 rounded-r flex-shrink-0" />
                        <span className="flex-1 h-0.5 bg-red-500" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Add/Edit Custom Holiday Modal */}
      {modalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={closeModal}
          >
            <div
              className="relative w-full max-w-md rounded-xl bg-white shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-gray-200 px-6 py-4">
                <h2 className="text-lg font-bold text-gray-900">
                  {editingHoliday ? 'Edit custom holiday' : 'Add custom holiday'}
                </h2>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]"
                    placeholder="e.g. School Foundation Day"
                  />
                  {formErrors.name && <p className="mt-1 text-xs text-red-600">{formErrors.name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Date</label>
                  <input
                    type="date"
                    value={formData.holiday_date}
                    onChange={(e) => setFormData((p) => ({ ...p, holiday_date: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]"
                  />
                  {formErrors.holiday_date && <p className="mt-1 text-xs text-red-600">{formErrors.holiday_date}</p>}
                </div>
                {isSuperadmin && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Branch (optional)</label>
                    <select
                      value={formData.branch_id}
                      onChange={(e) => setFormData((p) => ({ ...p, branch_id: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]"
                    >
                      <option value="">All branches</option>
                      {branches.map((b) => (
                        <option key={b.branch_id} value={b.branch_id}>
                          {b.branch_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700">Description (optional)</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]"
                    placeholder="Optional notes"
                  />
                </div>
                {formErrors.submit && <p className="text-sm text-red-600">{formErrors.submit}</p>}
                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-medium text-gray-900 hover:bg-[#e6b73d] disabled:opacity-50"
                  >
                    {submitting ? 'Saving...' : editingHoliday ? 'Update' : 'Create'}
                  </button>
                  {editingHoliday && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={submitting}
                      className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default Holidays;
