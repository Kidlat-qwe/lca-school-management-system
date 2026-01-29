import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';

const AdminSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [effective, setEffective] = useState(null);
  const [branchId, setBranchId] = useState(null);

  const [penaltyRatePercent, setPenaltyRatePercent] = useState('10');
  const [graceDays, setGraceDays] = useState('0');
  const [finalDropoffDays, setFinalDropoffDays] = useState('30');

  const fetchEffectiveSettings = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const params = new URLSearchParams();
      params.set('category', 'billing');
      const res = await apiRequest(`/settings/effective?${params.toString()}`, { method: 'GET' });
      setBranchId(res?.data?.branch_id ?? null);

      const settings = res?.data?.settings || {};
      setEffective(settings);

      const rateDecimal = Number(settings?.installment_penalty_rate?.value);
      const ratePct = Number.isFinite(rateDecimal) ? (rateDecimal * 100).toFixed(0) : '10';
      setPenaltyRatePercent(ratePct);

      const g = Number(settings?.installment_penalty_grace_days?.value);
      setGraceDays(Number.isFinite(g) ? String(g) : '0');

      const d = Number(settings?.installment_final_dropoff_days?.value);
      setFinalDropoffDays(Number.isFinite(d) ? String(d) : '30');
    } catch (e) {
      setError(e?.message || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEffectiveSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scopeMeta = useMemo(() => {
    const meta = {};
    for (const [k, v] of Object.entries(effective || {})) {
      meta[k] = v?.scope || 'default';
    }
    return meta;
  }, [effective]);

  const onSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const ratePct = Number(penaltyRatePercent);
      if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
        throw new Error('Penalty rate (%) must be between 0 and 100');
      }
      const rateDecimal = ratePct / 100;

      const grace = Number.parseInt(graceDays, 10);
      if (!Number.isFinite(grace) || grace < 0 || grace > 365) {
        throw new Error('Grace period (days) must be between 0 and 365');
      }

      const drop = Number.parseInt(finalDropoffDays, 10);
      if (!Number.isFinite(drop) || drop < 0 || drop > 365) {
        throw new Error('Final drop-off (days) must be between 0 and 365');
      }

      await apiRequest('/settings/batch', {
        method: 'PUT',
        body: {
          scope: 'branch',
          settings: {
            installment_penalty_rate: rateDecimal,
            installment_penalty_grace_days: grace,
            installment_final_dropoff_days: drop,
          },
        },
      });

      setSuccess('Settings saved successfully.');
      await fetchEffectiveSettings();
    } catch (e) {
      setError(e?.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-600">
            Branch settings{branchId ? ` (Branch ID: ${branchId})` : ''}. First release: Billing / Installments.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Billing / Installments</h2>
            <p className="mt-1 text-sm text-gray-600">
              These settings control late penalties and auto-removals for installment invoices.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              {success}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Penalty rate (%)</label>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="1"
                value={penaltyRatePercent}
                onChange={(e) => setPenaltyRatePercent(e.target.value)}
                disabled={loading || saving}
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
              <p className="mt-2 text-xs text-gray-500">
                Source: <span className="font-medium">{scopeMeta.installment_penalty_rate || 'default'}</span>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Grace period (days)</label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="365"
                step="1"
                value={graceDays}
                onChange={(e) => setGraceDays(e.target.value)}
                disabled={loading || saving}
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
              <p className="mt-2 text-xs text-gray-500">
                Source:{' '}
                <span className="font-medium">{scopeMeta.installment_penalty_grace_days || 'default'}</span>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Final drop-off (days)</label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="365"
                step="1"
                value={finalDropoffDays}
                onChange={(e) => setFinalDropoffDays(e.target.value)}
                disabled={loading || saving}
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]/30 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
              <p className="mt-2 text-xs text-gray-500">
                Source:{' '}
                <span className="font-medium">{scopeMeta.installment_final_dropoff_days || 'default'}</span>
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-gray-500">
              Note: Penalty rate is stored as a decimal in the system (e.g., 10% = 0.10).
            </p>
            <button
              type="button"
              onClick={onSave}
              disabled={loading || saving}
              className="inline-flex w-full items-center justify-center rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminSettings;

