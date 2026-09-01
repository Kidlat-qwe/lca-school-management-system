import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';

/** End-user groups shown as expandable sections (Superadmin excluded). */
const END_USER_SECTIONS = [
  {
    id: 'Admin',
    label: 'Admin',
    buildQuery: () => 'user_type=Admin',
  },
  {
    id: 'Teacher',
    label: 'Teacher',
    buildQuery: () => 'user_type=Teacher',
  },
  {
    id: 'Student',
    label: 'Student',
    buildQuery: () => 'user_type=Student',
  },
  {
    id: 'Finance',
    label: 'Finance',
    buildQuery: () => 'user_type=Finance',
    filterUser: (user) => user.branch_id != null && user.branch_id !== '',
  },
  {
    id: 'Superfinance',
    label: 'Superfinance',
    buildQuery: () => 'display_role=Superfinance',
  },
];

async function fetchAllUsers(queryString) {
  const rows = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const res = await apiRequest(`/users?${queryString}&page=${page}&limit=100`);
    rows.push(...(res.data || res.users || []));
    totalPages = Number(res.pagination?.totalPages) || 1;
    page += 1;
  }

  return rows;
}

function normalizeUserRow(user, branchNameById) {
  const branchId = user.branch_id != null ? Number(user.branch_id) : null;
  return {
    ...user,
    user_id: Number(user.user_id || user.userId),
    user_type: user.user_type || user.userType || '',
    branch_id: branchId,
    branch_label:
      branchId != null
        ? branchNameById.get(branchId) || `Branch ${branchId}`
        : 'No branch assigned',
  };
}

/**
 * Superadmin Settings → Announcements:
 * All users, or pick specific users grouped by end-user type (accordion + select all per type).
 */
