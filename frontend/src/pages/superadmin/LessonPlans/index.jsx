import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate } from 'react-router-dom';
import { apiRequest } from '../../../config/api';
import { useAuth } from '../../../contexts/AuthContext';
import { appAlert, appConfirm } from '../../../utils/appAlert';
import { LessonPlanHeader } from '../../../components/lessonPlanHeader';

const REVIEW_STATUSES = ['submitted', 'revision_requested', 'awaiting_reflection', 'completed'];

const GRADE_LEVEL_OPTIONS = [
  'Nursery',
  'Pre Kindergarten',
  'Kindergarten',
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6',
];

/** LCA form sections shown in PDF order (flaggable when in revision mode). */
const META_SECTIONS = [
  ['Lesson Topic', 'topic'],
  ['Phase', 'phase'],
  ['Session', 'session'],
  ['Class', 'class_id'],
];

const GOALS_SECTIONS = [
  ['Early Learning Goals', 'early_learning_goals'],
  ['Objective 1', 'objective_1'],
  ['Objective 2', 'objective_2'],
  ['Objective 3', 'objective_3'],
];

const ASSESSMENT_SECTIONS = [
  ['Assessment Method', 'assessment_method'],
  ['Assessment Criteria', 'assessment_criteria'],
];

const MATERIALS_SECTIONS = [['Materials Needed To Prepare', 'materials_needed']];

const PROCEDURE_SECTIONS = [
  ['Preliminaries — Activity & Goal', 'preliminaries_activity'],
  ['Lesson Proper — Activity & Goal', 'lesson_proper_activity'],
  ['Conclusion — Activity & Goal', 'conclusion_activity'],
];

const CLASS_SECTIONS = [
  ['Class — Considerations', 'class1_considerations'],
  ['Class — Adjustments', 'class1_adjustments'],
];

const REFLECTION_SECTIONS = [
  ['Successes', 'reflection_went_well'],
  ['Amazing Moments', 'reflection_amazing_moments'],
  ['Challenges', 'reflection_challenges'],
  ['Improvements', 'reflection_improvements'],
];

/** Fields verifiers can flag for revision (excludes Teacher's Reflection). */
const REVISION_FIELD_OPTIONS = [
  ...META_SECTIONS,
  ...GOALS_SECTIONS,
  ...ASSESSMENT_SECTIONS,
  ...MATERIALS_SECTIONS,
  ...PROCEDURE_SECTIONS,
  ...CLASS_SECTIONS,
];

const HEAD_TEACHER_REVIEW_FIELDS = [
  ['Overall Assessment', 'head_teacher_overall_assessment'],
  ['Specific Feedback', 'head_teacher_specific_feedback'],
  ['Next Steps', 'head_teacher_next_steps'],
];

const createRevisionItem = (partial = {}) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  field: partial.field || '',
  highlight: partial.highlight || '',
  note: partial.note || '',
});

const formatStatus = (status) => {
  if (status === 'awaiting_reflection') return 'Awaiting Reflection';
  if (status === 'completed') return 'Completed';
  return (status || '').replace(/_/g, ' ');
};

const statusBadgeClass = (status) => {
  if (status === 'completed') return 'bg-green-100 text-green-800';
  if (status === 'awaiting_reflection') return 'bg-amber-100 text-amber-800';
  if (status === 'submitted') return 'bg-blue-100 text-blue-800';
  return 'bg-amber-100 text-amber-800';
};

const sortPrograms = (a, b) => {
  const ai = GRADE_LEVEL_OPTIONS.indexOf(a);
  const bi = GRADE_LEVEL_OPTIONS.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
};

function FolderIcon({ className = 'h-14 w-14' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 12.5C2 9.46 4.46 7 7.5 7H22.2c1.1 0 2.15.48 2.87 1.32L28.2 12.5H56.5C59.54 12.5 62 14.96 62 18v24.5c0 3.04-2.46 5.5-5.5 5.5H7.5C4.46 48 2 45.54 2 42.5V12.5Z"
        fill="#F6C453"
      />
      <path
        d="M2 18.5h60V42.5c0 3.04-2.46 5.5-5.5 5.5H7.5C4.46 48 2 45.54 2 42.5V18.5Z"
        fill="#E8A317"
      />
      <path
        d="M2 12.5C2 9.46 4.46 7 7.5 7H22.2c1.1 0 2.15.48 2.87 1.32L28.2 12.5H7.5C4.46 12.5 2 14.96 2 18V12.5Z"
        fill="#FFD978"
      />
    </svg>
  );
}

