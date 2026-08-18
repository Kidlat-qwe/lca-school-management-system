import { useState, useEffect, useRef, useCallback } from 'react';
import { apiRequest } from '../../config/api';

/**
 * Live announcements list fetch: debounce filter changes, reset to page 1,
 * and load the table only (no full-page spinner).
 */
export function useAnnouncementBoardList({
  extraParams = {},
  lockStatus = '',
  defaultRecipientGroup = '',
  itemsPerPage = 10,
} = {}) {
  const [announcements, setAnnouncements] = useState([]);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState('');
  const [titleSearchTerm, setTitleSearchTerm] = useState('');
  const [filterRecipientGroup, setFilterRecipientGroup] = useState('');
  const [filterCreatedOn, setFilterCreatedOn] = useState('');
  const [filterStatus, setFilterStatus] = useState(lockStatus || '');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const prevFiltersKeyRef = useRef('');
  const fetchRequestIdRef = useRef(0);
  const extraKey = JSON.stringify(extraParams || {});
  const extraParamsRef = useRef(extraParams);
  extraParamsRef.current = extraParams;

  const fetchAnnouncements = useCallback(async () => {
    const requestId = ++fetchRequestIdRef.current;
    try {
      setTableLoading(true);
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
      });

      if (titleSearchTerm) {
        params.append('title', titleSearchTerm);
      }
      const recipientGroup = filterRecipientGroup || defaultRecipientGroup;
      if (recipientGroup) {
        params.append('recipient_group', recipientGroup);
      }
      if (filterCreatedOn) {
        params.append('created_on', filterCreatedOn);
      }
      const status = lockStatus || filterStatus;
      if (status) {
        params.append('status', status);
      }
      Object.entries(extraParamsRef.current || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, String(value));
        }
      });

      const response = await apiRequest(`/announcements?${params.toString()}`);
      if (requestId !== fetchRequestIdRef.current) return;
      setAnnouncements(response.data || []);
      setTotalItems(response.pagination?.total || 0);
      setTotalPages(response.pagination?.totalPages || 0);
    } catch (err) {
      if (requestId !== fetchRequestIdRef.current) return;
      setError(err.message || 'Failed to fetch announcements');
      console.error('Error fetching announcements:', err);
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setTableLoading(false);
      }
    }
  }, [
    currentPage,
    itemsPerPage,
    titleSearchTerm,
    filterRecipientGroup,
    filterCreatedOn,
    filterStatus,
    lockStatus,
    defaultRecipientGroup,
    extraKey,
  ]);

  useEffect(() => {
    const filtersKey = `${titleSearchTerm}|${filterRecipientGroup}|${filterCreatedOn}|${filterStatus}|${extraKey}`;
    const isFirstLoad = prevFiltersKeyRef.current === '';
    const filtersChanged = !isFirstLoad && prevFiltersKeyRef.current !== filtersKey;
    prevFiltersKeyRef.current = filtersKey;

    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
      return;
    }

    const delay = isFirstLoad ? 0 : (filtersChanged ? 300 : 0);
    const timer = setTimeout(() => {
      fetchAnnouncements();
    }, delay);
    return () => clearTimeout(timer);
  }, [
    currentPage,
    titleSearchTerm,
    filterRecipientGroup,
    filterCreatedOn,
    filterStatus,
    extraKey,
    fetchAnnouncements,
  ]);

  return {
    announcements,
    tableLoading,
    error,
    setError,
    titleSearchTerm,
    setTitleSearchTerm,
    filterRecipientGroup,
    setFilterRecipientGroup,
    filterCreatedOn,
    setFilterCreatedOn,
    filterStatus,
    setFilterStatus,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    totalItems,
    totalPages,
    fetchAnnouncements,
  };
}
