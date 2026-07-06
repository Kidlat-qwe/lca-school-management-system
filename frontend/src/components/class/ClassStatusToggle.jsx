import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { appAlert, appConfirm } from '../../utils/appAlert';

const STATUS_OPTIONS = ['Active', 'Inactive'];

const normalizeStatus = (status) =>
  String(status || 'Active').trim() === 'Inactive' ? 'Inactive' : 'Active';

const statusButtonClass = (status) => {
  if (status === 'Inactive') {
    return 'bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200';
  }
  return 'bg-green-50 text-green-800 border-green-200 hover:bg-green-100';
};

/**
 * Status dropdown for class Active / Inactive.
 * Deactivating releases teacher assignments on the backend.
 */
const ClassStatusToggle = ({
  classId,
  className = '',
  branchId = null,
  status,
  enrolledStudents = 0,
  teacherLabel = '',
  onStatusChanged,
  onNeedsTeacherAssignment,
  disabled = false,
}) => {
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const currentStatus = normalizeStatus(status);

  useEffect(() => {
    if (!open) return undefined;

    const handleClickOutside = (event) => {
      const target = event.target;
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleOpen = () => {
    if (disabled || saving) return;
    if (buttonRef.current) {
      setMenuRect(buttonRef.current.getBoundingClientRect());
    }
    setOpen((prev) => !prev);
  };

  const applyStatus = async (nextStatus) => {
    if (disabled || saving || nextStatus === currentStatus) {
      setOpen(false);
      return;
    }

    if (nextStatus === 'Inactive') {
      const teacherNote = teacherLabel
        ? ` Assigned teacher(s) (${teacherLabel}) will be released and can be assigned to another class.`
        : ' Any assigned teacher will be released and can be assigned to another class.';
      const enrolledNote =
        Number(enrolledStudents) > 0
          ? ` This class still has ${enrolledStudents} enrolled student(s).`
          : '';

      const confirmed = await appConfirm({
        title: 'Mark class inactive',
        message: `This class will no longer be active.${teacherNote}${enrolledNote} Installment billing (new invoices, email, and SMS) will pause for students on this class. Existing records are preserved.`,
        destructive: true,
        confirmLabel: 'Mark inactive',
      });
      if (!confirmed) return;
    }

    if (nextStatus === 'Active') {
      const confirmed = await appConfirm({
        title: 'Mark class active',
        message: teacherLabel
          ? `Activate this class with assigned teacher(s): ${teacherLabel}?`
          : 'A teacher must be assigned before this class can be active. If the previous teacher is not available, open Edit Class and assign a teacher first.',
        confirmLabel: 'Mark active',
      });
      if (!confirmed) return;
    }

    try {
      setSaving(true);
      setOpen(false);
      const response = await apiRequest(`/classes/${classId}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });

      if (response?.data?.needs_teacher_assignment) {
        onNeedsTeacherAssignment?.({
          class_id: classId,
          class_name: className,
          branch_id: branchId,
          teachers_skipped: response.data.teachers_skipped,
          pending_activation: true,
        });
      } else {
        onStatusChanged?.(nextStatus, response?.data);
        if (response?.message) {
          appAlert(response.message, { variant: 'success' });
        }
      }
    } catch (err) {
      appAlert(err.message || 'Failed to update class status', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const menuStyle = menuRect
    ? {
        position: 'fixed',
        top: menuRect.bottom + 4,
        left: menuRect.left,
        minWidth: Math.max(menuRect.width, 120),
        zIndex: 9999,
      }
    : {};

  return (
    <div className="relative inline-flex justify-center">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Class status: ${currentStatus}`}
        disabled={disabled || saving}
        onClick={handleOpen}
        className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${statusButtonClass(
          currentStatus
        )}`}
      >
        <span>{saving ? 'Saving…' : currentStatus}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Class status options"
            style={menuStyle}
            className="rounded-md border border-gray-900 bg-white py-1 shadow-lg"
          >
            {STATUS_OPTIONS.map((option) => {
              const selected = option === currentStatus;
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => applyStatus(option)}
                  className={`block w-full px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-900 transition-colors hover:bg-gray-100 ${
                    selected ? 'bg-gray-100' : 'bg-white'
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
};

export default ClassStatusToggle;
