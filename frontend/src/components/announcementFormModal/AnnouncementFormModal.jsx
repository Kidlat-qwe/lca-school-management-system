import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AnnouncementAttachmentPreview from '../announcementAttachment';
import AnnouncementSendEmailToggle from '../announcementSendEmailToggle';
import AnnouncementAudienceFilters from '../announcementAudienceFilters';

const ACADEMIC_RECIPIENT_GROUPS = new Set(['Students', 'Teachers', 'Guardians']);
const DESCRIPTION_MAX = 5000;

export function announcementNeedsAcademicAudience(recipientGroups = []) {
  const groups = recipientGroups || [];
  return groups.includes('All') || groups.some((g) => ACADEMIC_RECIPIENT_GROUPS.has(g));
}

function RecipientGroupIcon({ name }) {
  const cls = 'h-4 w-4 shrink-0 text-primary-600';
  switch (name) {
    case 'All':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case 'Students':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 01-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
        </svg>
      );
    case 'Teachers':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    case 'Guardians':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      );
    case 'Admin':
    case 'Superadmin':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      );
    case 'Finance':
    case 'Superfinance':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    default:
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
  }
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function CloudUploadIcon() {
  return (
    <svg className="mx-auto h-8 w-8 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
  );
}

/**
 * Landscape create/edit announcement modal aligned to product UI mockups.
 */
