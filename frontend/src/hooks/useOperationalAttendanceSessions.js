import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../config/api';

export default function useOperationalAttendanceSessions({
  mode = 'daily',
  summaryDate = '',
  summaryMonth = '',
  branchId = '',
  attendanceFilter = 'all',
  listLimit = null,
  enabled = true,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState('');

  const fetchSessions = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ mode, attendance_filter: attendanceFilter });
      if (mode === 'monthly') {
        if (summaryMonth) params.set('summary_month', summaryMonth);
      } else if (summaryDate) {
        params.set('summary_date', summaryDate);
      }
      if (branchId) params.set('branch_id', branchId);
      if (listLimit != null) params.set('list_limit', String(listLimit));

      const response = await apiRequest(
        `/dashboard/operational-attendance-sessions?${params.toString()}`
      );
      setData(response.data);
    } catch (err) {
      setError(err?.message || 'Failed to load class sessions for attendance.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [mode, summaryDate, summaryMonth, branchId, attendanceFilter, listLimit, enabled]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return {
    data,
    sessions: data?.sessions || [],
    summary: {
      pendingCount: data?.pending_count || 0,
      takenCount: data?.taken_count || 0,
      completedCount: data?.completed_count || 0,
      partiallyTakenCount: data?.partially_taken_count || 0,
      upcomingCount: data?.upcoming_count || 0,
      totalCount: data?.total_count || 0,
      listCount: data?.list_count || 0,
      isTruncated: Boolean(data?.is_truncated),
    },
    pendingCount: data?.pending_count || 0,
    takenCount: data?.taken_count || 0,
    completedCount: data?.completed_count || 0,
    upcomingCount: data?.upcoming_count || 0,
    totalCount: data?.total_count || 0,
    isTruncated: Boolean(data?.is_truncated),
    loading,
    error,
    refresh: fetchSessions,
  };
}
