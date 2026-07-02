import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../config/api';

export default function useAttendanceDashboardFilters({ branchId = '', programId = '', enabled = true }) {
  const [options, setOptions] = useState({ programs: [], classes: [], teachers: [] });
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState('');

  const fetchOptions = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (branchId) params.set('branch_id', branchId);
      if (programId) params.set('program_id', programId);

      const response = await apiRequest(
        `/dashboard/operational-attendance-filter-options?${params.toString()}`
      );
      setOptions({
        programs: response.data?.programs || [],
        classes: response.data?.classes || [],
        teachers: response.data?.teachers || [],
      });
    } catch (err) {
      setError(err?.message || 'Failed to load filter options.');
      setOptions({ programs: [], classes: [], teachers: [] });
    } finally {
      setLoading(false);
    }
  }, [branchId, programId, enabled]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  return { options, loading, error, refresh: fetchOptions };
}
