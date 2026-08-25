import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';

/**
 * Superadmin Settings → Lesson Plans:
 * configure which Superadmin / Admin users may verify teacher lesson plans.
 * - Superadmin verifiers: all branches
 * - Admin verifiers: only their designated branch
 * Review UI: /superadmin/lesson-plans or /admin/lesson-plans
 */
export default function LessonPlanSettingsPanel() {
  const [candidates, setCandidates] = useState([]);
  const [verifierIds, setVerifierIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingVerifiers, setSavingVerifiers] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const verifierSet = useMemo(() => new Set(verifierIds.map(Number)), [verifierIds]);

  const { superadmins, admins } = useMemo(() => {
    const sa = [];
    const ad = [];
    for (const u of candidates) {
      const type = u.user_type || u.userType;
      if (type === 'Admin') ad.push(u);
      else sa.push(u);
    }
    return { superadmins: sa, admins: ad };
  }, [candidates]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [saRes, adminRes, branchesRes, verifiersRes] = await Promise.all([
        apiRequest('/users?user_type=Superadmin&limit=100'),
        apiRequest('/users?user_type=Admin&limit=100'),
        apiRequest('/branches?limit=100'),
        apiRequest('/lesson-plans/verifiers'),
      ]);
      const saUsers = saRes.data || saRes.users || [];
      const adminUsers = adminRes.data || adminRes.users || [];
      const branches = branchesRes.data || branchesRes.branches || [];
      const branchNameById = new Map(
        branches.map((b) => [Number(b.branch_id), b.branch_name || b.name || `Branch ${b.branch_id}`])
      );

      const merged = [
        ...saUsers.map((u) => ({
          ...u,
          user_type: 'Superadmin',
          branch_label: null,
        })),
        ...adminUsers.map((u) => {
          const branchId = u.branch_id != null ? Number(u.branch_id) : null;
          return {
            ...u,
            user_type: 'Admin',
            branch_id: branchId,
            branch_label:
              branchId != null
                ? branchNameById.get(branchId) || `Branch ${branchId}`
                : 'No branch assigned',
          };
        }),
      ];

      setCandidates(merged);
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
        'Lesson plan verifiers saved. Selected Superadmins and Admins will see Lesson Plans in the sidebar after they refresh the page. Admin verifiers only review plans from their designated branch.'
      );
    } catch (err) {
      setError(err.message || 'Failed to save verifiers');
    } finally {
      setSavingVerifiers(false);
    }
  };

  const renderUserRow = (u) => {
    const id = Number(u.user_id || u.userId);
    const checked = verifierSet.has(id);
    const isAdmin = (u.user_type || u.userType) === 'Admin';
    const noBranch = isAdmin && (u.branch_id == null || u.branch_id === '');
    return (
      <label
        key={id}
        className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50 ${
          noBranch ? 'opacity-60' : ''
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={noBranch}
          onChange={() => toggleVerifier(id)}
          className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <span className="text-sm text-gray-800">
          <span className="font-medium">{u.full_name || u.fullName || u.email}</span>
          {u.email ? <span className="text-gray-400"> · {u.email}</span> : null}
          {isAdmin ? (
            <span className="mt-0.5 block text-xs text-gray-500">
              Branch: {u.branch_label || '—'}
              {noBranch ? ' (assign a branch before selecting as verifier)' : ''}
            </span>
          ) : (
            <span className="mt-0.5 block text-xs text-gray-500">All branches</span>
          )}
        </span>
      </label>
    );
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
          Select Superadmin and Admin users who may approve or request revision on submitted lesson
          plans. Superadmin verifiers can review all branches. Admin verifiers can only review
          lesson plans from their designated branch. Verifiers get a dedicated{' '}
          <span className="font-medium text-gray-700">Lesson Plans</span> page in the sidebar.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-gray-800">Superadmin</h4>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3">
              {superadmins.length === 0 ? (
                <p className="text-sm text-gray-500">No Superadmin users found.</p>
              ) : (
                superadmins.map(renderUserRow)
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold text-gray-800">Admin (by branch)</h4>
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3">
              {admins.length === 0 ? (
                <p className="text-sm text-gray-500">No Admin users found.</p>
              ) : (
                admins.map(renderUserRow)
              )}
            </div>
          </div>
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
