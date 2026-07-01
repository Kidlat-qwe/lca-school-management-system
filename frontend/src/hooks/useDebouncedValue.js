import { useEffect, useState } from 'react';

/**
 * Returns a value that only updates after `delay` ms have passed without
 * the input changing. Used to debounce free-text search inputs so we don't
 * issue a backend request (or recompute heavy filters) on every keystroke.
 *
 * Pattern matches `frontend/src/pages/superadmin/Student.jsx`.
 *
 * @template T
 * @param {T} value         The latest input value (typically search text).
 * @param {number} [delay]  Debounce window in milliseconds (default 300).
 * @returns {T}             The debounced value.
 */
export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
