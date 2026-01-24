import { useEffect, useState } from 'react';
import { apiRequest } from '../../config/api';

const AdminGuardians = () => {
  const [guardians, setGuardians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingGuardian, setEditingGuardian] = useState(null);
  const [editForm, setEditForm] = useState({
    guardian_name: '',
    email: '',
    relationship: '',
    address: '',
    student_id: '',
  });
  const [students, setStudents] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchGuardians = async () => {
      setLoading(true);
      setError('');
      try {
        // Backend automatically filters by admin's branch through students
        const response = await apiRequest('/guardians');
        setGuardians(response.data || []);
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Failed to load guardians');
      } finally {
        setLoading(false);
      }
    };

    const fetchStudents = async () => {
      try {
        // Backend automatically filters by admin's branch
        const response = await apiRequest('/students?limit=1000');
        setStudents(response.data || []);
      } catch (err) {
        console.error('Failed to load students', err);
      }
    };

    fetchGuardians();
    fetchStudents();
  }, []);

  const filtered = guardians.filter((g) => {
    const term = searchTerm.toLowerCase();
    return (
      g.guardian_name?.toLowerCase().includes(term) ||
      g.email?.toLowerCase().includes(term) ||
      g.relationship?.toLowerCase().includes(term) ||
      g.address?.toLowerCase().includes(term) ||
      g.student_name?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Student Guardians</h1>
          <p className="text-sm text-gray-600">View all guardians linked to students in your branch.</p>
        </div>
        <div className="w-full sm:w-64">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search guardian, email, student..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#F7C844] focus:ring-[#F7C844]"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500">No guardians found.</div>
        ) : (
          <div
            className="overflow-x-auto rounded-lg"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <table
              className="divide-y divide-gray-200"
              style={{ width: '100%', minWidth: '900px' }}
            >
              <thead className="bg-white">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Guardian Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Relationship
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Address
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Student Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filtered.map((g) => (
                  <tr key={g.guardian_id || `${g.student_id}-${g.guardian_name}`}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{g.guardian_name || '-'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{g.email || '-'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{g.relationship || '-'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{g.address || '-'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{g.student_name || '-'}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingGuardian(g);
                          setEditForm({
                            guardian_name: g.guardian_name || '',
                            email: g.email || '',
                            relationship: g.relationship || '',
                            address: g.address || '',
                            student_id: g.student_id || '',
                          });
                        }}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingGuardian && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4" onClick={() => setEditingGuardian(null)}>
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Edit Guardian</h3>
                <p className="text-sm text-gray-500">{editingGuardian.guardian_name}</p>
              </div>
              <button
                onClick={() => setEditingGuardian(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="label-field text-xs">Guardian Name</label>
                <input
                  type="text"
                  className="input-field text-sm"
                  value={editForm.guardian_name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, guardian_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="label-field text-xs">Email</label>
                <input
                  type="email"
                  className="input-field text-sm"
                  value={editForm.email}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="label-field text-xs">Relationship</label>
                  <input
                    type="text"
                    className="input-field text-sm"
                    value={editForm.relationship}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, relationship: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label-field text-xs">Student</label>
                  <select
                    className="input-field text-sm"
                    value={editForm.student_id}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, student_id: e.target.value }))}
                  >
                    <option value="">Select Student</option>
                    {students.map((s) => (
                      <option key={s.user_id} value={s.user_id}>
                        {s.full_name || s.email || s.user_id}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label-field text-xs">Address</label>
                <input
                  type="text"
                  className="input-field text-sm"
                  value={editForm.address}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, address: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setEditingGuardian(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!editingGuardian) return;
                  setSaving(true);
                  try {
                    await apiRequest(`/guardians/${editingGuardian.guardian_id}`, {
                      method: 'PUT',
                      body: JSON.stringify({
                        guardian_name: editForm.guardian_name?.trim(),
                        email: editForm.email?.trim(),
                        relationship: editForm.relationship?.trim(),
                        address: editForm.address?.trim(),
                        student_id: editForm.student_id ? parseInt(editForm.student_id, 10) : null,
                      }),
                    });
                    const response = await apiRequest('/guardians');
                    setGuardians(response.data || []);
                    setEditingGuardian(null);
                  } catch (err) {
                    alert(err.response?.data?.message || err.message || 'Failed to update guardian');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition disabled:opacity-60"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminGuardians;