export default function AnnouncementFormModal({
  isOpen,
  onClose,
  onSubmit,
  onSaveDraft,
  formData,
  formErrors,
  setFormErrors,
  onInputChange,
  onRecipientGroupToggle,
  onAudienceChange,
  onSendEmailChange,
  recipientGroups,
  statusOptions,
  priorityOptions,
  editingAnnouncement,
  submitting,
  error,
  attachmentInputRef,
  attachmentUploading,
  attachmentFileName,
  attachmentLocalPreviewUrl,
  onAttachmentChange,
  onRemoveAttachment,
  requireBranchGate = false,
  branches = [],
  branchLabel = null,
  showBranchSelect = false,
}) {
  const [phase, setPhase] = useState('content');
  const [dragOver, setDragOver] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    if (requireBranchGate && !editingAnnouncement) {
      setPhase('branch');
    } else {
      setPhase('content');
    }
  }, [isOpen, requireBranchGate, editingAnnouncement]);

  const showAcademicFilters = useMemo(
    () => announcementNeedsAcademicAudience(formData.recipient_groups),
    [formData.recipient_groups]
  );

  const bodyLength = String(formData.body || '').length;
  const showBranchField = showBranchSelect || requireBranchGate;

  if (!isOpen) return null;

  const validateBranchGate = () => {
    const errors = {};
    if (!formData.branch_id || formData.branch_id === '') {
      errors.branch_id = 'Select a branch or All Branches';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateContentStep = ({ forDraft = false } = {}) => {
    const errors = {};
    if (!formData.title?.trim()) {
      errors.title = 'Title is required';
    }
    if (
      !forDraft &&
      (editingAnnouncement || (formData.send_email && formData.status === 'Active')) &&
      !formData.email_subject?.trim()
    ) {
      errors.email_subject = 'Subject is required';
    }
    if (!formData.body?.trim()) {
      errors.body = 'Description is required';
    }
    if (String(formData.body || '').length > DESCRIPTION_MAX) {
      errors.body = `Description must be at most ${DESCRIPTION_MAX} characters`;
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateAudienceStep = () => {
    const errors = {};
    if (!formData.recipient_groups || formData.recipient_groups.length === 0) {
      errors.recipient_groups = 'At least one recipient group is required';
    }
    if (announcementNeedsAcademicAudience(formData.recipient_groups)) {
      if (formData.program_ids == null) {
        errors.program_ids = 'Select All programs or at least one program';
      }
      if (formData.class_ids == null) {
        errors.class_ids = 'Select All classes or at least one class';
      }
    }
    if (!formData.status) {
      errors.status = 'Status is required';
    }
    if (!formData.priority) {
      errors.priority = 'Priority is required';
    }
    if (showBranchSelect && (!formData.branch_id || formData.branch_id === '')) {
      errors.branch_id = 'Branch is required';
    }
    if (formData.start_date && formData.end_date) {
      if (new Date(formData.start_date) > new Date(formData.end_date)) {
        errors.end_date = 'End date must be after or equal to start date';
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleBranchContinue = () => {
    if (!validateBranchGate()) return;
    setPhase('content');
  };

  const handleNext = () => {
    if (!validateContentStep()) return;
    setPhase('audience');
  };

  const handleBack = () => {
    setFormErrors({});
    if (phase === 'audience') {
      setPhase('content');
      return;
    }
    if (phase === 'content' && requireBranchGate && !editingAnnouncement) {
      setPhase('branch');
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (phase !== 'audience') {
      if (phase === 'branch') handleBranchContinue();
      else handleNext();
      return;
    }
    if (!validateAudienceStep()) return;
    onSubmit(e);
  };

  const handleSaveDraftClick = () => {
    if (!validateContentStep({ forDraft: true })) {
      if (phase === 'audience') setPhase('content');
      return;
    }
    onSaveDraft?.();
  };

  const applyBodyFormat = (command) => {
    const el = bodyRef.current;
    if (!el) return;
    el.focus();
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const value = formData.body || '';
    const selected = value.slice(start, end);
    let next = value;
    let cursor = end;

    if (command === 'bold' || command === 'italic' || command === 'underline') {
      const wrap = command === 'bold' ? '**' : command === 'italic' ? '_' : '__';
      next = `${value.slice(0, start)}${wrap}${selected || 'text'}${wrap}${value.slice(end)}`;
      cursor = start + wrap.length + (selected || 'text').length + wrap.length;
    } else if (command === 'ul') {
      const line = selected || 'List item';
      next = `${value.slice(0, start)}• ${line}${value.slice(end)}`;
      cursor = start + 2 + line.length;
    } else if (command === 'ol') {
      const line = selected || 'List item';
      next = `${value.slice(0, start)}1. ${line}${value.slice(end)}`;
      cursor = start + 3 + line.length;
    }

    onInputChange({ target: { name: 'body', value: next.slice(0, DESCRIPTION_MAX) } });
    requestAnimationFrame(() => {
      if (bodyRef.current) {
        bodyRef.current.focus();
        bodyRef.current.setSelectionRange(cursor, cursor);
      }
    });
  };

  const handleDropFiles = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file || !attachmentInputRef?.current) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    attachmentInputRef.current.files = dt.files;
    onAttachmentChange({ target: attachmentInputRef.current });
  };

  const stepLabel =
    phase === 'branch'
      ? 'Select branch'
      : phase === 'content'
        ? 'Step 1 of 2 — Content'
        : 'Step 2 of 2 — Audience & Schedule';

  const branchAudienceId =
    formData.branch_id && formData.branch_id !== 'all'
      ? parseInt(formData.branch_id, 10)
      : null;

  const inputCls = (hasError) =>
    `w-full rounded-lg border bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 ${
      hasError ? 'border-red-500' : 'border-gray-200'
    }`;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4">
      <div className="fixed inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white text-left shadow-2xl">
        <form onSubmit={handleFormSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold tracking-tight text-gray-900">
                {editingAnnouncement ? 'Edit Announcement' : 'Create Announcement'}
              </h3>
              <p className="mt-0.5 text-sm text-gray-500">{stepLabel}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {(phase === 'content' || phase === 'audience') && (
                <div className="hidden items-center gap-1.5 sm:flex">
                  <span
                    className={`h-1.5 w-10 rounded-full ${
                      phase === 'content' || phase === 'audience' ? 'bg-primary-500' : 'bg-gray-200'
                    }`}
                  />
                  <span
                    className={`h-1.5 w-10 rounded-full ${
                      phase === 'audience' ? 'bg-primary-500' : 'bg-gray-200'
                    }`}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {phase === 'branch' && (
              <div className="mx-auto max-w-md space-y-4 py-6 sm:py-10">
                <p className="text-sm text-gray-600">
                  Choose which branch this announcement applies to before continuing.
                </p>
                <div>
                  <label htmlFor="branch_gate" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Branch <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="branch_gate"
                    name="branch_id"
                    value={formData.branch_id}
                    onChange={onInputChange}
                    className={inputCls(formErrors.branch_id)}
                  >
                    <option value="">Select Branch</option>
                    <option value="all">All Branches</option>
                    {branches.map((branch) => (
                      <option key={branch.branch_id} value={branch.branch_id}>
                        {branch.branch_name}
                      </option>
                    ))}
                  </select>
                  {formErrors.branch_id && (
                    <p className="mt-1 text-sm text-red-600">{formErrors.branch_id}</p>
                  )}
                </div>
              </div>
            )}

            {phase === 'content' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
                {/* Left: meta */}
                <div className="space-y-4">
                  <div>
                    <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-gray-700">
                      Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      id="title"
                      name="title"
                      value={formData.title}
                      onChange={onInputChange}
                      placeholder="Enter announcement title"
                      className={inputCls(formErrors.title)}
                    />
                    {formErrors.title && (
                      <p className="mt-1 text-sm text-red-600">{formErrors.title}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="email_subject" className="mb-1.5 block text-sm font-medium text-gray-700">
                      Subject{' '}
                      {(editingAnnouncement || (formData.send_email && formData.status === 'Active')) && (
                        <span className="text-red-500">*</span>
                      )}
                    </label>
                    <input
                      type="text"
                      id="email_subject"
                      name="email_subject"
                      value={formData.email_subject}
                      onChange={onInputChange}
                      disabled={!editingAnnouncement && !formData.send_email}
                      placeholder="Enter email subject"
                      className={`${inputCls(formErrors.email_subject)} disabled:bg-gray-50 disabled:text-gray-500`}
                    />
                    {formErrors.email_subject && (
                      <p className="mt-1 text-sm text-red-600">{formErrors.email_subject}</p>
                    )}
                  </div>

                  <AnnouncementSendEmailToggle
                    checked={formData.send_email}
                    onChange={onSendEmailChange}
                    status={formData.status}
                    showEditHint={Boolean(editingAnnouncement)}
                    variant="card"
                  />

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Attachment <span className="font-normal text-gray-400">(optional)</span>
                    </label>
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,image/*,.txt,.csv"
                      onChange={onAttachmentChange}
                      disabled={attachmentUploading}
                      className="hidden"
                    />
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          attachmentInputRef?.current?.click();
                        }
                      }}
                      onClick={() => !attachmentUploading && attachmentInputRef?.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDropFiles}
                      className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
                        dragOver
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 bg-gray-50/80 hover:border-primary-300 hover:bg-primary-50/40'
                      } ${attachmentUploading ? 'pointer-events-none opacity-60' : ''}`}
                    >
                      <CloudUploadIcon />
                      <p className="mt-2 text-sm text-gray-600">
                        Drag and drop a file here or{' '}
                        <span className="font-semibold text-primary-600">browse</span> to upload
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        Max file size 20MB. Supported formats: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG.
                      </p>
                    </div>
                    {attachmentUploading && (
                      <p className="mt-2 text-sm text-gray-500">Uploading...</p>
                    )}
                    {(attachmentFileName || attachmentLocalPreviewUrl) && (
                      <div className="mt-3 space-y-1.5">
                        {(formData.attachment_url || attachmentLocalPreviewUrl) && (
                          <AnnouncementAttachmentPreview
                            url={formData.attachment_url}
                            localPreviewUrl={attachmentLocalPreviewUrl}
                            compact
                          />
                        )}
                        {attachmentFileName && (
                          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                            <span className="truncate text-sm text-gray-700">{attachmentFileName}</span>
                            <button
                              type="button"
                              onClick={onRemoveAttachment}
                              className="ml-auto shrink-0 text-sm font-medium text-red-600 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: description */}
                <div className="flex min-h-0 flex-col">
                  <label htmlFor="body" className="mb-1.5 block text-sm font-medium text-gray-700">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <div
                    className={`flex min-h-[280px] flex-1 flex-col overflow-hidden rounded-xl border bg-white lg:min-h-[360px] ${
                      formErrors.body ? 'border-red-500' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-100 bg-gray-50 px-2 py-1.5">
                      <span className="mr-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500">
                        Paragraph
                      </span>
                      {[
                        { cmd: 'bold', label: 'B', className: 'font-bold' },
                        { cmd: 'italic', label: 'I', className: 'italic' },
                        { cmd: 'underline', label: 'U', className: 'underline' },
                        { cmd: 'ul', label: '•' },
                        { cmd: 'ol', label: '1.' },
                      ].map((btn) => (
                        <button
                          key={btn.cmd}
                          type="button"
                          title={btn.cmd}
                          onClick={() => applyBodyFormat(btn.cmd)}
                          className={`rounded px-2 py-1 text-sm text-gray-600 hover:bg-white hover:text-gray-900 ${btn.className || ''}`}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      ref={bodyRef}
                      id="body"
                      name="body"
                      value={formData.body}
                      onChange={(e) => {
                        const value = e.target.value.slice(0, DESCRIPTION_MAX);
                        onInputChange({ target: { name: 'body', value } });
                      }}
                      placeholder="Write your announcement content here..."
                      className="min-h-[200px] flex-1 resize-none border-0 bg-transparent px-3 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0 lg:min-h-[280px]"
                    />
                    <div className="flex items-center justify-end border-t border-gray-100 px-3 py-1.5">
                      <span className="text-xs text-gray-400">
                        {bodyLength} / {DESCRIPTION_MAX} characters
                      </span>
                    </div>
                  </div>
                  {formErrors.body && (
                    <p className="mt-1 text-sm text-red-600">{formErrors.body}</p>
                  )}
                </div>
              </div>
            )}

            {phase === 'audience' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-0">
                {/* Left audience */}
                <div className="space-y-4 lg:border-r lg:border-gray-100 lg:pr-8">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-gray-700">
                      Recipient Groups <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {recipientGroups.map((group) => {
                        const checked = (formData.recipient_groups || []).includes(group.value);
                        return (
                          <button
                            key={group.value}
                            type="button"
                            onClick={() => onRecipientGroupToggle(group.value)}
                            className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left text-sm transition ${
                              checked
                                ? 'border-primary-500 bg-primary-50 text-gray-900 shadow-sm'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                            }`}
                          >
                            <span
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                checked
                                  ? 'border-primary-600 bg-primary-600 text-white'
                                  : 'border-gray-300 bg-white'
                              }`}
                            >
                              {checked && (
                                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                                  <path
                                    d="M2.5 6l2.5 2.5 4.5-4.5"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </span>
                            <RecipientGroupIcon name={group.value} />
                            <span className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-snug">
                              {group.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {formErrors.recipient_groups && (
                      <p className="mt-1 text-sm text-red-600">{formErrors.recipient_groups}</p>
                    )}
                  </div>

                  {showAcademicFilters && (
                    <AnnouncementAudienceFilters
                      programIds={formData.program_ids}
                      classIds={formData.class_ids}
                      branchId={branchAudienceId}
                      errors={formErrors}
                      onChange={onAudienceChange}
                      compact
                    />
                  )}
                </div>

                {/* Right delivery */}
                <div className="space-y-5 lg:pl-8">
                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-gray-900">Delivery Settings</h4>
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="status" className="mb-1.5 block text-sm font-medium text-gray-700">
                            Status <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="status"
                            name="status"
                            value={formData.status}
                            onChange={onInputChange}
                            className={inputCls(formErrors.status)}
                          >
                            {statusOptions.map((status) => (
                              <option key={status.value} value={status.value}>
                                {status.label}
                              </option>
                            ))}
                          </select>
                          {formErrors.status && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.status}</p>
                          )}
                        </div>
                        <div>
                          <label htmlFor="priority" className="mb-1.5 block text-sm font-medium text-gray-700">
                            Priority <span className="text-red-500">*</span>
                          </label>
                          <select
                            id="priority"
                            name="priority"
                            value={formData.priority}
                            onChange={onInputChange}
                            className={inputCls(formErrors.priority)}
                          >
                            {priorityOptions.map((priority) => (
                              <option key={priority.value} value={priority.value}>
                                {priority.label}
                              </option>
                            ))}
                          </select>
                          {formErrors.priority && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.priority}</p>
                          )}
                        </div>
                      </div>

                      {showBranchField && (
                        <div>
                          <label htmlFor="branch_id" className="mb-1.5 block text-sm font-medium text-gray-700">
                            Branch <span className="text-red-500">*</span>
                          </label>
                          {showBranchSelect || requireBranchGate ? (
                            <select
                              id="branch_id"
                              name="branch_id"
                              value={formData.branch_id}
                              onChange={onInputChange}
                              className={inputCls(formErrors.branch_id)}
                            >
                              <option value="">Select Branch</option>
                              <option value="all">All Branches</option>
                              {branches.map((branch) => (
                                <option key={branch.branch_id} value={branch.branch_id}>
                                  {branch.branch_name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={branchLabel || ''}
                              disabled
                              className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                            />
                          )}
                          {formErrors.branch_id && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.branch_id}</p>
                          )}
                        </div>
                      )}

                      {branchLabel != null && !showBranchField && (
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-gray-700">Branch</label>
                          <input
                            type="text"
                            value={branchLabel}
                            disabled
                            className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-3 text-sm font-semibold text-gray-900">Schedule</h4>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="start_date" className="mb-1.5 block text-sm font-medium text-gray-700">
                          Start Date
                        </label>
                        <input
                          type="date"
                          id="start_date"
                          name="start_date"
                          value={formData.start_date}
                          onChange={onInputChange}
                          className={inputCls(formErrors.start_date)}
                        />
                        {formErrors.start_date && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.start_date}</p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="end_date" className="mb-1.5 block text-sm font-medium text-gray-700">
                          End Date
                        </label>
                        <input
                          type="date"
                          id="end_date"
                          name="end_date"
                          value={formData.end_date}
                          onChange={onInputChange}
                          className={inputCls(formErrors.end_date)}
                        />
                        {formErrors.end_date && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.end_date}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex w-full justify-center rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
            >
              Cancel
            </button>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
              {(phase === 'audience' ||
                (phase === 'content' && requireBranchGate && !editingAnnouncement)) && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex w-full justify-center rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:w-auto"
                >
                  Back
                </button>
              )}
              {phase === 'branch' && (
                <button
                  type="button"
                  onClick={handleBranchContinue}
                  className="inline-flex w-full justify-center rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 sm:w-auto"
                >
                  Continue
                </button>
              )}
              {phase === 'content' && (
                <>
                  {typeof onSaveDraft === 'function' && !editingAnnouncement && (
                    <button
                      type="button"
                      disabled={submitting || attachmentUploading}
                      onClick={handleSaveDraftClick}
                      className="inline-flex w-full justify-center rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:w-auto"
                    >
                      Save as Draft
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleNext}
                    className="inline-flex w-full justify-center rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 sm:w-auto"
                  >
                    Next
                  </button>
                </>
              )}
              {phase === 'audience' && (
                <button
                  type="submit"
                  disabled={submitting || attachmentUploading}
                  className="inline-flex w-full justify-center rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:opacity-50 sm:w-auto"
                >
                  {submitting
                    ? 'Saving...'
                    : editingAnnouncement
                      ? 'Update Announcement'
                      : 'Create Announcement'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
