import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../config/api';

const isTeacherAssigned = (classItem, teacherId) => {
  if (!teacherId || !classItem) return false;
  if (classItem.teacher_ids && Array.isArray(classItem.teacher_ids)) {
    return classItem.teacher_ids.some((id) => parseInt(id, 10) === teacherId);
  }
  if (classItem.teacher_id) {
    return parseInt(classItem.teacher_id, 10) === teacherId;
  }
  return false;
};

export default function useTeacherAssignedClasses({ teacherId, branchId, enabled = true }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled && teacherId && branchId));
  const [error, setError] = useState('');

  const fetchClasses = useCallback(async () => {
    if (!enabled || !teacherId || !branchId) return;

    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        branch_id: String(branchId),
        limit: '100',
      });
      const response = await apiRequest(`/classes?${params.toString()}`);
      const allClasses = response.data || [];
      setClasses(allClasses.filter((item) => isTeacherAssigned(item, teacherId)));
    } catch (err) {
      setError(err?.message || 'Failed to load assigned classes.');
      setClasses([]);
    } finally {
      setLoading(false);
    }
  }, [teacherId, branchId, enabled]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  return {
    classes,
    classCount: classes.length,
    loading,
    error,
    refresh: fetchClasses,
  };
}
