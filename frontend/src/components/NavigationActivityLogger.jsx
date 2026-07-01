import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../config/api';

const dedupe = { key: '', at: 0 };

/**
 * Records SPA route changes as system logs (action GET, entity navigation). Mounted inside Layout.
 */
const NavigationActivityLogger = () => {
  const location = useLocation();

  useEffect(() => {
    const path = `${location.pathname}${location.search || ''}`;
    const now = Date.now();
    if (path === dedupe.key && now - dedupe.at < 600) return;
    dedupe.key = path;
    dedupe.at = now;

    const title = typeof document !== 'undefined' ? document.title : '';

    apiRequest('/system-logs/page-view', {
      method: 'POST',
      body: { path, title },
    }).catch(() => {});
  }, [location.pathname, location.search]);

  return null;
};

export default NavigationActivityLogger;
