import { useState, useEffect } from 'react';
import { ANNOUNCEMENT_RECIPIENT_FILTER_OPTIONS, ANNOUNCEMENT_STATUS_FILTER_OPTIONS } from './filterOptions';

/**
 * Live announcement filters. Status sits beside Recipient Group.
 * No Search, Reset, or advanced-filters toggle.
 */
const AnnouncementBoardFilters = ({
  titleSearchTerm,
  onTitleChange,
  filterRecipientGroup,
  onRecipientGroupChange,
  filterCreatedOn,
  onCreatedOnChange,
  filterStatus,
  onStatusChange,
  showStatus = true,
  recipientOptions = ANNOUNCEMENT_RECIPIENT_FILTER_OPTIONS,
}) => {
  const [openRecipientGroupDropdown, setOpenRecipientGroupDropdown] = useState(false);
  const [openStatusDropdown, setOpenStatusDropdown] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (openRecipientGroupDropdown && !event.target.closest('.recipient-group-filter-dropdown')) {
        setOpenRecipientGroupDropdown(false);
      }
      if (openStatusDropdown && !event.target.closest('.status-filter-dropdown')) {
        setOpenStatusDropdown(false);
      }
    };
    if (openRecipientGroupDropdown || openStatusDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openRecipientGroupDropdown, openStatusDropdown]);

  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <h2 className="text-base font-semibold text-gray-900 mb-3">Search Filter</h2>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${showStatus ? 'xl:grid-cols-4' : 'xl:grid-cols-3'} gap-3`}>
        <div>
          <label htmlFor="title-search" className="block text-xs font-medium text-gray-700 mb-1">
            Announcement Title
          </label>
          <input
            type="text"
            id="title-search"
            value={titleSearchTerm}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Search by title..."
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div className="relative">
          <label htmlFor="recipient-group-filter" className="block text-xs font-medium text-gray-700 mb-1">
            Recipient Group
          </label>
          <div className="recipient-group-filter-dropdown relative">
            <button
              type="button"
              onClick={() => {
                setOpenRecipientGroupDropdown((open) => !open);
                setOpenStatusDropdown(false);
              }}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-left flex items-center justify-between focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <span>
                {recipientOptions.find((group) => group.value === filterRecipientGroup)?.label || 'All'}
              </span>
              {filterRecipientGroup ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRecipientGroupChange('');
                  }}
                  className="ml-2 text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : null}
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {openRecipientGroupDropdown && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                {recipientOptions.map((group) => (
                  <button
                    key={group.value || 'all'}
                    type="button"
                    onClick={() => {
                      onRecipientGroupChange(group.value);
                      setOpenRecipientGroupDropdown(false);
                    }}
                    className={`w-full px-3 py-2 text-sm text-left hover:bg-primary-50 ${
                      filterRecipientGroup === group.value ? 'bg-primary-100' : ''
                    }`}
                  >
                    {group.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {showStatus ? (
          <div className="relative">
            <label htmlFor="status-filter" className="block text-xs font-medium text-gray-700 mb-1">
              Status
            </label>
            <div className="status-filter-dropdown relative">
              <button
                type="button"
                onClick={() => {
                  setOpenStatusDropdown((open) => !open);
                  setOpenRecipientGroupDropdown(false);
                }}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-left flex items-center justify-between focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <span>{filterStatus || 'All'}</span>
                {filterStatus ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStatusChange('');
                    }}
                    className="ml-2 text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ) : null}
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {openStatusDropdown && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
                  <button
                    type="button"
                    onClick={() => {
                      onStatusChange('');
                      setOpenStatusDropdown(false);
                    }}
                    className="w-full px-3 py-2 text-sm text-left hover:bg-primary-50"
                  >
                    All
                  </button>
                  {ANNOUNCEMENT_STATUS_FILTER_OPTIONS.map((status) => (
                    <button
                      key={status.value}
                      type="button"
                      onClick={() => {
                        onStatusChange(status.value);
                        setOpenStatusDropdown(false);
                      }}
                      className={`w-full px-3 py-2 text-sm text-left hover:bg-primary-50 ${
                        filterStatus === status.value ? 'bg-primary-100' : ''
                      }`}
                    >
                      {status.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
        <div>
          <label htmlFor="created-on-filter" className="block text-xs font-medium text-gray-700 mb-1">
            Announcement Created On
          </label>
          <input
            type="date"
            id="created-on-filter"
            value={filterCreatedOn}
            onChange={(e) => onCreatedOnChange(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>
    </div>
  );
};

export default AnnouncementBoardFilters;
