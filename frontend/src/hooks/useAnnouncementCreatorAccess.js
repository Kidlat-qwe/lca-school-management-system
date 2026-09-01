import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../config/api';

/**
 * Whether the current user may create board announcements (Settings-controlled).
 * Superadmin always receives can_create: true from the API.
 */
export function useAnnouncementCreatorAccess() {
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/announcements/creators/me');
      setCanCreate(Boolean(res.data?.can_create));
    } catch {
      setCanCreate(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { canCreate, loading, refresh };
}

export default useAnnouncementCreatorAccess;
