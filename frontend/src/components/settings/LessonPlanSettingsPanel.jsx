import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';

/**
 * Superadmin Settings → Lesson Plans:
 * configure which Superadmin users may verify teacher lesson plans.
 * Review UI lives on /superadmin/lesson-plans (verifiers only).
 */
export default function LessonPlanSettingsPanel() {
  const [superadmins, setSuperadmins] = useState([]);
  const [verifierIds, setVerifierIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingVerifiers, setSavingVerifiers] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const verifierSet = useMemo(() => new Set(verifierIds.map(Number)), [verifierIds]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [usersRes, verifiersRes] = await Promise.all([
        apiRequest('/users?user_type=Superadmin&limit=100'),
        apiRequest('/lesson-plans/verifiers'),
      ]);
      const users = usersRes.data || usersRes.users || [];
      setSuperadmins(users);
      setVerifierIds((verifiersRes.data || []).map((v) => Number(v.user_id)));
    } catch (err) {
      setError(err.message || 'Failed to load lesson plan settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleVerifier = (userId) => {
    const id = Number(userId);
    setVerifierIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const saveVerifiers = async () => {
    try {
      setSavingVerifiers(true);
      setError('');
      setSuccess('');
      const res = await apiRequest('/lesson-plans/verifiers', {
        method: 'PUT',
        body: JSON.stringify({ user_ids: verifierIds }),
      });
      setVerifierIds((res.data || []).map((v) => Number(v.user_id)));
      setSuccess(
        'Lesson plan verifiers saved. Selected Superadmins will see Lesson Plans in the sidebar after they refresh the page.'
      );
    } catch (err) {
      setError(err.message || 'Failed to save verifiers');
    } finally {
      setSavingVerifiers(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Loading lesson plan settings…</p>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {success}
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <h3 className="text-lg font-semibold text-gray-900">Lesson plan verifiers</h3>
        <p className="mt-1 text-sm text-gray-500">
          Select which Superadmin users may approve or request revision on submitted lesson plans.
          Only Superadmin accounts can be chosen. Verifiers get a dedicated{' '}
          <span className="font-medium text-gray-700">Lesson Plans</span> page in the sidebar.
        </p>
        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3">
          {superadmins.length === 0 ? (
            <p className="text-sm text-gray-500">No Superadmin users found.</p>
          ) : (
            superadmins.map((u) => {
              const id = Number(u.user_id || u.userId);
              const checked = verifierSet.has(id);
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleVerifier(id)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-800">
                    {u.full_name || u.fullName || u.email}
                    {u.email ? (
                      <span className="text-gray-400"> · {u.email}</span>
                    ) : null}
                  </span>
                </label>
              );
            })
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={savingVerifiers}
            onClick={saveVerifiers}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {savingVerifiers ? 'Saving…' : 'Save verifiers'}
          </button>
        </div>
      </section>
    </div>
  );
}