function DocumentIcon({ className = 'h-10 w-10' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6 2h18l10 10v30a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z"
        fill="#FFF8F0"
        stroke="#D4A574"
        strokeWidth="1.5"
      />
      <path d="M24 2v8a2 2 0 0 0 2 2h8" fill="#FFE8CC" stroke="#D4A574" strokeWidth="1.5" />
      <path d="M10 22h20M10 28h20M10 34h14" stroke="#C4A484" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function FolderCard({ title, subtitle, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center rounded-xl border border-[#e8d4b8] bg-gradient-to-b from-[#fffaf3] to-[#fff3e0] p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-[#e0b96a] hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:p-5"
    >
      <div className="relative mb-3">
        <FolderIcon className="h-14 w-14 drop-shadow-sm transition group-hover:scale-105 sm:h-16 sm:w-16" />
        {badge != null && badge > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </div>
      <h3 className="line-clamp-2 w-full text-sm font-semibold text-gray-900 sm:text-base" title={title}>
        {title}
      </h3>
      {subtitle ? (
        <p className="mt-1 line-clamp-2 w-full text-xs text-gray-500 sm:text-sm">{subtitle}</p>
      ) : null}
    </button>
  );
}

function PlanFileCard({ plan, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-3 rounded-xl border border-[#e8d4b8] bg-white p-3 text-left shadow-sm transition hover:border-[#e0b96a] hover:bg-[#fffaf3] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:p-4"
    >
      <DocumentIcon className="mt-0.5 h-9 w-9 shrink-0 sm:h-10 sm:w-10" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-gray-900 sm:text-base" title={plan.topic}>
            {plan.topic || 'Untitled topic'}
          </h3>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeClass(
              plan.status
            )}`}
          >
            {formatStatus(plan.status)}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-gray-500 sm:text-sm">
          {plan.class_label || plan.subject || 'No class'}
          {plan.lesson_date ? ` · ${plan.lesson_date}` : ''}
        </p>
      </div>
    </button>
  );
}

function ReviewSection({
  title,
  fieldKey,
  content,
  canFlag,
  fieldChecked,
  onToggleField,
  onHighlightSelection,
}) {
  const controlCls =
    'inline-flex items-center gap-1.5 rounded-full border border-[#ffddc9] bg-[#fff0e6] px-2.5 py-1 text-[11px] font-semibold text-[#8a4b16] sm:text-xs';

  return (
    <section className="py-3">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-[16px] font-medium text-[#111111]">{title}</h4>
        {canFlag ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className={`${controlCls} cursor-pointer select-none`}>
              <input
                type="checkbox"
                checked={fieldChecked}
                onChange={(e) => onToggleField(fieldKey, title, e.target.checked)}
                className="h-3.5 w-3.5 rounded border-orange-300 text-primary-600 focus:ring-primary-500"
              />
              Field needs revision
            </label>
            <button
              type="button"
              onClick={() => onHighlightSelection(fieldKey, title)}
              className={`${controlCls} hover:bg-[#ffe8d6]`}
              title="Select text in this field first, then click"
            >
              Highlight selected text
            </button>
          </div>
        ) : null}
      </div>
      <div className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2.5 shadow-sm">
        <p className="min-h-[2.5rem] whitespace-pre-wrap text-[15px] leading-relaxed text-[#111111] selection:bg-amber-200">
          {content || '—'}
        </p>
      </div>
    </section>
  );
}

/**
 * Lesson Plan review for Superadmins (always) and configured Admin verifiers.
 * Folder navigation: Program (grade level) → Teacher → Lesson plans.
 * Admin verifiers only see plans for their designated branch (enforced by API).
 */
export default function SuperadminLessonPlans() {
  const { userInfo } = useAuth();
  const userType = userInfo?.user_type || userInfo?.userType;
  const homePath = userType === 'Admin' ? '/admin' : '/superadmin';
  const [accessChecked, setAccessChecked] = useState(false);
  const [isVerifier, setIsVerifier] = useState(false);
  const [lessonPlans, setLessonPlans] = useState([]);
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [selectedTeacherKey, setSelectedTeacherKey] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionMode, setRevisionMode] = useState(false);
  const [revisionItems, setRevisionItems] = useState([]);
  const [revisionGeneral, setRevisionGeneral] = useState('');
  const [reasonDraft, setReasonDraft] = useState(null);
  const [reasonNote, setReasonNote] = useState('');
  const [headTeacherOverallAssessment, setHeadTeacherOverallAssessment] = useState('');
  const [headTeacherSpecificFeedback, setHeadTeacherSpecificFeedback] = useState('');
  const [headTeacherNextSteps, setHeadTeacherNextSteps] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');

  const programFolders = useMemo(() => {
    const map = new Map();
    for (const plan of lessonPlans) {
      const program = plan.grade_level || 'Unassigned';
      if (!map.has(program)) {
        map.set(program, { program, plans: [], pending: 0 });
      }
      const entry = map.get(program);
      entry.plans.push(plan);
      if (plan.status === 'submitted') entry.pending += 1;
    }
    return [...map.values()].sort((a, b) => sortPrograms(a.program, b.program));
  }, [lessonPlans]);

  const teacherFolders = useMemo(() => {
    if (!selectedProgram) return [];
    const map = new Map();
    for (const plan of lessonPlans) {
      if ((plan.grade_level || 'Unassigned') !== selectedProgram) continue;
      const teacherId = plan.teacher_user_id ?? plan.teacher_name ?? 'unknown';
      const key = String(teacherId);
      if (!map.has(key)) {
        map.set(key, {
          key,
          teacherUserId: plan.teacher_user_id ?? null,
          teacherName: plan.teacher_name || 'Unknown teacher',
          plans: [],
          pending: 0,
        });
      }
      const entry = map.get(key);
      entry.plans.push(plan);
      if (plan.status === 'submitted') entry.pending += 1;
    }
    return [...map.values()].sort((a, b) => a.teacherName.localeCompare(b.teacherName));
  }, [lessonPlans, selectedProgram]);

  const selectedTeacher = useMemo(
    () => teacherFolders.find((t) => t.key === selectedTeacherKey) || null,
    [teacherFolders, selectedTeacherKey]
  );

  const teacherPlans = useMemo(() => {
    if (!selectedTeacher) return [];
    return selectedTeacher.plans
      .filter((plan) => statusFilter === 'all' || plan.status === statusFilter)
      .sort((a, b) => {
        const da = new Date(a.submitted_at || a.updated_at || a.lesson_date || 0).getTime();
        const db = new Date(b.submitted_at || b.updated_at || b.lesson_date || 0).getTime();
        return db - da;
      });
  }, [selectedTeacher, statusFilter]);

  const canReview = selectedPlan?.status === 'submitted';
  const showHeadTeacherForm = canReview && !revisionMode;
  const showSavedHeadTeacherReview =
    Boolean(selectedPlan) &&
    ['awaiting_reflection', 'completed'].includes(selectedPlan.status);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const responses = await Promise.all(
        REVIEW_STATUSES.map((status) =>
          apiRequest(`/lesson-plans?status=${status}&limit=100`)
        )
      );
      const plans = responses
        .flatMap((res) => res.data || [])
        .sort((a, b) => {
          const da = new Date(a.submitted_at || a.updated_at || 0).getTime();
          const db = new Date(b.submitted_at || b.updated_at || 0).getTime();
          return db - da;
        });
      setLessonPlans(plans);
      setSelectedPlan((current) => {
        if (!current) return null;
        return plans.find((p) => p.lesson_plan_id === current.lesson_plan_id) || null;
      });
    } catch (err) {
      setError(err.message || 'Failed to load lesson plans');
      setLessonPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest('/lesson-plans/verifiers/me');
        if (cancelled) return;
        const allowed = Boolean(res.data?.is_verifier);
        setIsVerifier(allowed);
        setAccessChecked(true);
        if (allowed) await fetchQueue();
        else setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setIsVerifier(false);
          setAccessChecked(true);
          setLoading(false);
          setError(err.message || 'Failed to check verifier access');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchQueue]);

  useEffect(() => {
    if (!selectedPlan) return undefined;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [selectedPlan]);

  const clearRevisionDraft = () => {
    setRevisionMode(false);
    setRevisionItems([]);
    setRevisionGeneral('');
    setReasonDraft(null);
    setReasonNote('');
    setHeadTeacherOverallAssessment('');
    setHeadTeacherSpecificFeedback('');
    setHeadTeacherNextSteps('');
  };

  const openProgram = (program) => {
    setSelectedProgram(program);
    setSelectedTeacherKey(null);
    setSelectedPlan(null);
    setStatusFilter('all');
    clearRevisionDraft();
  };

  const openTeacher = (teacherKey) => {
    setSelectedTeacherKey(teacherKey);
    setSelectedPlan(null);
    setStatusFilter('all');
    clearRevisionDraft();
  };

  const goToPrograms = () => {
    setSelectedProgram(null);
    setSelectedTeacherKey(null);
    setSelectedPlan(null);
    setStatusFilter('all');
    clearRevisionDraft();
  };

  const goToTeachers = () => {
    setSelectedTeacherKey(null);
    setSelectedPlan(null);
    setStatusFilter('all');
    clearRevisionDraft();
  };

  const isFieldChecked = (fieldKey) =>
    revisionItems.some((item) => item.field === fieldKey && !String(item.highlight || '').trim());

  const openReasonModal = (draft) => {
    setReasonDraft(draft);
    setReasonNote('');
  };

  const closeReasonModal = () => {
    setReasonDraft(null);
    setReasonNote('');
  };

  const confirmReasonModal = async () => {
    if (!reasonDraft) return;
    const note = reasonNote.trim();
    if (!note) {
      await appAlert('Please type a revision reason for this item.');
      return;
    }
    addRevisionItem({
      field: reasonDraft.fieldKey,
      highlight: reasonDraft.highlight || '',
      note,
    });
    closeReasonModal();
  };

  const getSelectedTextInDocument = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    return String(sel.toString() || '').trim();
  };

  const addRevisionItem = (partial = {}) => {
    setRevisionItems((prev) => [...prev, createRevisionItem(partial)]);
  };

  const handleToggleField = (fieldKey, title, checked) => {
    if (checked) {
      openReasonModal({
        mode: 'field',
        fieldKey,
        title,
        highlight: '',
      });
      return;
    }
    setRevisionItems((prev) =>
      prev.filter((item) => !(item.field === fieldKey && !String(item.highlight || '').trim()))
    );
  };

  const handleHighlightSelection = async (fieldKey, title) => {
    const highlight = getSelectedTextInDocument();
    if (!highlight) {
      await appAlert(
        'Select (highlight) text in that field first, then click Highlight selected text.'
      );
      return;
    }
    openReasonModal({
      mode: 'highlight',
      fieldKey,
      title,
      highlight,
    });
  };

  const updateRevisionItem = (id, patch) => {
    setRevisionItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const removeRevisionItem = (id) => {
    setRevisionItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleApprove = async () => {
    if (!selectedPlan) return;
    const ok = await appConfirm('Approve this lesson plan?');
    if (!ok) return;
    try {
      setReviewing(true);
      await apiRequest(`/lesson-plans/${selectedPlan.lesson_plan_id}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          head_teacher_overall_assessment: headTeacherOverallAssessment,
          head_teacher_specific_feedback: headTeacherSpecificFeedback,
          head_teacher_next_steps: headTeacherNextSteps,
        }),
      });
      await appAlert('Lesson plan verified. Status is now Awaiting Reflection.');
      setSelectedPlan(null);
      clearRevisionDraft();
      await fetchQueue();
    } catch (err) {
      setError(err.message || 'Failed to approve');
    } finally {
      setReviewing(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!selectedPlan) return;
    const items = revisionItems
      .map((item) => ({
        field: item.field || undefined,
        highlight: item.highlight.trim() || undefined,
        note: item.note.trim() || undefined,
      }))
      .filter((item) => item.field || item.highlight || item.note);
    const general = revisionGeneral.trim();
    if (items.length === 0 && !general) {
      await appAlert(
        'Add at least one flagged field/highlight, or a general note, before requesting revision.'
      );
      return;
    }
    try {
      setReviewing(true);
      await apiRequest(`/lesson-plans/${selectedPlan.lesson_plan_id}/request-revision`, {
        method: 'POST',
        body: JSON.stringify({ items, reason: general || undefined }),
      });
      await appAlert('Revision requested');
      clearRevisionDraft();
      setShowRevisionModal(false);
      setSelectedPlan(null);
      await fetchQueue();
    } catch (err) {
      setError(err.message || 'Failed to request revision');
    } finally {
      setReviewing(false);
    }
  };

  if (accessChecked && !isVerifier) {
    return <Navigate to={homePath} replace />;
  }

  const view =
    selectedProgram && selectedTeacherKey
      ? 'plans'
      : selectedProgram
        ? 'teachers'
        : 'programs';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Lesson Plan Review</h1>
        <p className="mt-1 text-sm text-gray-500">
          Browse folders: Program → Teacher → Lesson plans. Open a plan to approve or request
          revision.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Folder window */}
      <div className="overflow-hidden rounded-2xl border border-[#e0c9a0] bg-[#f7f0e4] shadow-sm">
        {/* Title bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e0c9a0] bg-gradient-to-r from-[#f0d9a8] to-[#e8c98a] px-3 py-2.5 sm:px-4">
          <FolderIcon className="h-6 w-6 shrink-0" />
          <nav
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm font-medium text-gray-800"
            aria-label="Folder path"
          >
            <button
              type="button"
              onClick={goToPrograms}
              className={`truncate rounded px-1.5 py-0.5 hover:bg-black/5 ${
                view === 'programs' ? 'font-semibold text-gray-900' : 'text-gray-700'
              }`}
            >
              Programs
            </button>
            {selectedProgram ? (
              <>
                <span className="text-gray-500" aria-hidden="true">
                  /
                </span>
                <button
                  type="button"
                  onClick={goToTeachers}
                  className={`truncate rounded px-1.5 py-0.5 hover:bg-black/5 ${
                    view === 'teachers' ? 'font-semibold text-gray-900' : 'text-gray-700'
                  }`}
                  title={selectedProgram}
                >
                  {selectedProgram}
                </button>
              </>
            ) : null}
            {selectedTeacher ? (
              <>
                <span className="text-gray-500" aria-hidden="true">
                  /
                </span>
                <span
                  className="truncate rounded px-1.5 py-0.5 font-semibold text-gray-900"
                  title={selectedTeacher.teacherName}
                >
                  {selectedTeacher.teacherName}
                </span>
              </>
            ) : null}
          </nav>
          {view !== 'programs' ? (
            <button
              type="button"
              onClick={view === 'plans' ? goToTeachers : goToPrograms}
              className="shrink-0 rounded-lg border border-[#d4b87a] bg-white/80 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white"
            >
              ← Back
            </button>
          ) : null}
        </div>

        <div className="bg-[#faf6ef] p-3 sm:p-5">
          {loading || !accessChecked ? (
            <p className="py-12 text-center text-sm text-gray-500">Loading folders…</p>
          ) : view === 'programs' ? (
            programFolders.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-500">No lesson plans found.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {programFolders.map((folder) => (
                  <FolderCard
                    key={folder.program}
                    title={folder.program}
                    subtitle={`${folder.plans.length} plan${folder.plans.length === 1 ? '' : 's'}`}
                    badge={folder.pending}
                    onClick={() => openProgram(folder.program)}
                  />
                ))}
              </div>
            )
          ) : view === 'teachers' ? (
            teacherFolders.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-500">
                No teachers with lesson plans in this program.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {teacherFolders.map((folder) => (
                  <FolderCard
                    key={folder.key}
                    title={folder.teacherName}
                    subtitle={`${folder.plans.length} plan${folder.plans.length === 1 ? '' : 's'}`}
                    badge={folder.pending}
                    onClick={() => openTeacher(folder.key)}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600">
                  Showing {teacherPlans.length} lesson plan
                  {teacherPlans.length === 1 ? '' : 's'}
                  {selectedTeacher ? (
                    <>
                      {' '}
                      for <span className="font-semibold text-gray-800">{selectedTeacher.teacherName}</span>
                    </>
                  ) : null}
                </p>
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                  Status
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-[#e0c9a0] bg-white px-3 py-2 text-sm font-normal text-gray-800"
                  >
                    <option value="all">All</option>
                    {REVIEW_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {formatStatus(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {teacherPlans.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-500">
                  No lesson plans match this filter.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {teacherPlans.map((plan) => (
                    <PlanFileCard
                      key={plan.lesson_plan_id}
                      plan={plan}
                      onClick={() => setSelectedPlan(plan)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedPlan &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black/55 p-3 sm:p-5 lg:p-8"
            onClick={() => {
              setSelectedPlan(null);
              setShowRevisionModal(false);
              clearRevisionDraft();
            }}
            role="presentation"
          >
            <div
              className="relative flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-md bg-[#f3f4f6] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Lesson plan details"
            >
              <button
                type="button"
                onClick={() => {
                  setSelectedPlan(null);
                  setShowRevisionModal(false);
                  clearRevisionDraft();
                }}
                className="absolute right-3 top-2 z-20 flex h-10 w-10 items-center justify-center text-[34px] font-bold leading-none text-[#d32f2f] hover:text-red-800"
                aria-label="Close"
              >
                ×
              </button>

              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 lg:p-8"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 #f7fafc',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <div
                  className="mx-auto w-full max-w-[960px] rounded-md border border-[#eeeeee] bg-white px-5 py-6 text-[#111111] shadow-[0_10px_30px_rgba(0,0,0,0.08)] sm:px-10 sm:py-9 lg:px-[42px] lg:py-[34px]"
                  style={{ fontFamily: '"Poppins", "Inter", "Segoe UI", sans-serif' }}
                >
                  <LessonPlanHeader branch={selectedPlan} />

                  <div className="mb-4 border-t-2 border-[#111111]" />

                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1.5 text-xs font-bold capitalize ${statusBadgeClass(
                        selectedPlan.status
                      )}`}
                    >
                      {formatStatus(selectedPlan.status)}
                    </span>
                    <span className="text-[15px] text-[#666666]">
                      Prepared by {selectedPlan.teacher_name || 'Unknown'}
                    </span>
                  </div>

                  <div className="mb-2 grid grid-cols-1 gap-x-[34px] gap-y-3 sm:grid-cols-2">
                    <p className="text-[16px] text-[#111111]">
                      <span className="font-medium">Lesson Date</span>{' '}
                      <span className="font-normal">{selectedPlan.lesson_date || '—'}</span>
                    </p>
                    <p className="text-[16px] text-[#111111]">
                      <span className="font-medium">Grade Level</span>{' '}
                      <span className="font-normal">{selectedPlan.grade_level || '—'}</span>
                    </p>
                    <p className="col-span-full text-[16px] text-[#111111]">
                      <span className="font-medium">Class</span>{' '}
                      <span className="font-normal">
                        {selectedPlan.class_label || selectedPlan.subject || '—'}
                      </span>
                    </p>
                  </div>

                  {canReview && revisionMode ? (
                    <p className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Check <strong>Field needs revision</strong> to mark a whole section, or select
                      text and click <strong>Highlight selected text</strong>. Each action asks for a
                      reason. Then use <strong>Review &amp; submit revision</strong>.
                      {revisionItems.length > 0 ? (
                        <span className="ml-1 font-semibold">
                          ({revisionItems.length} item{revisionItems.length === 1 ? '' : 's'})
                        </span>
                      ) : null}
                    </p>
                  ) : null}

                  {[
                    { heading: null, sections: META_SECTIONS },
                    { heading: 'Goals & Objectives', sections: GOALS_SECTIONS },
                    { heading: 'Assessment', sections: ASSESSMENT_SECTIONS },
                    { heading: null, sections: MATERIALS_SECTIONS },
                    { heading: 'Procedure', sections: PROCEDURE_SECTIONS },
                    {
                      heading: 'Class-Specific Adjustments',
                      sections: CLASS_SECTIONS,
                    },
                  ].map((group) => (
                    <div key={group.heading || group.sections[0][1]}>
                      {group.heading ? (
                        <h4 className="mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-[18px] font-bold text-[#111111]">
                          {group.heading}
                        </h4>
                      ) : null}
                      {group.sections.map(([title, key]) => (
                        <ReviewSection
                          key={key}
                          title={title}
                          fieldKey={key}
                          content={
                            key === 'class_id'
                              ? selectedPlan.class_label || selectedPlan.subject
                              : selectedPlan[key]
                          }
                          canFlag={canReview && revisionMode}
                          fieldChecked={isFieldChecked(key)}
                          onToggleField={handleToggleField}
                          onHighlightSelection={handleHighlightSelection}
                        />
                      ))}
                    </div>
                  ))}

                  <h4 className="mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-[18px] font-bold text-[#111111]">
                    Teacher&apos;s Reflection
                  </h4>
                  {REFLECTION_SECTIONS.map(([title, key]) => (
                    <section key={key} className="py-3">
                      <h4 className="mb-1.5 text-[16px] font-medium text-[#111111]">{title}</h4>
                      <div className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2.5 shadow-sm">
                        <p className="min-h-[2.5rem] whitespace-pre-wrap text-[15px] leading-relaxed text-[#111111]">
                          {selectedPlan[key] || '—'}
                        </p>
                      </div>
                    </section>
                  ))}

                  {(showHeadTeacherForm || showSavedHeadTeacherReview) && (
                    <>
                      <h4 className="mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-[18px] font-bold text-[#111111]">
                        Head Teacher&apos;s Review and Feedback
                      </h4>
                      {showHeadTeacherForm ? (
                        <div className="space-y-3 py-3">
                          <p className="text-xs text-gray-500">
                            Complete this review before approving. Feedback is saved with the
                            verification.
                          </p>
                          <label className="block text-[16px] font-medium text-[#111111]">
                            Overall Assessment
                            <textarea
                              value={headTeacherOverallAssessment}
                              onChange={(e) => setHeadTeacherOverallAssessment(e.target.value)}
                              rows={3}
                              className="mt-1.5 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2.5 text-[15px] leading-relaxed text-[#111111] shadow-sm"
                              placeholder="Overall assessment of this lesson plan"
                            />
                          </label>
                          <label className="block text-[16px] font-medium text-[#111111]">
                            Specific Feedback
                            <textarea
                              value={headTeacherSpecificFeedback}
                              onChange={(e) => setHeadTeacherSpecificFeedback(e.target.value)}
                              rows={3}
                              className="mt-1.5 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2.5 text-[15px] leading-relaxed text-[#111111] shadow-sm"
                              placeholder="Specific feedback for the teacher"
                            />
                          </label>
                          <label className="block text-[16px] font-medium text-[#111111]">
                            Next Steps
                            <textarea
                              value={headTeacherNextSteps}
                              onChange={(e) => setHeadTeacherNextSteps(e.target.value)}
                              rows={3}
                              className="mt-1.5 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2.5 text-[15px] leading-relaxed text-[#111111] shadow-sm"
                              placeholder="Recommended next steps"
                            />
                          </label>
                        </div>
                      ) : (
                        HEAD_TEACHER_REVIEW_FIELDS.map(([title, key]) => (
                          <section key={key} className="py-3">
                            <h4 className="mb-1.5 text-[16px] font-medium text-[#111111]">
                              {title}
                            </h4>
                            <div className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2.5 shadow-sm">
                              <p className="min-h-[2.5rem] whitespace-pre-wrap text-[15px] leading-relaxed text-[#111111]">
                                {selectedPlan[key] || '—'}
                              </p>
                            </div>
                          </section>
                        ))
                      )}
                    </>
                  )}
                </div>
              </div>

              {canReview && (
                <div className="flex shrink-0 flex-col gap-2 border-t border-[#eeeeee] bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-8">
                  {revisionMode ? (
                    <>
                      <button
                        type="button"
                        disabled={reviewing}
                        onClick={() => {
                          setRevisionMode(false);
                          setShowRevisionModal(false);
                          setRevisionItems([]);
                          setRevisionGeneral('');
                          closeReasonModal();
                        }}
                        className="rounded-lg border border-[#eeeeee] bg-white px-4 py-[11px] text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Cancel flagging
                      </button>
                      <button
                        type="button"
                        disabled={reviewing}
                        onClick={() => setShowRevisionModal(true)}
                        className="rounded-lg border border-[#eeeeee] bg-white px-4 py-[11px] text-sm font-semibold text-[#333333] hover:bg-[#fff0e6] disabled:opacity-50"
                      >
                        Review & submit revision
                        {revisionItems.length > 0 ? ` (${revisionItems.length})` : ''}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={reviewing}
                      onClick={() => setRevisionMode(true)}
                      className="rounded-lg border border-[#eeeeee] bg-white px-4 py-[11px] text-sm font-semibold text-[#333333] hover:bg-[#fff0e6] disabled:opacity-50"
                    >
                      Request revision
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={reviewing || revisionMode}
                    onClick={handleApprove}
                    className="rounded-lg border border-[#ffddc9] bg-[#ffddc9] px-4 py-[11px] text-sm font-semibold text-[#333333] hover:bg-[#fff0e6] disabled:opacity-50"
                  >
                    {reviewing ? 'Saving…' : 'Approve'}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {reasonDraft &&
        createPortal(
          <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
              <h2 className="text-lg font-semibold text-gray-900">Add Revision Reason</h2>
              <p className="mt-1 text-sm text-gray-500">
                {reasonDraft.mode === 'highlight'
                  ? `Why does this highlighted text in "${reasonDraft.title}" need revision?`
                  : `Why does "${reasonDraft.title}" need revision?`}
              </p>
              {reasonDraft.highlight ? (
                <blockquote className="mt-3 border-l-2 border-amber-400 bg-amber-50/80 px-3 py-2 text-sm italic text-gray-800">
                  “{reasonDraft.highlight}”
                </blockquote>
              ) : null}
              <textarea
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                rows={5}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Type the specific reason for this revision item."
                autoFocus
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeReasonModal}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmReasonModal}
                  className="rounded-lg border border-[#ffddc9] bg-[#ffddc9] px-4 py-2 text-sm font-semibold text-[#333333] hover:bg-[#fff0e6]"
                >
                  Add Reason
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showRevisionModal &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-3 sm:p-4">
            <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
              <div className="border-b border-gray-100 px-5 py-4">
                <h2 className="text-lg font-semibold text-gray-900">Request revision</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Review items marked with <strong>Field needs revision</strong> or{' '}
                  <strong>Highlight selected text</strong>, then submit to the teacher.
                </p>
              </div>

              <div
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
                style={{ scrollbarWidth: 'thin' }}
              >
                {revisionItems.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No items yet. Add a field flag or highlighted quote below.
                  </p>
                ) : (
                  revisionItems.map((item, index) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-amber-100 bg-amber-50/60 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-amber-900">
                          Item {index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeRevisionItem(item.id)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                      <label className="mb-2 block text-xs font-semibold text-gray-600">
                        Field (optional)
                        <select
                          value={item.field}
                          onChange={(e) => updateRevisionItem(item.id, { field: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800"
                        >
                          <option value="">— General / no specific field —</option>
                          {REVISION_FIELD_OPTIONS.map(([label, key]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="mb-2 block text-xs font-semibold text-gray-600">
                        Highlighted text to revise (optional)
                        <textarea
                          value={item.highlight}
                          onChange={(e) =>
                            updateRevisionItem(item.id, { highlight: e.target.value })
                          }
                          rows={3}
                          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800"
                          placeholder='e.g. Show pictures and let the kids identify the beginning sound…'
                        />
                      </label>
                      <label className="block text-xs font-semibold text-gray-600">
                        Note to teacher (optional)
                        <textarea
                          value={item.note}
                          onChange={(e) => updateRevisionItem(item.id, { note: e.target.value })}
                          rows={2}
                          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800"
                          placeholder="What should they change?"
                        />
                      </label>
                    </div>
                  ))
                )}

                <button
                  type="button"
                  onClick={() => addRevisionItem({})}
                  className="w-full rounded-lg border border-dashed border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-50"
                >
                  + Add another item
                </button>

                <label className="block text-xs font-semibold text-gray-600">
                  General note (optional)
                  <textarea
                    value={revisionGeneral}
                    onChange={(e) => setRevisionGeneral(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal text-gray-800"
                    placeholder="Overall feedback for the teacher"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setShowRevisionModal(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={reviewing}
                  onClick={handleRequestRevision}
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Submit revision request
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
