import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { appAlert } from '../../utils/appAlert';
import { formatDateManila } from '../../utils/dateUtils';

const formatYmd = (value) => {
  if (!value) return '—';
  return formatDateManila(value);
};

const ClassStartDateAdjustmentModal = ({ open, classItem, onClose, onApplied }) => {
  const [step, setStep] = useState('input');
  const [newStartDate, setNewStartDate] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);

  const classId = classItem?.class_id;
  const currentStart = classItem?.start_date
    ? String(classItem.start_date).slice(0, 10)
    : '';

  const resetState = useCallback(() => {
    setStep('input');
    setNewStartDate('');
    setReason('');
    setPreview(null);
    setApplyResult(null);
    setLoadingPreview(false);
    setLoadingApply(false);
    setAcknowledgeWarnings(false);
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }
    if (currentStart) {
      setNewStartDate(currentStart);
    }
  }, [open, currentStart, resetState]);

  const handleClose = () => {
    resetState();
    onClose?.();
  };

  const handlePreview = async () => {
    if (!classId || !newStartDate) {
      appAlert('Please select a new start date.');
      return;
    }
    if (newStartDate === currentStart) {
      appAlert('New start date must differ from the current start date.');
      return;
    }

    try {
      setLoadingPreview(true);
      const response = await apiRequest(`/classes/${classId}/adjust-start-date/preview`, {
        method: 'POST',
        body: {
          new_start_date: newStartDate,
          acknowledge_warnings: acknowledgeWarnings,
        },
      });
      setPreview(response.data || response);
      setStep('preview');
    } catch (err) {
      appAlert(err.response?.data?.message || err.message || 'Failed to load preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleApply = async () => {
    if (!classId || !preview?.can_apply) return;
    if (!reason.trim()) {
      appAlert('Please provide a reason for this adjustment.');
      return;
    }

    try {
      setLoadingApply(true);
      const response = await apiRequest(`/classes/${classId}/adjust-start-date/apply`, {
        method: 'POST',
        body: {
          new_start_date: newStartDate,
          reason: reason.trim(),
          acknowledge_warnings: acknowledgeWarnings,
        },
      });
      setApplyResult(response.data || response);
      setStep('result');
      onApplied?.(response.data || response);
    } catch (err) {
      appAlert(err.response?.data?.message || err.message || 'Failed to apply adjustment');
    } finally {
      setLoadingApply(false);
    }
  };

  if (!open || !classItem) return null;

  const billingRows = (preview?.billing_impacts || []).filter((row) => !row.skipped && row.changes?.length);

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/10 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-start justify-between border-b border-gray-200 px-5 py-4">
          <div className="min-w-0 pr-4">
            <h2 className="text-lg font-semibold text-gray-900">Adjust Class Start Date</h2>
            <p className="mt-0.5 truncate text-sm text-gray-500">
              {classItem.class_name || classItem.level_tag}
              {classItem.program_name ? ` · ${classItem.program_name}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'input' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Use this workflow when the class start date must change after students are enrolled or
                installment invoices exist. Sessions, end date, unpaid invoice due dates, and the
                installment queue will be realigned. Room and teacher conflicts are checked before apply.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Current start date</label>
                  <input
                    type="text"
                    readOnly
                    value={formatYmd(currentStart)}
                    className="input-field cursor-not-allowed bg-gray-50"
                  />
                </div>
                <div>
                  <label htmlFor="adjust_new_start_date" className="mb-1 block text-sm font-medium text-gray-700">
                    New start date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    id="adjust_new_start_date"
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="adjust_reason" className="mb-1 block text-sm font-medium text-gray-700">
                  Reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="adjust_reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="input-field resize-y"
                  placeholder="e.g. Branch delayed room availability; class moved from July to August"
                />
              </div>
            </div>
          )}

          {step === 'preview' && preview && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">Current start</p>
                  <p className="text-sm font-medium text-gray-900">{formatYmd(preview.current_start_date)}</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs text-amber-700">New start</p>
                  <p className="text-sm font-medium text-amber-900">{formatYmd(preview.new_start_date)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">New end</p>
                  <p className="text-sm font-medium text-gray-900">{formatYmd(preview.new_end_date)}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-500">Sessions</p>
                  <p className="text-sm font-medium text-gray-900">{preview.session_summary?.total_sessions ?? '—'}</p>
                </div>
              </div>

              {(preview.blockers || []).length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm font-medium text-red-800">Cannot apply until resolved</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
                    {preview.blockers.map((blocker) => (
                      <li key={blocker.code}>{blocker.message}</li>
                    ))}
                  </ul>
                  {(preview.room_conflicts?.length > 0 || preview.teacher_conflicts?.length > 0) && (
                    <div className="mt-3 space-y-2 text-sm text-red-700">
                      {preview.room_conflicts?.map((c, idx) => (
                        <p key={`room-${idx}`}>{c.message}</p>
                      ))}
                      {preview.teacher_conflicts?.map((c, idx) => (
                        <p key={`teacher-${idx}`}>{c.message || c.conflict_message}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(preview.warnings || []).length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">Warnings</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">
                    {preview.warnings.map((w) => (
                      <li key={w.code}>{w.message}</li>
                    ))}
                  </ul>
                  {preview.blockers?.some((b) => b.code === 'completed_sessions_with_attendance') === false &&
                    preview.warnings.some((w) => w.code === 'completed_sessions_with_attendance') && (
                      <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
                        <input
                          type="checkbox"
                          checked={acknowledgeWarnings}
                          onChange={(e) => setAcknowledgeWarnings(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span>I understand completed sessions will remain at previous dates.</span>
                      </label>
                    )}
                </div>
              )}

              {preview.session_summary?.phases?.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-gray-900">Phase session dates</h3>
                  <div
                    className="overflow-x-auto rounded-lg border border-gray-200"
                    style={{
                      scrollbarWidth: 'thin',
                      scrollbarColor: '#cbd5e0 #f7fafc',
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
                    <table style={{ width: '100%', minWidth: '480px' }} className="divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Phase</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">First session</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Last session</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Count</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {preview.session_summary.phases.map((phase) => (
                          <tr key={phase.phase_number}>
                            <td className="px-3 py-2">Phase {phase.phase_number}</td>
                            <td className="px-3 py-2">{formatYmd(phase.first_session_date)}</td>
                            <td className="px-3 py-2">{formatYmd(phase.last_session_date)}</td>
                            <td className="px-3 py-2">{phase.session_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">Billing impact</h3>
                {billingRows.length === 0 ? (
                  <p className="text-sm text-gray-500">No installment billing changes required.</p>
                ) : (
                  <div
                    className="overflow-x-auto rounded-lg border border-gray-200"
                    style={{
                      scrollbarWidth: 'thin',
                      scrollbarColor: '#cbd5e0 #f7fafc',
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
                    <table style={{ width: '100%', minWidth: '720px' }} className="divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Student</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Changes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {billingRows.map((row) => (
                          <tr key={row.profile_id}>
                            <td className="px-3 py-2 align-top">
                              <div className="font-medium text-gray-900">{row.student_name}</div>
                              <div className="text-xs text-gray-500">{row.student_email}</div>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <ul className="space-y-1 text-xs text-gray-700">
                                {(row.changes || []).map((change, idx) => {
                                  if (change.type === 'update_phase_invoice' || change.type === 'update_downpayment') {
                                    return (
                                      <li key={idx}>
                                        {change.invoice_ar_number || `Invoice ${change.invoice_id}`}: due{' '}
                                        {formatYmd(change.old_due_date)} → {formatYmd(change.new_due_date)}
                                        {change.clear_penalty ? ' (penalty cleared)' : ''}
                                      </li>
                                    );
                                  }
                                  if (change.type === 'delete_premature_invoice') {
                                    return (
                                      <li key={idx} className="text-red-700">
                                        Delete premature invoice {change.invoice_ar_number || change.invoice_id}
                                      </li>
                                    );
                                  }
                                  if (change.type === 'restore_enrollment') {
                                    return (
                                      <li key={idx} className="text-emerald-700">
                                        Restore enrollment ({change.new_status})
                                      </li>
                                    );
                                  }
                                  if (change.type === 'rebuild_queue') {
                                    return (
                                      <li key={idx}>
                                        {change.message ||
                                          `Queue: ${change.old_next_generation_date || '—'} → ${change.new_next_generation_date}`}
                                      </li>
                                    );
                                  }
                                  if (change.type === 'warning') {
                                    return (
                                      <li key={idx} className="text-amber-700">
                                        {change.message}
                                      </li>
                                    );
                                  }
                                  return (
                                    <li key={idx}>
                                      {change.type}
                                      {change.old_value != null ? `: ${change.old_value} → ${change.new_value}` : ''}
                                    </li>
                                  );
                                })}
                              </ul>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'result' && applyResult && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-medium text-emerald-900">Start date adjusted successfully</p>
                <p className="mt-1 text-sm text-emerald-800">
                  {formatYmd(applyResult.current_start_date)} → {formatYmd(applyResult.new_start_date)}
                  {applyResult.new_end_date ? ` · End date: ${formatYmd(applyResult.new_end_date)}` : ''}
                </p>
              </div>
              {applyResult.billing_summary && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <span className="text-gray-500">Invoices updated</span>
                    <p className="font-medium">{applyResult.billing_summary.invoices_updated ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <span className="text-gray-500">Penalties cleared</span>
                    <p className="font-medium">{applyResult.billing_summary.penalties_cleared ?? 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <span className="text-gray-500">Enrollments restored</span>
                    <p className="font-medium">{applyResult.billing_summary.enrollments_restored ?? 0}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
          {step === 'input' && (
            <>
              <button type="button" onClick={handleClose} className="btn-secondary px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={loadingPreview || !newStartDate || !reason.trim()}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {loadingPreview ? 'Loading preview…' : 'Preview impact'}
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button type="button" onClick={() => setStep('input')} className="btn-secondary px-4 py-2 text-sm">
                Back
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={loadingApply || !preview?.can_apply || !reason.trim()}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {loadingApply ? 'Applying…' : 'Apply adjustment'}
              </button>
            </>
          )}
          {step === 'result' && (
            <button type="button" onClick={handleClose} className="btn-primary px-4 py-2 text-sm">
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ClassStartDateAdjustmentModal;
