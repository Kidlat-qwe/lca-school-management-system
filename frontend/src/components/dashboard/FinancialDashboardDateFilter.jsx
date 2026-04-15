import { useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Date range by invoice / payment issue_date (Asia/Manila calendar day) for finance dashboards.
 * Renders a header button and opens a modal with From/To, Apply, This month, and Clear.
 */
const FinancialDashboardDateFilter = ({
  draftFrom,
  draftTo,
  onDraftFromChange,
  onDraftToChange,
  onApply,
  onClear,
  onThisMonth,
  activeSummary,
  onPrepareOpen,
}) => {
  const [open, setOpen] = useState(false);

  const handleOpen = () => {
    onPrepareOpen?.();
    setOpen(true);
  };

  const handleClose = () => setOpen(false);

  const handleApplyClick = () => {
    onApply();
    setOpen(false);
  };

  const handleThisMonthClick = () => {
    onThisMonth?.();
    setOpen(false);
  };

  const handleClearClick = () => {
    onDraftFromChange('');
    onDraftToChange('');
    onClear();
    setOpen(false);
  };

  const modal =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm bg-black/40"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fin-dash-date-modal-title"
        onClick={handleClose}
      >
        <div
          className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="fin-dash-date-modal-title" className="text-lg font-semibold text-gray-900">
                Date range
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                Uses <span className="font-medium text-gray-700">invoice issue date</span> and{' '}
                <span className="font-medium text-gray-700">payment issue date</span> (business date) for reconciliation.
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
              aria-label="Close"
            >
              <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {activeSummary ? (
            <p className="text-xs text-primary-700 mt-3 font-medium bg-primary-50 rounded-lg px-3 py-2">{activeSummary}</p>
          ) : null}

          <div className="mt-4 flex flex-col sm:flex-row flex-wrap gap-3">
            <div className="flex-1 min-w-[140px]">
              <label htmlFor="fin-dash-modal-from" className="block text-xs font-medium text-gray-600 mb-1">
                From
              </label>
              <input
                id="fin-dash-modal-from"
                type="date"
                value={draftFrom}
                onChange={(e) => onDraftFromChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label htmlFor="fin-dash-modal-to" className="block text-xs font-medium text-gray-600 mb-1">
                To
              </label>
              <input
                id="fin-dash-modal-to"
                type="date"
                value={draftTo}
                onChange={(e) => onDraftToChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-col-reverse sm:flex-row sm:flex-wrap gap-2 sm:justify-end">
            <button
              type="button"
              onClick={handleClearClick}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleThisMonthClick}
              className="px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100"
            >
              This month
            </button>
            <button
              type="button"
              onClick={handleApplyClick}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700"
            >
              Apply
            </button>
          </div>
        </div>
      </div>,
      document.body
    );

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
      >
        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>Date filter</span>
      </button>
      {modal}
    </>
  );
};

export default FinancialDashboardDateFilter;
