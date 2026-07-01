import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { formatDateManila } from '../../utils/dateUtils';
import { fetchAllInstallmentInvoicePages } from '../../utils/fetchAllInstallmentInvoicePages';
import { appAlert, appConfirm } from '../../utils/appAlert';
import InstallmentPlanDetails from '../installmentInvoice/InstallmentPlanDetails';
import StudentAttendancePanel from './StudentAttendancePanel';

const TABS = [
  {
    id: 'student',
    label: 'Student info',
    iconPath:
      'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  },
  {
    id: 'guardian',
    label: 'Guardian info',
    iconPath:
      'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6 5.87v-2a4 4 0 00-4-4H8m9-4a4 4 0 11-8 0 4 4 0 018 0z',
  },
  {
    id: 'classes',
    label: 'Enrolled class',
    iconPath:
      'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
  },
  {
    id: 'attendance',
    label: 'Attendance',
    iconPath:
      'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    id: 'invoices',
    label: 'Invoices',
    iconPath:
      'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
];

const LEVEL_TAG_OPTIONS = [
  'Playgroup',
  'Nursery',
  'Pre-Kindergarten',
  'Kindergarten',
  'Grade School',
];

const GENDER_OPTIONS = ['Male', 'Female', 'Other'];

const ReadOnlyField = ({ label, value, multiline = false }) => {
  const display = value === null || value === undefined || value === '' ? '—' : value;
  const isEmpty = display === '—';
  return (
    <div className="min-w-0">
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div
        className={[
          'w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm shadow-sm',
          multiline ? 'min-h-[64px] whitespace-pre-wrap break-words' : 'truncate',
          isEmpty ? 'text-gray-400 italic' : 'text-gray-900',
        ].join(' ')}
        title={isEmpty || multiline ? undefined : String(display)}
      >
        {display}
      </div>
    </div>
  );
};

const inputBaseClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm text-gray-900 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 focus:outline-none disabled:bg-gray-50 disabled:cursor-not-allowed';

const EditableField = ({
  label,
  name,
  value,
  onChange,
  type = 'text',
  options = null,
  disabled = false,
  required = false,
  placeholder = '',
  error = '',
  multiline = false,
  rows = 2,
  idPrefix = 'student-edit',
}) => {
  const idForInput = `${idPrefix}-${name}`;
  const errorClass = error
    ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
    : '';
  return (
    <div className="min-w-0">
      <label htmlFor={idForInput} className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </label>
      {options ? (
        <select
          id={idForInput}
          name={name}
          value={value ?? ''}
          onChange={onChange}
          disabled={disabled}
          className={`${inputBaseClass} ${errorClass}`}
        >
          <option value="">— Select —</option>
          {options.map((opt) => (
            <option key={typeof opt === 'object' ? opt.value : opt} value={typeof opt === 'object' ? opt.value : opt}>
              {typeof opt === 'object' ? opt.label : opt}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea
          id={idForInput}
          name={name}
          value={value ?? ''}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          rows={rows}
          className={`${inputBaseClass} resize-y ${errorClass}`}
        />
      ) : (
        <input
          id={idForInput}
          name={name}
          type={type}
          value={value ?? ''}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          className={`${inputBaseClass} ${errorClass}`}
        />
      )}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
};

const GUARDIAN_RELATIONSHIPS = [
  'Parent',
  'Guardian',
  'Grandparent',
  'Sibling',
  'Other',
];

const buildGuardianForm = (g) => ({
  guardian_name: g?.guardian_name || '',
  email: g?.email || '',
  relationship: g?.relationship || '',
  guardian_phone_number: g?.guardian_phone_number || '',
  tin_number: g?.tin_number || '',
  gender: g?.gender || '',
  address: g?.address || '',
  city: g?.city || '',
  postal_code: g?.postal_code || '',
  state_province_region: g?.state_province_region || '',
  country: g?.country || '',
});

const isGuardianFormDirty = (form, baseline) =>
  Object.keys(buildGuardianForm(null)).some(
    (k) => (form[k] ?? '') !== (baseline[k] ?? '')
  );

const GuardianEditCard = ({ guardian, onUpdated, onDirtyChange }) => {
  const [formData, setFormData] = useState(buildGuardianForm(guardian));
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormData(buildGuardianForm(guardian));
    setFormErrors({});
  }, [guardian]);

  const baseline = useMemo(() => buildGuardianForm(guardian), [guardian]);
  const dirty = useMemo(() => isGuardianFormDirty(formData, baseline), [formData, baseline]);

  useEffect(() => {
    onDirtyChange?.(guardian?.guardian_id, dirty);
    return () => {
      onDirtyChange?.(guardian?.guardian_id, false);
    };
  }, [dirty, guardian?.guardian_id, onDirtyChange]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (formErrors._submit) {
      setFormErrors((prev) => ({ ...prev, _submit: '' }));
    }
  };

  const validate = () => {
    const errs = {};
    if (!formData.guardian_name.trim()) errs.guardian_name = 'Guardian name is required';
    const emailVal = formData.email.trim();
    if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
      errs.email = 'Enter a valid email';
    }
    return errs;
  };

  const handleSave = async () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }
    if (!guardian?.guardian_id) return;
    setSaving(true);
    try {
      const payload = {
        guardian_name: formData.guardian_name.trim(),
        email: formData.email.trim() || null,
        relationship: formData.relationship || null,
        guardian_phone_number: formData.guardian_phone_number.trim() || null,
        tin_number: formData.tin_number.trim() || null,
        gender: formData.gender || null,
        address: formData.address.trim() || null,
        city: formData.city.trim() || null,
        postal_code: formData.postal_code.trim() || null,
        country: formData.country.trim() || null,
        state_province_region: formData.state_province_region.trim() || null,
      };
      const res = await apiRequest(`/guardians/${guardian.guardian_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const updated = res?.data || null;
      onUpdated?.(updated);
      if (updated) {
        setFormData(buildGuardianForm(updated));
      }
      setFormErrors({});
      appAlert('Guardian details updated successfully.');
    } catch (err) {
      console.error('Save guardian error:', err);
      const message = err?.response?.data?.message || err?.message || 'Failed to update guardian.';
      setFormErrors((prev) => ({ ...prev, _submit: message }));
    } finally {
      setSaving(false);
    }
  };

  const idPrefix = `guardian-${guardian?.guardian_id ?? 'new'}-edit`;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-900 truncate">
            {guardian?.guardian_name || 'Guardian'}
          </h4>
          {guardian?.relationship && (
            <p className="text-xs text-gray-500 mt-0.5">{guardian.relationship}</p>
          )}
        </div>
        {dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Unsaved changes
          </span>
        )}
      </div>

      {formErrors._submit && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {formErrors._submit}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EditableField
          idPrefix={idPrefix}
          label="Guardian name"
          name="guardian_name"
          value={formData.guardian_name}
          onChange={handleChange}
          required
          disabled={saving}
          error={formErrors.guardian_name}
        />
        <EditableField
          idPrefix={idPrefix}
          label="Email"
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          disabled={saving}
          error={formErrors.email}
        />
        <EditableField
          idPrefix={idPrefix}
          label="Relationship"
          name="relationship"
          value={formData.relationship}
          onChange={handleChange}
          options={GUARDIAN_RELATIONSHIPS}
          disabled={saving}
        />
        <EditableField
          idPrefix={idPrefix}
          label="Phone"
          name="guardian_phone_number"
          type="tel"
          value={formData.guardian_phone_number}
          onChange={handleChange}
          disabled={saving}
          placeholder="e.g. +639123456789"
        />
        <EditableField
          idPrefix={idPrefix}
          label="TIN"
          name="tin_number"
          value={formData.tin_number}
          onChange={handleChange}
          disabled={saving}
        />
        <EditableField
          idPrefix={idPrefix}
          label="Gender"
          name="gender"
          value={formData.gender}
          onChange={handleChange}
          options={GENDER_OPTIONS}
          disabled={saving}
        />
        <div className="sm:col-span-2">
          <EditableField
            idPrefix={idPrefix}
            label="Address"
            name="address"
            value={formData.address}
            onChange={handleChange}
            multiline
            rows={2}
            disabled={saving}
          />
        </div>
        <EditableField
          idPrefix={idPrefix}
          label="City"
          name="city"
          value={formData.city}
          onChange={handleChange}
          disabled={saving}
        />
        <EditableField
          idPrefix={idPrefix}
          label="Postal code"
          name="postal_code"
          value={formData.postal_code}
          onChange={handleChange}
          disabled={saving}
        />
        <EditableField
          idPrefix={idPrefix}
          label="State / Province / Region"
          name="state_province_region"
          value={formData.state_province_region}
          onChange={handleChange}
          disabled={saving}
        />
        <EditableField
          idPrefix={idPrefix}
          label="Country"
          name="country"
          value={formData.country}
          onChange={handleChange}
          disabled={saving}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-gray-200">
        <button
          type="button"
          onClick={() => {
            setFormData(buildGuardianForm(guardian));
            setFormErrors({});
          }}
          disabled={!dirty || saving}
          className="px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
};

const buildFormFromUser = (user) => ({
  full_name: user?.full_name || '',
  email: user?.email || '',
  phone_number: user?.phone_number || '',
  gender: user?.gender || '',
  date_of_birth: user?.date_of_birth ? String(user.date_of_birth).slice(0, 10) : '',
  lrn: user?.lrn || '',
  level_tag: user?.level_tag || '',
  branch_id: user?.branch_id != null ? String(user.branch_id) : '',
  profile_picture_url: user?.profile_picture_url || '',
});

const isFormDirty = (form, user) => {
  if (!user) return false;
  const baseline = buildFormFromUser(user);
  return Object.keys(baseline).some((key) => (form[key] ?? '') !== (baseline[key] ?? ''));
};

/**
 * Superadmin / Admin: full read-only student snapshot with sidebar tabs.
 *
 * Props:
 *   - isOpen, student (must include user_id), onClose
 *   - onUpdated   (optional) called after a successful save / image change
 *                 so the parent list can refresh.
 */
const StudentHistoryModal = ({ isOpen, student, onClose, onUpdated }) => {
  const [activeTab, setActiveTab] = useState('student');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailUser, setDetailUser] = useState(null);
  const [guardians, setGuardians] = useState([]);
  const [classRows, setClassRows] = useState([]);
  const [installmentRows, setInstallmentRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [formData, setFormData] = useState(buildFormFromUser(null));
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [savingMessage, setSavingMessage] = useState('');
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [guardianDirtyMap, setGuardianDirtyMap] = useState({});
  const fileInputRef = useRef(null);

  const studentId = student?.user_id;

  const branchOptions = useMemo(
    () =>
      branches.map((b) => ({
        value: String(b.branch_id),
        label: b.branch_name || b.branch_nickname || `Branch ${b.branch_id}`,
      })),
    [branches]
  );

  const dirty = useMemo(() => isFormDirty(formData, detailUser), [formData, detailUser]);

  const guardianDirty = useMemo(
    () => Object.values(guardianDirtyMap).some(Boolean),
    [guardianDirtyMap]
  );

  const reportGuardianDirty = useCallback((guardianId, isDirty) => {
    if (guardianId == null) return;
    setGuardianDirtyMap((prev) => {
      const next = { ...prev };
      if (isDirty) next[guardianId] = true;
      else delete next[guardianId];
      return next;
    });
  }, []);

  const loadData = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError('');
    try {
      const [userRes, guardiansRes, classesRes, branchesRes, installmentData] = await Promise.all([
        apiRequest(`/users/${studentId}`),
        apiRequest(`/guardians/student/${studentId}`),
        apiRequest(`/students/${studentId}/classes`),
        apiRequest('/branches?limit=100'),
        fetchAllInstallmentInvoicePages(apiRequest, {
          extraSearchParams: { student_id: String(studentId) },
        }),
      ]);
      const user = userRes?.data || null;
      setDetailUser(user);
      setFormData(buildFormFromUser(user));
      setFormErrors({});
      setGuardians(Array.isArray(guardiansRes?.data) ? guardiansRes.data : []);
      setClassRows(Array.isArray(classesRes?.data) ? classesRes.data : []);
      setInstallmentRows(Array.isArray(installmentData) ? installmentData : []);
      setBranches(Array.isArray(branchesRes?.data) ? branchesRes.data : []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load student history.');
      setDetailUser(null);
      setGuardians([]);
      setClassRows([]);
      setInstallmentRows([]);
      setBranches([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (isOpen && studentId) {
      setActiveTab('student');
      loadData();
    } else if (!isOpen) {
      setDetailUser(null);
      setGuardians([]);
      setClassRows([]);
      setInstallmentRows([]);
      setBranches([]);
      setError('');
      setFormErrors({});
      setFormData(buildFormFromUser(null));
      setGuardianDirtyMap({});
      setUploadingPicture(false);
      setSaving(false);
      setSavingMessage('');
    }
  }, [isOpen, studentId, loadData]);

  const requestClose = useCallback(async () => {
    if (saving || uploadingPicture) return;
    if (dirty || guardianDirty) {
      const ok = await appConfirm({
        title: 'Discard changes?',
        message: 'You have unsaved edits in this dialog. Close without saving?',
        destructive: true,
        confirmLabel: 'Discard',
      });
      if (!ok) return;
    }
    onClose();
  }, [dirty, guardianDirty, onClose, saving, uploadingPicture]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, requestClose]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formErrors[name]) {
      setFormErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validateForm = () => {
    const errs = {};
    if (!formData.full_name.trim()) errs.full_name = 'Full name is required';
    if (!formData.email.trim()) {
      errs.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errs.email = 'Enter a valid email';
    }
    return errs;
  };

  const handleSave = async () => {
    const errs = validateForm();
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }
    if (!detailUser?.user_id) return;
    setSaving(true);
    setSavingMessage('Saving changes…');
    try {
      const payload = {
        full_name: formData.full_name.trim(),
        email: formData.email.trim(),
        phone_number: formData.phone_number.trim() || null,
        gender: formData.gender || null,
        date_of_birth: formData.date_of_birth || null,
        lrn: formData.lrn.trim() || null,
        level_tag: formData.level_tag || null,
        branch_id: formData.branch_id ? parseInt(formData.branch_id, 10) : null,
      };
      const res = await apiRequest(`/users/${detailUser.user_id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const updated = res?.data || null;
      if (updated) {
        setDetailUser(updated);
        setFormData(buildFormFromUser(updated));
      }
      setFormErrors({});
      onUpdated?.();
      appAlert('Student details updated successfully.');
    } catch (err) {
      console.error('Save student error:', err);
      const message = err?.response?.data?.message || err?.message || 'Failed to update student.';
      setFormErrors((prev) => ({ ...prev, _submit: message }));
    } finally {
      setSaving(false);
      setSavingMessage('');
    }
  };

  const handlePictureFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    if (!detailUser?.user_id) return;

    if (!file.type.startsWith('image/')) {
      appAlert('Please select a valid image file.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      appAlert('Image must be 50MB or smaller.');
      return;
    }

    setUploadingPicture(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const uploadRes = await apiRequest('/upload/user-avatar', {
        method: 'POST',
        body: fd,
      });
      const url = uploadRes?.imageUrl;
      if (!url) throw new Error('Upload succeeded but no image URL was returned.');

      const updateRes = await apiRequest(`/users/${detailUser.user_id}`, {
        method: 'PUT',
        body: JSON.stringify({ profile_picture_url: url }),
      });
      const updated = updateRes?.data || null;
      if (updated) {
        setDetailUser(updated);
        setFormData((prev) => ({ ...prev, profile_picture_url: updated.profile_picture_url || '' }));
      } else {
        setFormData((prev) => ({ ...prev, profile_picture_url: url }));
        setDetailUser((prev) => (prev ? { ...prev, profile_picture_url: url } : prev));
      }
      onUpdated?.();
      appAlert('Profile picture updated.');
    } catch (err) {
      console.error('Profile picture upload failed:', err);
      appAlert(err?.message || 'Failed to upload profile picture.');
    } finally {
      setUploadingPicture(false);
    }
  };

  const handleRemovePicture = async () => {
    if (!detailUser?.user_id) return;
    if (!detailUser.profile_picture_url) return;
    const ok = await appConfirm({
      title: 'Remove profile picture',
      message: 'Are you sure you want to remove this student\u2019s profile picture?',
      destructive: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;

    setUploadingPicture(true);
    try {
      const res = await apiRequest(`/users/${detailUser.user_id}`, {
        method: 'PUT',
        body: JSON.stringify({ profile_picture_url: null }),
      });
      const updated = res?.data || null;
      if (updated) {
        setDetailUser(updated);
        setFormData((prev) => ({ ...prev, profile_picture_url: '' }));
      } else {
        setDetailUser((prev) => (prev ? { ...prev, profile_picture_url: null } : prev));
        setFormData((prev) => ({ ...prev, profile_picture_url: '' }));
      }
      onUpdated?.();
      appAlert('Profile picture removed.');
    } catch (err) {
      console.error('Remove profile picture failed:', err);
      appAlert(err?.message || 'Failed to remove profile picture.');
    } finally {
      setUploadingPicture(false);
    }
  };

  const titleName = student?.full_name || detailUser?.full_name || 'Student';
  const titleEmail = student?.email || detailUser?.email || '';

  if (!isOpen) return null;

  const profilePicSrc = detailUser?.profile_picture_url || '';
  const showSavingBar = saving || uploadingPicture;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[9998] flex items-stretch justify-center bg-black/40 backdrop-blur-sm p-1 sm:p-3 sm:items-center"
        onClick={requestClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="student-history-title"
      >
        <div
          className="bg-white rounded-t-xl sm:rounded-xl shadow-2xl flex flex-col w-full max-w-[min(98vw,1780px)] min-h-0 my-auto border border-gray-200 h-[96vh] sm:h-[min(94vh,880px)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-gray-200 flex-shrink-0">
            <div className="min-w-0">
              <h2 id="student-history-title" className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                Student history
              </h2>
              <p className="text-sm text-gray-600 mt-0.5 truncate" title={titleEmail}>
                {titleName}
                {titleEmail ? ` · ${titleEmail}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="text-gray-400 hover:text-gray-700 shrink-0 p-1 rounded-lg hover:bg-gray-100"
              aria-label="Close"
              disabled={showSavingBar}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body: sidebar (lg+) or top scroll-tabs (mobile) */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* Sidebar (lg+) */}
            <aside className="hidden lg:block lg:w-52 xl:w-56 lg:shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
              <nav className="p-3 space-y-1" aria-label="Student history sections">
                {TABS.map((t) => {
                  const isActive = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                        isActive
                          ? 'bg-primary-50 text-primary-800 border border-primary-200'
                          : 'text-gray-700 hover:bg-white hover:text-gray-900 border border-transparent'
                      }`}
                    >
                      <svg
                        className={`w-5 h-5 ${isActive ? 'text-primary-600' : 'text-gray-500'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d={t.iconPath}
                        />
                      </svg>
                      <span className="truncate">{t.label}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            {/* Mobile / tablet top tab bar */}
            <div className="lg:hidden border-b border-gray-200 px-2 sm:px-4 flex-shrink-0 overflow-x-auto bg-gray-50">
              <nav className="flex gap-1 min-w-min py-2" aria-label="Student history sections (mobile)">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={`whitespace-nowrap px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      activeTab === t.id
                        ? 'bg-primary-50 text-primary-800 border border-primary-200'
                        : 'text-gray-700 hover:bg-white border border-transparent'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Tab content */}
            <div
              className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${
                activeTab === 'invoices'
                  ? 'px-2 sm:px-3 py-3 sm:py-4'
                  : 'px-4 py-4 sm:px-6 sm:py-5'
              }`}
            >
              {loading && (
                <div className="flex justify-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
                </div>
              )}

              {!loading && error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {!loading && !error && activeTab === 'student' && (
                <div className="space-y-6">
                  {/* Profile picture card */}
                  <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="relative shrink-0">
                        {profilePicSrc ? (
                          <img
                            src={profilePicSrc}
                            alt={detailUser?.full_name || 'Profile'}
                            className="w-24 h-24 rounded-full object-cover border-4 border-gray-200"
                          />
                        ) : (
                          <div className="w-24 h-24 rounded-full bg-primary-100 border-4 border-gray-200 flex items-center justify-center">
                            <span className="text-3xl font-semibold text-primary-700">
                              {detailUser?.full_name?.charAt(0)?.toUpperCase() || '?'}
                            </span>
                          </div>
                        )}
                        {uploadingPicture && (
                          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">Profile picture</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          PNG, JPG or GIF, up to 50MB. Updates immediately and is shown across the system.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handlePictureFileSelected}
                          />
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingPicture || !detailUser?.user_id}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5 5 5M12 5v12" />
                            </svg>
                            {profilePicSrc ? 'Change picture' : 'Upload picture'}
                          </button>
                          {profilePicSrc && (
                            <button
                              type="button"
                              onClick={handleRemovePicture}
                              disabled={uploadingPicture}
                              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
                              </svg>
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Editable details card */}
                  <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">Student details</h3>
                      {dirty && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Unsaved changes
                        </span>
                      )}
                    </div>

                    {formErrors._submit && (
                      <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                        {formErrors._submit}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <EditableField
                        label="Full name"
                        name="full_name"
                        value={formData.full_name}
                        onChange={handleInputChange}
                        required
                        disabled={saving}
                        error={formErrors.full_name}
                      />
                      <EditableField
                        label="Email"
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        required
                        disabled={saving}
                        error={formErrors.email}
                      />
                      <EditableField
                        label="Phone"
                        name="phone_number"
                        type="tel"
                        value={formData.phone_number}
                        onChange={handleInputChange}
                        disabled={saving}
                        placeholder="e.g. +639123456789"
                      />
                      <EditableField
                        label="Gender"
                        name="gender"
                        value={formData.gender}
                        onChange={handleInputChange}
                        options={GENDER_OPTIONS}
                        disabled={saving}
                      />
                      <EditableField
                        label="Date of birth"
                        name="date_of_birth"
                        type="date"
                        value={formData.date_of_birth}
                        onChange={handleInputChange}
                        disabled={saving}
                      />
                      <EditableField
                        label="LRN"
                        name="lrn"
                        value={formData.lrn}
                        onChange={handleInputChange}
                        disabled={saving}
                      />
                      <EditableField
                        label="Level tag"
                        name="level_tag"
                        value={formData.level_tag}
                        onChange={handleInputChange}
                        options={LEVEL_TAG_OPTIONS}
                        disabled={saving}
                      />
                      <EditableField
                        label="Branch"
                        name="branch_id"
                        value={formData.branch_id}
                        onChange={handleInputChange}
                        options={branchOptions}
                        disabled={saving || branchOptions.length === 0}
                      />
                      <ReadOnlyField
                        label="User ID"
                        value={detailUser?.user_id != null ? String(detailUser.user_id) : null}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => {
                          setFormData(buildFormFromUser(detailUser));
                          setFormErrors({});
                        }}
                        disabled={!dirty || saving}
                        className="px-3 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={!dirty || saving}
                        className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                    </div>
                  </section>
                </div>
              )}

              {!loading && !error && activeTab === 'guardian' && (
                <div className="space-y-6">
                  {guardians.length === 0 ? (
                    <p className="text-sm text-gray-500">No guardian records for this student.</p>
                  ) : (
                    guardians.map((g) => (
                      <GuardianEditCard
                        key={g.guardian_id || `${g.guardian_name}-${g.email}`}
                        guardian={g}
                        onDirtyChange={reportGuardianDirty}
                        onUpdated={(updated) => {
                          if (!updated) return;
                          setGuardians((prev) =>
                            prev.map((p) =>
                              p.guardian_id === updated.guardian_id ? { ...p, ...updated } : p
                            )
                          );
                          onUpdated?.();
                        }}
                      />
                    ))
                  )}
                </div>
              )}

              {!loading && !error && activeTab === 'classes' && (
                <div className="space-y-4">
                  {classRows.length === 0 ? (
                    <p className="text-sm text-gray-500">No class enrollments found.</p>
                  ) : (
                    <div
                      className="overflow-x-auto rounded-lg"
                      style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: '#cbd5e0 #f7fafc',
                        WebkitOverflowScrolling: 'touch',
                      }}
                    >
                      <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '720px' }}>
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Program
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Class
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Level
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Room
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Start — End
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Phases
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              First enrolled
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {classRows.map((row) => (
                            <tr key={row.class_id}>
                              <td className="px-3 py-3 text-sm text-gray-900">
                                {row.program_name || '—'}
                                {row.program_code ? (
                                  <span className="block text-xs text-gray-500">{row.program_code}</span>
                                ) : null}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-900">{row.class_name || '—'}</td>
                              <td className="px-3 py-3 text-sm text-gray-900">{row.level_tag || '—'}</td>
                              <td className="px-3 py-3 text-sm text-gray-900">{row.room_name || '—'}</td>
                              <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                {row.start_date || '—'} — {row.end_date || '—'}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-900">
                                {Array.isArray(row.phases) && row.phases.length > 0
                                  ? [...row.phases].sort((a, b) => a - b).join(', ')
                                  : '—'}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-900 whitespace-nowrap">
                                {row.earliest_enrollment ? formatDateManila(row.earliest_enrollment) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {!loading && !error && activeTab === 'attendance' && (
                <StudentAttendancePanel studentId={studentId} classRows={classRows} />
              )}

              {!loading && !error && activeTab === 'invoices' && (
                <div className="space-y-6">
                  {installmentRows.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No installment invoice records for this student.
                    </p>
                  ) : (
                    installmentRows.map((inv, idx) => {
                      const profileId = inv.installmentinvoiceprofiles_id;
                      if (!profileId) return null;
                      const planTitleParts = [
                        inv.program_name,
                        inv.package_description,
                      ].filter(Boolean);
                      return (
                        <section
                          key={`plan-${profileId}`}
                          className="rounded-lg border border-gray-200 bg-white p-2 sm:p-3"
                        >
                          <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="text-sm sm:text-base font-semibold text-gray-900">
                              Plan {idx + 1}
                              {planTitleParts.length > 0 ? (
                                <span className="ml-2 text-gray-500 font-normal">
                                  · {planTitleParts.join(' \u2013 ')}
                                </span>
                              ) : null}
                            </h3>
                          </header>
                          <InstallmentPlanDetails
                            profileId={profileId}
                            showStudentName={false}
                            embedded
                          />
                        </section>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer status bar */}
          {showSavingBar && (
            <div className="px-4 sm:px-6 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-700 flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
              {savingMessage || (uploadingPicture ? 'Updating profile picture…' : 'Working…')}
            </div>
          )}
        </div>
      </div>

    </>,
    document.body
  );
};

export default StudentHistoryModal;
