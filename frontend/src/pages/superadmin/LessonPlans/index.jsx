import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate } from 'react-router-dom';
import { apiRequest } from '../../../config/api';
import { useAuth } from '../../../contexts/AuthContext';
import { useGlobalBranchFilter } from '../../../contexts/GlobalBranchFilterContext';
import { appAlert, appConfirm } from '../../../utils/appAlert';
import { LessonPlanHeader } from '../../../components/lessonPlanHeader';
import LessonPlanSubmissionsTable from '../../../components/lessonPlanSubmissionsTable';
import LessonPlanMissedTable from '../../../components/lessonPlanMissedTable';
import LessonPlanDateFilter from '../../../components/lessonPlanDateFilter';
import {
  formatLessonPlanDateDisplay,
} from '../../../utils/lessonPlanPhaseSession';
import RichTextEditor, {
  isRichTextEmpty,
  LESSON_PLAN_RICH_TEXT_HTML_CLASS,
  isLessonPlanRichTextField,
} from '../../../components/richTextEditor';

const PENDING_STATUSES = ['submitted'];
const REVISION_STATUSES = ['revision_requested'];
const VERIFIED_STATUSES = ['awaiting_reflection', 'completed'];
const REVIEW_STATUSES = [...PENDING_STATUSES, ...REVISION_STATUSES, ...VERIFIED_STATUSES];

const TAB_STATUSES = {
  pending: PENDING_STATUSES,
  revision: REVISION_STATUSES,
  verified: VERIFIED_STATUSES,
};

const TAB_EMPTY_MESSAGES = {
  pending: 'No pending lesson plans to review.',
  revision: 'No lesson plans awaiting teacher revision.',
  verified: 'No verified lesson plans yet.',
  missed: 'No missed lesson plans. All overdue sessions have a submitted plan.',
};

const TAB_LABELS = {
  pending: 'pending',
  revision: 'revision',
  verified: 'verified',
  missed: 'missed',
};

/** LCA form sections shown in PDF order (flaggable when in revision mode). */
const META_SECTIONS = [
  ['Lesson Topic', 'topic'],
  ['Phase', 'phase'],
  ['Session', 'session'],
  ['Class', 'class_id'],
];

const GOALS_SECTIONS = [
  ['Early Learning Goals', 'early_learning_goals'],
  ['Learning Objectives', 'objective_1'],
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
  note: partial.note || '',
});

const formatStatus = (status) => {
  if (status === 'awaiting_reflection') return 'Awaiting Reflection';
  if (status === 'completed') return 'Completed';
  if (status === 'revision_requested') return 'Revision requested';
  return (status || '').replace(/_/g, ' ');
};

const statusBadgeClass = (status) => {
  if (status === 'completed') return 'bg-green-100 text-green-800';
  if (status === 'awaiting_reflection') return 'bg-amber-100 text-amber-800';
  if (status === 'submitted') return 'bg-blue-100 text-blue-800';
  return 'bg-amber-100 text-amber-800';
};

function normalizeGradeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, ' ');
}