export default function AnnouncementCreatorsPanel() {
  const [allowAllUsers, setAllowAllUsers] = useState(false);
  const [creatorIds, setCreatorIds] = useState([]);
  const [usersBySection, setUsersBySection] = useState({});
  const [expandedSections, setExpandedSections] = useState({});
  const [sectionSearch, setSectionSearch] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingSection, setLoadingSection] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const creatorSet = useMemo(() => new Set(creatorIds.map(Number)), [creatorIds]);

  const loadSectionUsers = useCallback(async (section, branchNameById) => {
    setLoadingSection((prev) => ({ ...prev, [section.id]: true }));
    try {
      const raw = await fetchAllUsers(section.buildQuery());
      const filtered = section.filterUser ? raw.filter(section.filterUser) : raw;
      const normalized = filtered.map((u) => normalizeUserRow(u, branchNameById));
      setUsersBySection((prev) => ({ ...prev, [section.id]: normalized }));
      return normalized;
    } finally {
      setLoadingSection((prev) => ({ ...prev, [section.id]: false }));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [configRes, branchesRes] = await Promise.all([
        apiRequest('/announcements/creators'),
        apiRequest('/branches?limit=100'),
      ]);

      const config = configRes.data || {};
      const branches = branchesRes.data || branchesRes.branches || [];
      const branchNameById = new Map(
        branches.map((b) => [Number(b.branch_id), b.branch_name || b.name || `Branch ${b.branch_id}`])
      );

      const isAll = config.mode === 'all';
      setAllowAllUsers(isAll);

      let initialCreatorIds = (config.user_ids || []).map(Number);
      const nextExpanded = {};

      if (!isAll) {
        if (config.mode === 'roles' && Array.isArray(config.roles) && config.roles.length) {
          for (const section of END_USER_SECTIONS) {
            if (!config.roles.includes(section.id)) continue;
            const users = await loadSectionUsers(section, branchNameById);
            users.forEach((u) => initialCreatorIds.push(Number(u.user_id)));
            nextExpanded[section.id] = true;
          }
          initialCreatorIds = [...new Set(initialCreatorIds)];
        } else if (initialCreatorIds.length > 0) {
          const sectionLoads = await Promise.all(
            END_USER_SECTIONS.map(async (section) => {
              const users = await loadSectionUsers(section, branchNameById);
              return { sectionId: section.id, users };
            })
          );
          for (const { sectionId, users } of sectionLoads) {
            if (users.some((u) => initialCreatorIds.includes(Number(u.user_id)))) {
              nextExpanded[sectionId] = true;
            }
          }
        }
        setExpandedSections(nextExpanded);
      } else {
        setExpandedSections({});
        setUsersBySection({});
      }

      setCreatorIds(initialCreatorIds);
    } catch (err) {
      setError(err.message || 'Failed to load announcement settings');
    } finally {
      setLoading(false);
    }
  }, [loadSectionUsers]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSection = async (section) => {
    const nextOpen = !expandedSections[section.id];
    setExpandedSections((prev) => ({ ...prev, [section.id]: nextOpen }));

    if (nextOpen && !usersBySection[section.id]?.length) {
      const branchesRes = await apiRequest('/branches?limit=100');
      const branches = branchesRes.data || branchesRes.branches || [];
      const branchNameById = new Map(
        branches.map((b) => [Number(b.branch_id), b.branch_name || b.name || `Branch ${b.branch_id}`])
      );
      await loadSectionUsers(section, branchNameById);
    }
  };

  const toggleCreator = (userId) => {
    const id = Number(userId);
    setCreatorIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllInSection = (sectionId) => {
    const users = usersBySection[sectionId] || [];
    const ids = users.map((u) => Number(u.user_id)).filter((id) => Number.isFinite(id));
    setCreatorIds((prev) => [...new Set([...prev, ...ids])]);
  };

  const clearAllInSection = (sectionId) => {
    const ids = new Set((usersBySection[sectionId] || []).map((u) => Number(u.user_id)));
    setCreatorIds((prev) => prev.filter((id) => !ids.has(id)));
  };

  const sectionSelectedCount = (sectionId) => {
    const users = usersBySection[sectionId] || [];
    return users.filter((u) => creatorSet.has(Number(u.user_id))).length;
  };

  const filteredSectionUsers = (sectionId) => {
    const q = String(sectionSearch[sectionId] || '').trim().toLowerCase();
    const users = usersBySection[sectionId] || [];
    if (!q) return users;
    return users.filter((u) => {
      const hay = `${u.full_name || ''} ${u.email || ''} ${u.branch_label || ''}`.toLowerCase();
      return hay.includes(q);
    });
  };

  const save = async () => {
    try {
      setSaving(true);
      setError('');
      setSuccess('');

      if (!allowAllUsers && creatorIds.length === 0) {
        setError('Select “All users”, or choose at least one user from the end-user groups below.');
        return;
      }

      const res = await apiRequest('/announcements/creators', {
        method: 'PUT',
        body: JSON.stringify({
          mode: allowAllUsers ? 'all' : 'specific',
          roles: [],
          user_ids: allowAllUsers ? [] : creatorIds,
        }),
      });

      const data = res.data || {};
      setAllowAllUsers(data.mode === 'all');
      setCreatorIds((data.user_ids || []).map(Number));
      setSuccess('Announcement creator permissions saved.');
    } catch (err) {
      setError(err.message || 'Failed to save announcement settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500">Loading announcement settings…</p>;
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
        <h3 className="text-lg font-semibold text-gray-900">Announcement creators</h3>
        <p className="mt-1 text-sm text-gray-500">
          Control who may create and manage board announcements from the Announcements page.
          Superadmin users always have full access and do not need to be configured here.
        </p>

        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Superadmins can always create, edit, and delete any announcement.
        </div>

        <div className="mt-5">
          <label
            className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
              allowAllUsers ? 'border-primary-500 bg-primary-50/40' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <input
              type="checkbox"
              checked={allowAllUsers}
              onChange={(e) => setAllowAllUsers(e.target.checked)}
              className="mt-1 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Allow all users</span>
              <span className="mt-0.5 block text-xs text-gray-500">
                Any authenticated user (Admin, Teacher, Student, Finance, etc.) may create announcements.
              </span>
            </span>
          </label>
        </div>

        {!allowAllUsers && (
          <div className="mt-6">
            <h4 className="text-sm font-semibold text-gray-800">End users who can create announcements</h4>
            <p className="mt-1 text-xs text-gray-500">
              Expand a user type to see everyone in that group. Use Select all to grant every user in that
              type only, or pick individual users.
            </p>

            <div className="mt-4 space-y-3">
              {END_USER_SECTIONS.map((section) => {
                const open = Boolean(expandedSections[section.id]);
                const total = (usersBySection[section.id] || []).length;
                const selected = sectionSelectedCount(section.id);
                const isLoadingSection = Boolean(loadingSection[section.id]);
                const users = filteredSectionUsers(section.id);
                const allSelected = total > 0 && selected === total;

                return (
                  <div
                    key={section.id}
                    className="overflow-hidden rounded-lg border border-gray-200 bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSection(section)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <div className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">{section.label}</span>
                        <span className="block text-xs text-gray-500">
                          {selected > 0 ? `${selected} selected` : 'No users selected'}
                          {total > 0 ? ` · ${total} user(s)` : open && !isLoadingSection ? ' · No users found' : ''}
                        </span>
                      </div>
                      <svg
                        className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {open && (
                      <div className="border-t border-gray-200 px-4 py-3">
                        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={isLoadingSection || total === 0}
                              onClick={() => selectAllInSection(section.id)}
                              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Select all {section.label}
                            </button>
                            <button
                              type="button"
                              disabled={selected === 0}
                              onClick={() => clearAllInSection(section.id)}
                              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Clear {section.label}
                            </button>
                          </div>
                          <input
                            type="search"
                            value={sectionSearch[section.id] || ''}
                            onChange={(e) =>
                              setSectionSearch((prev) => ({ ...prev, [section.id]: e.target.value }))
                            }
                            placeholder={`Search ${section.label.toLowerCase()}…`}
                            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 sm:max-w-xs"
                          />
                        </div>

                        {isLoadingSection ? (
                          <p className="text-sm text-gray-500">Loading {section.label.toLowerCase()} users…</p>
                        ) : users.length === 0 ? (
                          <p className="text-sm text-gray-500">No {section.label.toLowerCase()} users found.</p>
                        ) : (
                          <div
                            className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/50 p-2"
                            style={{
                              scrollbarWidth: 'thin',
                              scrollbarColor: '#cbd5e0 #f7fafc',
                              WebkitOverflowScrolling: 'touch',
                            }}
                          >
                            {allSelected && (
                              <p className="px-2 py-1 text-xs font-medium text-primary-700">
                                All {section.label} users are selected.
                              </p>
                            )}
                            {users.map((u) => {
                              const id = Number(u.user_id);
                              const checked = creatorSet.has(id);
                              return (
                                <label
                                  key={id}
                                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleCreator(id)}
                                    className="mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                  />
                                  <span className="min-w-0 text-sm text-gray-800">
                                    <span className="font-medium">{u.full_name || u.email}</span>
                                    {u.email ? <span className="text-gray-400"> · {u.email}</span> : null}
                                    <span className="mt-0.5 block text-xs text-gray-500">
                                      {u.branch_label || 'No branch assigned'}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="mt-3 text-xs text-gray-500">{creatorIds.length} user(s) selected in total</p>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save announcement permissions'}
          </button>
        </div>
      </section>
    </div>
  );
}
