import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate } from 'react-router-dom';
import { apiRequest } from '../../../config/api';
import { useAuth } from '../../../contexts/AuthContext';
import { appAlert, appConfirm } from '../../../utils/appAlert';
import { LessonPlanHeader } from '../../../components/lessonPlanHeader';

const REVIEW_STATUSES = ['submitted', 'revision_requested', 'approved'];

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

const INTRO_SECTIONS = [
  ['Learning Objectives', 'learning_objectives'],
  ['Materials/Resources', 'materials_resources'],
];

const LESSON_FLOW_SECTIONS = [
  ['I. Opening Routine', 'opening_routine'],
  ['II. Review', 'review'],
  ['III. Lesson Presentation', 'lesson_presentation'],
  ['IV. Guided Practice', 'guided_practice'],
  ['VI. Assessment', 'assessment'],
  ['VII. Closing/Wrapping Up', 'closing_wrapping_up'],
];

const REFLECTION_SECTIONS = [
  ['What went well?', 'reflection_went_well'],
  ['What challenges occurred?', 'reflection_challenges'],
  ['What can be improved?', 'reflection_improvements'],
];

const formatStatus = (status) => (status || '').replace(/_/g, ' ');

const statusBadgeClass = (status) => {
  if (status === 'approved') return 'bg-green-100 text-green-800';
  if (status === 'submitted') return 'bg-blue-100 text-blue-800';
  return 'bg-amber-100 text-amber-800';
};

/**
 * Lesson Plan review for configured Superadmin/Admin verifiers.
 * Admin verifiers only see plans for their designated branch (enforced by API).
 * UI guided by QA_LessonPlans.jsx: grade cards → filtered list → detail modal.
 */
