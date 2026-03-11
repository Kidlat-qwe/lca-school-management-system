import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import API_BASE_URL, { apiRequest } from '../../config/api';
import { todayManilaYMD, formatDateManila } from '../../utils/dateUtils';
import { useAuth } from '../../contexts/AuthContext';

const LEVEL_TAG_OPTIONS = ['Playgroup', 'Nursery', 'Pre-Kindergarten', 'Kindergarten', 'Grade School'];

const AcknowledgementReceiptsPage = () => {
  const { userInfo } = useAuth();
  const userType = userInfo?.user_type || userInfo?.userType;
  const isSuperadmin = userType === 'Superadmin';
  const userBranchId = userInfo?.branch_id || userInfo?.branchId || null;
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
  });

  const [packages, setPackages] = useState([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState(
    !isSuperadmin && userBranchId ? String(userBranchId) : ''
  );

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [createFormData, setCreateFormData] = useState({
    prospect_student_name: '',
    prospect_student_contact: '',
    prospect_student_notes: '',
    package_id: '',
    payment_amount: '',
    level_tag: '',
    reference_number: '',
    payment_attachment_url: '',
    installment_option: 'downpayment_only',
    issue_date: todayManilaYMD(),
  });
  const [createFormErrors, setCreateFormErrors] = useState({});
  const [creating, setCreating] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);

  useEffect(() => {
    fetchReceipts(1);

    if (isSuperadmin) {
      fetchBranches();
    } else if (userBranchId) {
      fetchPackages(userBranchId);
    } else {
      fetchPackages(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperadmin, userBranchId]);

  const fetchReceipts = async (page = 1) => {
    try {
      setLoading(true);
      setError('');

      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(pagination.limit));
      if (statusFilter) params.set('status', statusFilter);
      if (searchTerm.trim()) params.set('search', searchTerm.trim());

      const response = await apiRequest(`/acknowledgement-receipts?${params.toString()}`);
      setReceipts(response.data || []);
      if (response.pagination) {
        setPagination({
          page: response.pagination.page,
          limit: response.pagination.limit,
          total: response.pagination.total,
          totalPages:
            response.pagination.totalPages ??
            Math.ceil((response.pagination.total || 0) / response.pagination.limit),
        });
      }
    } catch (err) {
      console.error('Error fetching acknowledgement receipts:', err);
      setError('Failed to load acknowledgement receipts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPackages = async (branchId) => {
    try {
      setPackagesLoading(true);
      let url = '/packages?limit=100';
      if (branchId) {
        url = `/packages?branch_id=${branchId}&limit=100`;
      }
      const response = await apiRequest(url);
      setPackages(response.data || []);
    } catch (err) {
      console.error('Error fetching packages for AR:', err);
    } finally {
      setPackagesLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      setBranchesLoading(true);
      const response = await apiRequest('/branches?limit=100');
      setBranches(response.data || []);
    } catch (err) {
      console.error('Error fetching branches for AR:', err);
    } finally {
      setBranchesLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchReceipts(1);
  };

  const resetCreateForm = () => {
    setSelectedPackage(null);
    setCreateFormData({
      prospect_student_name: '',
      prospect_student_contact: '',
      prospect_student_notes: '',
      package_id: '',
      payment_amount: '',
      level_tag: '',
      reference_number: '',
      payment_attachment_url: '',
      installment_option: 'downpayment_only',
      issue_date: todayManilaYMD(),
    });
    setCreateFormErrors({});
    setAttachmentUploading(false);
  };

  const openCreateModal = () => {
    resetCreateForm();
    setShowCreateModal(true);
  };

  const handleCreateClick = () => {
    if (isSuperadmin) {
      setShowBranchModal(true);
    } else {
      openCreateModal();
    }
  };

  const closeCreateModal = () => {
    if (creating) return;
    setShowCreateModal(false);
  };

  const handleCreateInputChange = (e) => {
    const { name, value } = e.target;
    setCreateFormData((prev) => ({ ...prev, [name]: value }));
    if (createFormErrors[name]) {
      setCreateFormErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handlePackageChange = (e) => {
    const value = e.target.value;
    const pkg = packages.find((p) => String(p.package_id) === value);
    setSelectedPackage(pkg || null);

    let amount = 0;
    if (pkg) {
      const isInstallment = (pkg.package_type || '').toLowerCase() === 'installment';
      const downpayment = pkg.downpayment_amount != null
        ? (typeof pkg.downpayment_amount === 'number' ? pkg.downpayment_amount : parseFloat(pkg.downpayment_amount) || 0)
        : 0;
      if (isInstallment && downpayment > 0) {
        amount = downpayment;
      } else {
        const price = pkg.package_price != null
          ? (typeof pkg.package_price === 'number' ? pkg.package_price : parseFloat(pkg.package_price) || 0)
          : (typeof pkg.price === 'number' ? pkg.price : parseFloat(pkg.price || '0') || 0);
        amount = price;
      }
    }
    const paymentAmount = pkg && amount > 0 ? String(amount) : '';

    const nextLevelTag = pkg && LEVEL_TAG_OPTIONS.includes(pkg.level_tag) ? pkg.level_tag : '';
    setCreateFormData((prev) => ({
      ...prev,
      package_id: value,
      payment_amount: paymentAmount,
      level_tag: nextLevelTag,
      installment_option: 'downpayment_only',
    }));
    setCreateFormErrors((prev) => {
      const next = { ...prev };
      delete next.package_id;
      delete next.payment_amount;
      return next;
    });
  };

  const handleInstallmentOptionChange = (option) => {
    if (!selectedPackage) return;
    const downpayment = parseFloat(selectedPackage.downpayment_amount || 0);
    const monthly = parseFloat(selectedPackage.package_price || 0);
    const amount = option === 'downpayment_plus_phase1'
      ? String(downpayment + monthly)
      : String(downpayment);
    setCreateFormData((prev) => ({
      ...prev,
      installment_option: option,
      payment_amount: amount,
    }));
  };

  const handleAttachmentChange = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      alert('Please select an image (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be 5 MB or less.');
      return;
    }
    setAttachmentUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const token = localStorage.getItem('firebase_token');
      const res = await fetch(`${API_BASE_URL}/upload/invoice-payment-image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Upload failed');
      setCreateFormData((prev) => ({ ...prev, payment_attachment_url: data.imageUrl || '' }));
    } catch (err) {
      console.error('AR attachment upload error:', err);
      alert(err.message || 'Failed to upload image. Please try again.');
    } finally {
      setAttachmentUploading(false);
      e.target.value = '';
    }
  };

  const clearAttachment = () => {
    setCreateFormData((prev) => ({ ...prev, payment_attachment_url: '' }));
  };

  const validateCreateForm = () => {
    const errors = {};
    const name = (createFormData.prospect_student_name || '').trim();
    const guardianName = (createFormData.prospect_student_contact || '').trim();
    const amount = parseFloat(createFormData.payment_amount || '0');

    if (!name) {
      errors.prospect_student_name = 'Student name is required';
    }
    if (!guardianName) {
      errors.prospect_student_contact = 'Guardian name is required';
    }
    if (isSuperadmin && !selectedBranchId) {
      errors.branch_id = 'Branch is required';
    }
    if (!createFormData.package_id) {
      errors.package_id = 'Package is required';
    }
    const levelTag = (createFormData.level_tag || '').trim();
    if (!levelTag) {
      errors.level_tag = 'Level tag is required';
    }
    if (!amount || amount <= 0) {
      errors.payment_amount = 'Payment amount must be greater than 0';
    }

    setCreateFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!validateCreateForm()) return;

    setCreating(true);
    try {
      const isInstallmentPkg = selectedPackage &&
        (selectedPackage.package_type || '').toLowerCase() === 'installment';

      const payload = {
        ...createFormData,
        prospect_student_name: (createFormData.prospect_student_name || '').trim(),
        prospect_student_contact: (createFormData.prospect_student_contact || '').trim(),
        prospect_student_notes: (createFormData.prospect_student_notes || '').trim(),
        package_id: parseInt(createFormData.package_id, 10),
        payment_amount: parseFloat(createFormData.payment_amount),
        issue_date: todayManilaYMD(),
        installment_option: isInstallmentPkg ? createFormData.installment_option : undefined,
        ...(isSuperadmin && selectedBranchId
          ? { branch_id: parseInt(selectedBranchId, 10) }
          : !isSuperadmin && userBranchId
          ? { branch_id: userBranchId }
          : {}),
      };

      if (!payload.prospect_student_notes) {
        delete payload.prospect_student_notes;
      }
      if (payload.level_tag !== undefined && payload.level_tag !== null && String(payload.level_tag).trim() === '') {
        delete payload.level_tag;
      }
      if (!payload.reference_number) {
        delete payload.reference_number;
      }
      if (!payload.payment_attachment_url) {
        delete payload.payment_attachment_url;
      }

      await apiRequest('/acknowledgement-receipts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      alert('Acknowledgement Receipt created successfully.');
      setShowCreateModal(false);
      await fetchReceipts(1);
    } catch (err) {
      console.error('Error creating acknowledgement receipt:', err);
      alert(err.message || 'Failed to create acknowledgement receipt. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const uniqueStatuses = () => {
    const set = new Set();
    receipts.forEach((r) => {
      if (r.status) set.add(r.status);
    });
    return Array.from(set);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Acknowledgement Receipts</h1>
          <p className="text-sm text-gray-600 mt-1">
            Record upfront payments quickly and link them to invoices later.
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreateClick}
          className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold rounded-md shadow-sm text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] transition-colors"
        >
          Create Acknowledgement Receipt
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-5 space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3 md:items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field text-sm"
              placeholder="Search by AR number or name"
            />
          </div>
          <div className="w-full md:w-48">
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setTimeout(() => fetchReceipts(1), 0);
              }}
              className="input-field text-sm"
            >
              <option value="">All</option>
              {uniqueStatuses().map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('');
                fetchReceipts(1);
              }}
              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              Reset
            </button>
          </div>
        </form>

        <div className="mt-2">
          {loading ? (
            <p className="text-sm text-gray-600">Loading acknowledgement receipts?</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : receipts.length === 0 ? (
            <p className="text-sm text-gray-600">No acknowledgement receipts found.</p>
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
                className="min-w-full divide-y divide-gray-200 text-sm"
                style={{ width: '100%', minWidth: '1120px' }}
              >
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Student Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Guardian Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Package</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Level Tag</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Amount</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Branch</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Ref. No.</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Attachment</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Issue Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {receipts.map((r) => (
                    <tr key={r.ack_receipt_id}>
                      <td className="px-4 py-3">
                        <div className="text-gray-900 font-medium">
                          {r.prospect_student_name || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {r.prospect_student_contact || <span className="text-gray-300">?</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900">
                          {r.package_name_snapshot || r.package_name || 'N/A'}
                        </div>
                        <div className="text-xs text-gray-500">
                          ₱
                          {Number(r.package_amount_snapshot || 0).toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {r.level_tag || <span className="text-gray-300">?</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        ₱
                        {Number(r.payment_amount || 0).toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {r.branch_name || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                            r.status === 'Enrolled'
                              ? 'bg-green-100 text-green-800'
                              : r.status === 'Cancelled'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">
                        {r.reference_number || <span className="text-gray-300">?</span>}
                      </td>
                      <td className="px-4 py-3">
                        {r.payment_attachment_url ? (
                          <a
                            href={r.payment_attachment_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            View
                          </a>
                        ) : (
                          <span className="text-gray-300">?</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {r.issue_date ? formatDateManila(r.issue_date) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              Showing {(pagination.page - 1) * pagination.limit + 1}?
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} receipts
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchReceipts(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                type="button"
                onClick={() => fetchReceipts(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {isSuperadmin &&
        showBranchModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
            onClick={() => setShowBranchModal(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-6 pb-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Select Branch</h2>
                <button
                  type="button"
                  onClick={() => setShowBranchModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="px-6 pt-4 pb-6 space-y-4">
                <div>
                  <label className="label-field text-xs">
                    Select Branch <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedBranchId}
                    onChange={(e) => setSelectedBranchId(e.target.value)}
                    className="input-field text-sm"
                    disabled={branchesLoading}
                  >
                    <option value="">Choose a branch...</option>
                    {branches.map((b) => (
                      <option key={b.branch_id} value={b.branch_id}>
                        {b.branch_nickname || b.branch_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShowBranchModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedBranchId) {
                        alert('Please select a branch.');
                        return;
                      }
                      fetchPackages(parseInt(selectedBranchId, 10));
                      setShowBranchModal(false);
                      openCreateModal();
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showCreateModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/5 p-4"
            onClick={closeCreateModal}
          >
            <div
              className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-6 pb-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Create Acknowledgement Receipt</h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Record a payment for a package without creating the full student record yet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="text-gray-400 hover:text-gray-600"
                  disabled={creating}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleCreateSubmit} className="px-6 pb-6 pt-4 space-y-4">
                {isSuperadmin && (
                  <div>
                    <label className="label-field text-xs">
                      Branch <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => {
                        const value = e.target.value;
                        setSelectedBranchId(value);
                        setCreateFormErrors((prev) => {
                          const next = { ...prev };
                          delete next.branch_id;
                          return next;
                        });
                        setSelectedPackage(null);
                        setCreateFormData((prev) => ({
                          ...prev,
                          package_id: '',
                          payment_amount: '',
                          installment_option: 'downpayment_only',
                        }));
                        if (value) {
                          fetchPackages(parseInt(value, 10));
                        } else {
                          setPackages([]);
                        }
                      }}
                      className={`input-field text-sm ${createFormErrors.branch_id ? 'border-red-500' : ''}`}
                      disabled={branchesLoading}
                    >
                      <option value="">Select branch?</option>
                      {branches.map((b) => (
                        <option key={b.branch_id} value={b.branch_id}>
                          {b.branch_nickname || b.branch_name}
                        </option>
                      ))}
                    </select>
                    {createFormErrors.branch_id && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.branch_id}</p>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Student Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="prospect_student_name"
                      value={createFormData.prospect_student_name}
                      onChange={handleCreateInputChange}
                      className={`input-field text-sm ${
                        createFormErrors.prospect_student_name ? 'border-red-500' : ''
                      }`}
                    />
                    {createFormErrors.prospect_student_name && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.prospect_student_name}</p>
                    )}
                  </div>
                  <div>
                    <label className="label-field text-xs">
                      Guardian Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="prospect_student_contact"
                      value={createFormData.prospect_student_contact}
                      onChange={handleCreateInputChange}
                      className={`input-field text-sm ${
                        createFormErrors.prospect_student_contact ? 'border-red-500' : ''
                      }`}
                    />
                    {createFormErrors.prospect_student_contact && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.prospect_student_contact}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="label-field text-xs">Notes (optional)</label>
                  <textarea
                    name="prospect_student_notes"
                    value={createFormData.prospect_student_notes}
                    onChange={handleCreateInputChange}
                    rows="2"
                    className="input-field text-sm"
                  />
                </div>

                <div>
                  <label className="label-field text-xs">
                    Level Tag <span className="text-red-500">*</span>
                  </label>
                  <select
                    name="level_tag"
                    value={createFormData.level_tag}
                    onChange={handleCreateInputChange}
                    className={`input-field text-sm ${createFormErrors.level_tag ? 'border-red-500' : ''}`}
                  >
                    <option value="">Select Level Tag</option>
                    <option value="Playgroup">Playgroup</option>
                    <option value="Nursery">Nursery</option>
                    <option value="Pre-Kindergarten">Pre-Kindergarten</option>
                    <option value="Kindergarten">Kindergarten</option>
                    <option value="Grade School">Grade School</option>
                  </select>
                  {createFormErrors.level_tag && (
                    <p className="text-xs text-red-500 mt-1">{createFormErrors.level_tag}</p>
                  )}
                  {selectedPackage?.level_tag && (
                    <p className="text-xs text-gray-500 mt-1">
                      Package level: {selectedPackage.level_tag}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-field text-xs">
                      Package <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="package_id"
                      value={createFormData.package_id}
                      onChange={handlePackageChange}
                      className={`input-field text-sm ${
                        createFormErrors.package_id ? 'border-red-500' : ''
                      }`}
                      disabled={packagesLoading}
                    >
                      <option value="">Select package?</option>
                      {packages.map((pkg) => (
                        <option key={pkg.package_id} value={pkg.package_id}>
                          {pkg.package_name}
                        </option>
                      ))}
                    </select>
                    {createFormErrors.package_id && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.package_id}</p>
                    )}
                  </div>

                  <div>
                    <label className="label-field text-xs">
                      Payment Amount <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="payment_amount"
                      value={createFormData.payment_amount}
                      onChange={handleCreateInputChange}
                      className={`input-field text-sm ${
                        createFormErrors.payment_amount ? 'border-red-500' : ''
                      }`}
                      readOnly={
                        !!(selectedPackage &&
                          (selectedPackage.package_type || '').toLowerCase() === 'installment')
                      }
                    />
                    {createFormErrors.payment_amount && (
                      <p className="text-xs text-red-500 mt-1">{createFormErrors.payment_amount}</p>
                    )}
                  </div>
                </div>

                {selectedPackage &&
                  (selectedPackage.package_type || '').toLowerCase() === 'installment' && (() => {
                    const downpayment = parseFloat(selectedPackage.downpayment_amount || 0);
                    const monthly = parseFloat(selectedPackage.package_price || 0);
                    return (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                        <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
                          Installment Payment Option
                        </p>
                        <div className="space-y-2">
                          <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                              type="radio"
                              name="installment_option"
                              value="downpayment_only"
                              checked={createFormData.installment_option === 'downpayment_only'}
                              onChange={() => handleInstallmentOptionChange('downpayment_only')}
                              className="mt-0.5 accent-blue-600"
                            />
                            <span className="flex-1">
                              <span className="block text-sm font-medium text-gray-800 group-hover:text-blue-700">
                                Downpayment Only
                              </span>
                              <span className="block text-xs text-gray-500 mt-0.5">
                                Amount: ₱{downpayment.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                &nbsp;&mdash; Phase 1 invoice will be generated separately after enrollment.
                              </span>
                            </span>
                          </label>
                          <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                              type="radio"
                              name="installment_option"
                              value="downpayment_plus_phase1"
                              checked={createFormData.installment_option === 'downpayment_plus_phase1'}
                              onChange={() => handleInstallmentOptionChange('downpayment_plus_phase1')}
                              className="mt-0.5 accent-blue-600"
                            />
                            <span className="flex-1">
                              <span className="block text-sm font-medium text-gray-800 group-hover:text-blue-700">
                                Downpayment + Phase 1
                              </span>
                              <span className="block text-xs text-gray-500 mt-0.5">
                                Amount: ₱{(downpayment + monthly).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                                &nbsp;(₱{downpayment.toLocaleString('en-PH', { minimumFractionDigits: 2 })} downpayment
                                &nbsp;+ ₱{monthly.toLocaleString('en-PH', { minimumFractionDigits: 2 })} Phase 1)
                                &nbsp;&mdash; Phase 2 will be auto-generated.
                              </span>
                            </span>
                          </label>
                        </div>
                      </div>
                    );
                  })()
                }

                <div>
                  <label className="label-field text-xs">Reference Number (optional)</label>
                  <input
                    type="text"
                    name="reference_number"
                    value={createFormData.reference_number}
                    onChange={handleCreateInputChange}
                    placeholder="e.g. GCash transaction ID, bank ref, etc."
                    className="input-field text-sm"
                    disabled={creating}
                  />
                </div>

                <div>
                  <label className="label-field text-xs">Attachment (image)</label>
                  <p className="text-xs text-gray-500 mb-1">
                    Optional: upload a receipt or proof of payment (JPEG, PNG, WebP, GIF ? max 5 MB)
                  </p>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={handleAttachmentChange}
                    disabled={attachmentUploading || creating}
                    className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                  />
                  {attachmentUploading && (
                    <p className="text-xs text-amber-600 mt-1">Uploading?</p>
                  )}
                  {createFormData.payment_attachment_url && !attachmentUploading && (
                    <div className="mt-2">
                      <img
                        src={createFormData.payment_attachment_url}
                        alt="Payment attachment preview"
                        className="max-h-48 w-auto rounded-lg border border-gray-200 object-contain bg-gray-50"
                      />
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <a
                          href={createFormData.payment_attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline"
                        >
                          View attached image
                        </a>
                        <button
                          type="button"
                          onClick={clearAttachment}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={closeCreateModal}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                    disabled={creating}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={creating || attachmentUploading}
                  >
                    {creating ? 'Saving?' : 'Done'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default AcknowledgementReceiptsPage;