function ReviewSection({
  title,
  fieldKey,
  content,
  canFlag,
  fieldChecked,
  onToggleField,
  html = false,
}) {
  const controlCls =
    'inline-flex items-center gap-1.5 rounded-full border border-[#ffddc9] bg-[#fff0e6] px-2.5 py-1 text-[11px] font-semibold text-[#8a4b16] sm:text-xs';

  return (
    <section className="py-3">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h4 className="text-[16px] font-medium text-[#111111]">{title}</h4>
        {canFlag ? (
          <label className={`${controlCls} cursor-pointer select-none`}>
            <input
              type="checkbox"
              checked={fieldChecked}
              onChange={(e) => onToggleField(fieldKey, title, e.target.checked)}
              className="h-3.5 w-3.5 rounded border-orange-300 text-primary-600 focus:ring-primary-500"
            />
            Field needs revision
          </label>
        ) : null}
      </div>
      <div className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2.5 shadow-sm">
        {html ? (
          <div
            className={LESSON_PLAN_RICH_TEXT_HTML_CLASS}
            dangerouslySetInnerHTML={{ __html: content || '—' }}
          />
        ) : (
          <p className="min-h-[2.5rem] whitespace-pre-wrap text-[15px] leading-relaxed text-[#111111]">
            {content || '—'}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Lesson Plan review for Superadmins (always) and configured Admin verifiers.
 * Table UI with Pending / Revision / Verified tabs (same column layout as teacher Lesson Plans).
 * Superadmin: header branch filter via GlobalBranchFilter. Admin: designated branch only (API-enforced).
 */
export default function SuperadminLessonPlans() {
  const { userInfo } = useAuth();
  const { selectedBranchId: globalBranchId } = useGlobalBranchFilter();
  const userType = userInfo?.user_type || userInfo?.userType;
  const isSuperadmin = userType === 'Superadmin';
  const homePath = userType === 'Admin' ? '/admin' : '/superadmin';
  const [accessChecked, setAccessChecked] = useState(false);
  const [isVerifier, setIsVerifier] = useState(false);
  const [lessonPlans, setLessonPlans] = useState([]);
  const [missedPlans, setMissedPlans] = useState([]);
  const [missedSince, setMissedSince] = useState('');
  const [missedDefaultSince, setMissedDefaultSince] = useState('');
  const [reviewTab, setReviewTab] = useState('pending');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [selectedPlan, setSelectedPlan] = useState(null);
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
  const [missedLoading, setMissedLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');

  const canReview = selectedPlan?.status === 'submitted';
  const showHeadTeacherForm = canReview && !revisionMode;
  const showSavedHeadTeacherReview =
    Boolean(selectedPlan) &&
    ['awaiting_reflection', 'completed'].includes(selectedPlan.status);
  const canApprove =
    canReview &&
    !revisionMode &&
    !isRichTextEmpty(headTeacherOverallAssessment) &&
    !isRichTextEmpty(headTeacherSpecificFeedback) &&
    !isRichTextEmpty(headTeacherNextSteps);

  const fetchMissed = useCallback(async (sinceValue = '') => {
    setMissedLoading(true);
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (isSuperadmin && globalBranchId) {
        params.set('branch_id', String(globalBranchId));
      }
      const since = String(sinceValue || '').trim().slice(0, 10);
      if (since) params.set('since', since);
      const missedRes = await apiRequest(`/lesson-plans/missed?${params.toString()}`);
      setMissedPlans(Array.isArray(missedRes?.data) ? missedRes.data : []);
      const metaSince = String(missedRes?.meta?.since || '').slice(0, 10);
      const metaDefault = String(missedRes?.meta?.default_since || '').slice(0, 10);
      if (metaDefault) setMissedDefaultSince(metaDefault);
      if (metaSince) setMissedSince(metaSince);
    } catch (err) {
      setMissedPlans([]);
      throw err;
    } finally {
      setMissedLoading(false);
    }
  }, [isSuperadmin, globalBranchId]);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const branchQs =
        isSuperadmin && globalBranchId
          ? `&branch_id=${encodeURIComponent(globalBranchId)}`
          : '';
      const [responses] = await Promise.all([
        Promise.all(
          REVIEW_STATUSES.map((status) =>
            apiRequest(`/lesson-plans?status=${status}&limit=100${branchQs}`)
          )
        ),
        fetchMissed(),
      ]);
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
      setMissedPlans([]);
    } finally {
      setLoading(false);
    }
  }, [isSuperadmin, globalBranchId, fetchMissed]);

  const pendingCount = useMemo(
    () => lessonPlans.filter((p) => PENDING_STATUSES.includes(p.status)).length,
    [lessonPlans]
  );

  const revisionCount = useMemo(
    () => lessonPlans.filter((p) => REVISION_STATUSES.includes(p.status)).length,
    [lessonPlans]
  );

  const verifiedCount = useMemo(
    () => lessonPlans.filter((p) => VERIFIED_STATUSES.includes(p.status)).length,
    [lessonPlans]
  );

  const missedCount = missedPlans.length;

  const filterGradeOptions = useMemo(() => {
    const source = reviewTab === 'missed' ? missedPlans : lessonPlans;
    const grades = source
      .map((p) => String(p.grade_level || '').trim())
      .filter(Boolean);
    return [...new Set(grades)].sort((a, b) => a.localeCompare(b));
  }, [lessonPlans, missedPlans, reviewTab]);

  const filteredPlans = useMemo(() => {
    if (reviewTab === 'missed') return [];
    const tabStatuses = TAB_STATUSES[reviewTab] || PENDING_STATUSES;
    const q = searchTerm.trim().toLowerCase();
    return lessonPlans.filter((p) => {
      if (!tabStatuses.includes(p.status)) return false;
      if (gradeFilter !== 'all') {
        if (normalizeGradeKey(p.grade_level) !== normalizeGradeKey(gradeFilter)) {
          return false;
        }
      }
      if (dateFilter) {
        const planDate = String(p.lesson_date || '').slice(0, 10);
        if (planDate !== dateFilter) return false;
      }
      if (!q) return true;
      const haystack = [
        p.topic,
        p.grade_level,
        p.class_label,
        p.class_code,
        p.subject,
        p.phase,
        p.session,
        p.status,
        p.teacher_name,
        p.branch_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [lessonPlans, reviewTab, searchTerm, gradeFilter, dateFilter]);

  const filteredMissedPlans = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return missedPlans.filter((p) => {
      if (gradeFilter !== 'all') {
        if (normalizeGradeKey(p.grade_level) !== normalizeGradeKey(gradeFilter)) {
          return false;
        }
      }
      if (!q) return true;
      const haystack = [
        p.topic,
        p.grade_level,
        p.class_label,
        p.class_code,
        p.phase,
        p.session,
        p.teacher_name,
        p.branch_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [missedPlans, searchTerm, gradeFilter]);

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    gradeFilter !== 'all' ||
    (reviewTab !== 'missed' && Boolean(dateFilter)) ||
    (reviewTab === 'missed' &&
      Boolean(missedSince) &&
      Boolean(missedDefaultSince) &&
      missedSince !== missedDefaultSince);

  const handleMissedSinceChange = async (ymd) => {
    const next = String(ymd || '').slice(0, 10);
    setMissedSince(next);
    setError('');
    try {
      await fetchMissed(next || '');
    } catch (err) {
      setError(err.message || 'Failed to load missed lesson plans');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (userType === 'Superadmin') {
        if (cancelled) return;
        setIsVerifier(true);
        setAccessChecked(true);
        try {
          await fetchQueue();
        } catch (err) {
          if (!cancelled) {
            setLoading(false);
            setError(err.message || 'Failed to load lesson plans');
          }
        }
        return;
      }

      if (userType === 'Admin') {
        const profileVerifier = Boolean(
          userInfo?.is_lesson_plan_verifier || userInfo?.isLessonPlanVerifier
        );
        try {
          const res = await apiRequest('/lesson-plans/verifiers/me');
          if (cancelled) return;
          const allowed = Boolean(res.data?.is_verifier) || profileVerifier;
          setIsVerifier(allowed);
          setAccessChecked(true);
          if (allowed) await fetchQueue();
          else setLoading(false);
        } catch (err) {
          if (!cancelled) {
            const allowed = profileVerifier;
            setIsVerifier(allowed);
            setAccessChecked(true);
            if (allowed) {
              try {
                await fetchQueue();
              } catch (queueErr) {
                setLoading(false);
                setError(queueErr.message || 'Failed to load lesson plans');
              }
            } else {
              setLoading(false);
              setError(err.message || 'Failed to check verifier access');
            }
          }
        }
        return;
      }

      if (!cancelled) {
        setIsVerifier(false);
        setAccessChecked(true);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userType, userInfo?.is_lesson_plan_verifier, userInfo?.isLessonPlanVerifier, fetchQueue]);

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

  const isFieldChecked = (fieldKey) =>
    revisionItems.some((item) => item.field === fieldKey);

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
      note,
    });
    closeReasonModal();
  };

  const addRevisionItem = (partial = {}) => {
    setRevisionItems((prev) => [...prev, createRevisionItem(partial)]);
  };

  const handleToggleField = (fieldKey, title, checked) => {
    if (checked) {
      openReasonModal({
        fieldKey,
        title,
      });
      return;
    }
    setRevisionItems((prev) => prev.filter((item) => item.field !== fieldKey));
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
    const missing = [];
    if (isRichTextEmpty(headTeacherOverallAssessment)) missing.push('Overall Assessment');
    if (isRichTextEmpty(headTeacherSpecificFeedback)) missing.push('Specific Feedback');
    if (isRichTextEmpty(headTeacherNextSteps)) missing.push('Next Steps');
    if (missing.length) {
      await appAlert(
        `Complete Head Teacher's Review and Feedback before approving: ${missing.join(', ')}.`
      );
      document.getElementById('head-teacher-review-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      return;
    }
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
        note: item.note.trim() || undefined,
      }))
      .filter((item) => item.field || item.note);
    const general = revisionGeneral.trim();
    if (items.length === 0 && !general) {
      await appAlert(
        'Add at least one flagged field, or a general note, before requesting revision.'
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

  const openReviewPlan = (plan) => {
    clearRevisionDraft();
    setShowRevisionModal(false);
    setSelectedPlan(plan);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Lesson Plan Review</h1>
        <p className="mt-1 text-sm text-gray-600">
          Review submitted lesson plans, or open the Missed tab to see overdue sessions without a submission.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex flex-wrap gap-2" aria-label="Lesson plan review tabs">
          {[
            { key: 'pending', label: 'Pending', count: pendingCount },
            { key: 'revision', label: 'Revision', count: revisionCount },
            { key: 'verified', label: 'Verified', count: verifiedCount },
            { key: 'missed', label: 'Missed', count: missedCount },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setReviewTab(tab.key)}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                reviewTab === tab.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  reviewTab === tab.key
                    ? 'bg-primary-100 text-primary-800'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </nav>
      </div>

      <div className="rounded-lg bg-white p-4 shadow">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="min-w-0 sm:col-span-2 xl:col-span-1">
            <label
              htmlFor="lesson-plan-review-search"
              className="mb-1 block text-xs font-medium text-gray-700"
            >
              Search
            </label>
            <div className="relative">
              <input
                id="lesson-plan-review-search"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by topic, teacher, class code, or grade..."
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 pr-9 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Clear search"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
          {reviewTab === 'missed' ? (
            <LessonPlanDateFilter
              id="lesson-plan-missed-since"
              label="Track from"
              value={missedSince}
              onChange={handleMissedSinceChange}
            />
          ) : (
            <LessonPlanDateFilter value={dateFilter} onChange={setDateFilter} />
          )}
          <div className="min-w-0">
            <label
              htmlFor="lesson-plan-review-grade"
              className="mb-1 block text-xs font-medium text-gray-700"
            >
              Grade Level
            </label>
            <select
              id="lesson-plan-review-grade"
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              aria-label="Filter by grade level"
            >
              <option value="all">All Grade Levels</option>
              {filterGradeOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {reviewTab === 'missed' ? (
        <LessonPlanMissedTable
          rows={filteredMissedPlans}
          loading={missedLoading || !accessChecked}
          showTeacher
          emptyMessage={
            hasActiveFilters
              ? 'No matching missed lesson plans. Try adjusting your search or filters.'
              : TAB_EMPTY_MESSAGES.missed
          }
          showingLabel={
            !missedLoading && filteredMissedPlans.length > 0
              ? `Showing ${filteredMissedPlans.length} missed lesson plan${
                  filteredMissedPlans.length === 1 ? '' : 's'
                }${missedSince ? ` (from ${missedSince})` : ''}`
              : ''
          }
        />
      ) : (
        <LessonPlanSubmissionsTable
          plans={filteredPlans}
          loading={loading || !accessChecked}
          emptyMessage={
            hasActiveFilters
              ? 'No matching lesson plans. Try adjusting your search or filters.'
              : TAB_EMPTY_MESSAGES[reviewTab] || TAB_EMPTY_MESSAGES.pending
          }
          showingLabel={
            !loading && filteredPlans.length > 0
              ? `Showing ${filteredPlans.length} ${TAB_LABELS[reviewTab] || 'pending'} lesson plan${
                  filteredPlans.length === 1 ? '' : 's'
                }`
              : ''
          }
          activePlanId={selectedPlan?.lesson_plan_id ?? null}
          timestampMode={reviewTab === 'verified' ? 'verified' : 'submitted'}
          showTeacher
          onView={openReviewPlan}
          onSelect={openReviewPlan}
        />
      )}

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
                      <span className="font-normal">
                        {formatLessonPlanDateDisplay(selectedPlan.lesson_date) || '—'}
                      </span>
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
                      Check <strong>Field needs revision</strong> to mark a section. Each flag asks
                      for a reason. Then use <strong>Review &amp; submit revision</strong>.
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
                          html={isLessonPlanRichTextField(key)}
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
                        {isLessonPlanRichTextField(key) ? (
                          <div
                            className={LESSON_PLAN_RICH_TEXT_HTML_CLASS}
                            dangerouslySetInnerHTML={{
                              __html: selectedPlan[key] || '—',
                            }}
                          />
                        ) : (
                          <p className="min-h-[2.5rem] whitespace-pre-wrap text-[15px] leading-relaxed text-[#111111]">
                            {selectedPlan[key] || '—'}
                          </p>
                        )}
                      </div>
                    </section>
                  ))}

                  {(showHeadTeacherForm || showSavedHeadTeacherReview) && (
                    <>
                      <h4
                        id="head-teacher-review-section"
                        className="mb-1 mt-3 scroll-mt-4 border-t-2 border-[#111111] pt-2.5 text-[18px] font-bold text-[#111111]"
                      >
                        Head Teacher&apos;s Review and Feedback
                      </h4>
                      {showHeadTeacherForm ? (
                        <div className="space-y-3 py-3">
                          <p className="text-xs text-amber-800">
                            Required before Approve. Enter Overall Assessment, Specific Feedback,
                            and Next Steps.
                          </p>
                          <label className="block text-[16px] font-medium text-[#111111]">
                            Overall Assessment <span className="text-red-600">*</span>
                            <div className="mt-1.5">
                              <RichTextEditor
                                id="head-teacher-overall-assessment"
                                value={headTeacherOverallAssessment}
                                onChange={setHeadTeacherOverallAssessment}
                                placeholder="Overall assessment of this lesson plan"
                                minHeight="120px"
                              />
                            </div>
                          </label>
                          <label className="block text-[16px] font-medium text-[#111111]">
                            Specific Feedback <span className="text-red-600">*</span>
                            <div className="mt-1.5">
                              <RichTextEditor
                                id="head-teacher-specific-feedback"
                                value={headTeacherSpecificFeedback}
                                onChange={setHeadTeacherSpecificFeedback}
                                placeholder="Specific feedback for the teacher"
                                minHeight="120px"
                              />
                            </div>
                          </label>
                          <label className="block text-[16px] font-medium text-[#111111]">
                            Next Steps <span className="text-red-600">*</span>
                            <div className="mt-1.5">
                              <RichTextEditor
                                id="head-teacher-next-steps"
                                value={headTeacherNextSteps}
                                onChange={setHeadTeacherNextSteps}
                                placeholder="Recommended next steps"
                                minHeight="120px"
                              />
                            </div>
                          </label>
                        </div>
                      ) : (
                        HEAD_TEACHER_REVIEW_FIELDS.map(([title, key]) => (
                          <section key={key} className="py-3">
                            <h4 className="mb-1.5 text-[16px] font-medium text-[#111111]">
                              {title}
                            </h4>
                            <div className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2.5 shadow-sm">
                              <div
                                className={LESSON_PLAN_RICH_TEXT_HTML_CLASS}
                                dangerouslySetInnerHTML={{
                                  __html: selectedPlan[key] || '—',
                                }}
                              />
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
                    disabled={reviewing || revisionMode || !canApprove}
                    onClick={handleApprove}
                    title={
                      !canApprove && canReview && !revisionMode
                        ? "Complete Head Teacher's Review and Feedback before approving"
                        : undefined
                    }
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
                Why does &quot;{reasonDraft.title}&quot; need revision?
              </p>
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
                  Review items marked with <strong>Field needs revision</strong>, then submit to the
                  teacher.
                </p>
              </div>

              <div
                className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4"
                style={{ scrollbarWidth: 'thin' }}
              >
                {revisionItems.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No items yet. Flag a field above or add an item below.
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