export default function SuperadminLessonPlans() {
  const { userInfo } = useAuth();
  const userType = userInfo?.user_type || userInfo?.userType;
  const homePath = userType === 'Admin' ? '/admin' : '/superadmin';
  const [accessChecked, setAccessChecked] = useState(false);
  const [isVerifier, setIsVerifier] = useState(false);
  const [lessonPlans, setLessonPlans] = useState([]);
  const [selectedGradeLevel, setSelectedGradeLevel] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [teacherFilter, setTeacherFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');

  const groupedLessonPlans = useMemo(() => {
    const groups = lessonPlans.reduce((acc, plan) => {
      const gradeLevel = plan.grade_level || 'Unassigned';
      if (!acc[gradeLevel]) acc[gradeLevel] = [];
      acc[gradeLevel].push(plan);
      return acc;
    }, {});

    return Object.entries(groups).sort(([a], [b]) => {
      const ai = GRADE_LEVEL_OPTIONS.indexOf(a);
      const bi = GRADE_LEVEL_OPTIONS.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [lessonPlans]);

  const selectedGradeAllPlans = useMemo(
    () =>
      lessonPlans.filter(
        (plan) => (plan.grade_level || 'Unassigned') === selectedGradeLevel
      ),
    [lessonPlans, selectedGradeLevel]
  );

  const selectedGradePlans = useMemo(
    () =>
      selectedGradeAllPlans.filter((plan) => {
        const teacherName = plan.teacher_name || 'Unknown teacher';
        const subject = plan.subject || 'No subject';
        return (
          (teacherFilter === 'all' || teacherName === teacherFilter) &&
          (subjectFilter === 'all' || subject === subjectFilter) &&
          (statusFilter === 'all' || plan.status === statusFilter)
        );
      }),
    [selectedGradeAllPlans, teacherFilter, subjectFilter, statusFilter]
  );

  const teacherFilterOptions = useMemo(
    () =>
      [
        ...new Set(
          selectedGradeAllPlans.map((p) => p.teacher_name || 'Unknown teacher')
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [selectedGradeAllPlans]
  );

  const subjectFilterOptions = useMemo(
    () =>
      [...new Set(selectedGradeAllPlans.map((p) => p.subject || 'No subject'))].sort(
        (a, b) => a.localeCompare(b)
      ),
    [selectedGradeAllPlans]
  );

  const canReview = selectedPlan?.status === 'submitted';

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

  const resetFilters = () => {
    setTeacherFilter('all');
    setSubjectFilter('all');
    setStatusFilter('all');
  };

  const handleApprove = async () => {
    if (!selectedPlan) return;
    const ok = await appConfirm('Approve this lesson plan?');
    if (!ok) return;
    try {
      setReviewing(true);
      await apiRequest(`/lesson-plans/${selectedPlan.lesson_plan_id}/approve`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await appAlert('Lesson plan approved');
      setSelectedPlan(null);
      await fetchQueue();
    } catch (err) {
      setError(err.message || 'Failed to approve');
    } finally {
      setReviewing(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!selectedPlan) return;
    if (!revisionReason.trim()) {
      await appAlert('Please provide a reason for revision');
      return;
    }
    try {
      setReviewing(true);
      await apiRequest(`/lesson-plans/${selectedPlan.lesson_plan_id}/request-revision`, {
        method: 'POST',
        body: JSON.stringify({ reason: revisionReason.trim() }),
      });
      await appAlert('Revision requested');
      setRevisionReason('');
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Lesson Plan Review</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review teacher-submitted lesson plans and approve or request revisions.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {!selectedGradeLevel ? (
        <div className="rounded-xl border border-orange-100 bg-white p-5 shadow-sm">
          {loading || !accessChecked ? (
            <p className="py-10 text-center text-sm text-gray-500">Loading lesson plans…</p>
          ) : groupedLessonPlans.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">No lesson plans found.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {groupedLessonPlans.map(([gradeLevel, plans]) => (
                <button
                  key={gradeLevel}
                  type="button"
                  onClick={() => {
                    setSelectedGradeLevel(gradeLevel);
                    setSelectedPlan(null);
                    resetFilters();
                    setRevisionReason('');
                  }}
                  className="rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-primary-200 hover:bg-orange-50/40"
                >
                  <h2 className="text-lg font-semibold text-gray-900">{gradeLevel}</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {plans.length} {plans.length === 1 ? 'lesson plan' : 'lesson plans'}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-orange-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {selectedGradeLevel} Lesson Plans
              </h2>
              <p className="text-sm text-gray-500">
                Showing {selectedGradePlans.length}{' '}
                {selectedGradePlans.length === 1 ? 'lesson plan' : 'lesson plans'} for this
                grade level.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedGradeLevel(null);
                setSelectedPlan(null);
                resetFilters();
                setRevisionReason('');
              }}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Back to grade levels
            </button>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
              Teacher
              <select
                value={teacherFilter}
                onChange={(e) => setTeacherFilter(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal text-gray-800"
              >
                <option value="all">All Teachers</option>
                {teacherFilterOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
              Subject
              <select
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal text-gray-800"
              >
                <option value="all">All Subjects</option>
                {subjectFilterOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-normal text-gray-800"
              >
                <option value="all">All Statuses</option>
                {REVIEW_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {formatStatus(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedGradePlans.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              No lesson plans match these filters.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {selectedGradePlans.map((plan) => (
                <button
                  key={plan.lesson_plan_id}
                  type="button"
                  onClick={() => setSelectedPlan(plan)}
                  className="rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-primary-200 hover:bg-orange-50/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-gray-900">
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
                  <p className="mt-1 text-sm text-gray-500">
                    {plan.teacher_name || 'Unknown teacher'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                    <span>{plan.lesson_date}</span>
                    <span>·</span>
                    <span>{plan.subject || 'No subject'}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedPlan &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black/55 p-3 sm:p-5 lg:p-8"
            onClick={() => {
              setSelectedPlan(null);
              setShowRevisionModal(false);
              setRevisionReason('');
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
                  setRevisionReason('');
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
                {/* Document sheet — matches teacher lesson plan visual */}
                <div
                  className="mx-auto w-full max-w-[960px] rounded-md border border-[#eeeeee] bg-white px-5 py-6 text-[#111111] shadow-[0_10px_30px_rgba(0,0,0,0.08)] sm:px-10 sm:py-9 lg:px-[42px] lg:py-[34px]"
                  style={{ fontFamily: '"Poppins", "Inter", "Segoe UI", sans-serif' }}
                >
                  <LessonPlanHeader />

                  <h3 className="mb-[22px] mt-[18px] text-center text-[20px] font-semibold text-[#111111]">
                    Lesson Plan
                  </h3>
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
                      <span className="font-medium">Subject</span>{' '}
                      <span className="font-normal">{selectedPlan.subject || '—'}</span>
                    </p>
                    <p className="col-span-full text-[16px] text-[#111111]">
                      <span className="font-medium">Topic</span>{' '}
                      <span className="font-normal">{selectedPlan.topic || '—'}</span>
                    </p>
                  </div>

                  {INTRO_SECTIONS.map(([title, key]) => (
                    <section key={key} className="py-3">
                      <h4 className="mb-1.5 text-[16px] font-medium text-[#111111]">{title}</h4>
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[#111111]">
                        {selectedPlan[key] || '—'}
                      </p>
                    </section>
                  ))}

                  <h4 className="mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-[18px] font-bold text-[#111111]">
                    Lesson Flow
                  </h4>
                  {LESSON_FLOW_SECTIONS.map(([title, key]) => (
                    <section key={key} className="py-3">
                      <h4 className="mb-1.5 text-[16px] font-medium text-[#111111]">{title}</h4>
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[#111111]">
                        {selectedPlan[key] || '—'}
                      </p>
                    </section>
                  ))}

                  <h4 className="mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-[18px] font-bold text-[#111111]">
                    Teacher&apos;s Reflection
                  </h4>
                  {REFLECTION_SECTIONS.map(([title, key]) => (
                    <section key={key} className="py-3">
                      <h4 className="mb-1.5 text-[16px] font-medium text-[#111111]">{title}</h4>
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[#111111]">
                        {selectedPlan[key] || '—'}
                      </p>
                    </section>
                  ))}
                </div>
              </div>

              {canReview && (
                <div className="flex shrink-0 flex-col gap-2 border-t border-[#eeeeee] bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-8">
                  <button
                    type="button"
                    disabled={reviewing}
                    onClick={() => setShowRevisionModal(true)}
                    className="rounded-lg border border-[#eeeeee] bg-white px-4 py-[11px] text-sm font-semibold text-[#333333] hover:bg-[#fff0e6] disabled:opacity-50"
                  >
                    Request revision
                  </button>
                  <button
                    type="button"
                    disabled={reviewing}
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

      {showRevisionModal &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
              <h2 className="text-lg font-semibold text-gray-900">Request revision</h2>
              <p className="mt-1 text-sm text-gray-500">
                Tell the teacher what needs to be improved.
              </p>
              <textarea
                value={revisionReason}
                onChange={(e) => setRevisionReason(e.target.value)}
                rows={5}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Revision reason"
              />
              <div className="mt-4 flex justify-end gap-2">
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
                  Submit
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
