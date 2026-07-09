import { formatDateManila } from '../../utils/dateUtils';

const formatYmd = (value) => {
  if (!value) return '—';
  return formatDateManila(value);
};

const ClassStartDateAdjustmentPreviewPanel = ({
  preview,
  loading = false,
  acknowledgeWarnings = false,
  onAcknowledgeWarningsChange,
}) => {
  if (loading && !preview) {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-white/60 p-4 text-sm text-amber-900">
        Loading impact preview…
      </div>
    );
  }

  if (!preview) return null;

  const billingRows = (preview.billing_impacts || []).filter((row) => !row.skipped && row.changes?.length);

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <p className="text-xs text-gray-500">Current start</p>
          <p className="text-sm font-medium text-gray-900">{formatYmd(preview.current_start_date)}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-700">New start</p>
          <p className="text-sm font-medium text-amber-900">{formatYmd(preview.new_start_date)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <p className="text-xs text-gray-500">New end</p>
          <p className="text-sm font-medium text-gray-900">{formatYmd(preview.new_end_date)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <p className="text-xs text-gray-500">Sessions</p>
          <p className="text-sm font-medium text-gray-900">{preview.session_summary?.total_sessions ?? '—'}</p>
        </div>
      </div>

      {(preview.blockers || []).length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-800">Cannot update until resolved</p>
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
            preview.warnings.some((w) => w.code === 'completed_sessions_with_attendance') &&
            typeof onAcknowledgeWarningsChange === 'function' && (
              <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={acknowledgeWarnings}
                  onChange={(e) => onAcknowledgeWarningsChange(e.target.checked)}
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
            className="overflow-x-auto rounded-lg border border-gray-200 bg-white"
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
            className="overflow-x-auto rounded-lg border border-gray-200 bg-white"
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
  );
};

export default ClassStartDateAdjustmentPreviewPanel;
