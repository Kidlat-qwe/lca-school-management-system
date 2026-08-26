import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { appAlert } from '../../utils/appAlert';
import { LessonPlanHeader } from '../../components/lessonPlanHeader';

const createEmptyForm = () => ({
  lesson_date: new Date().toISOString().slice(0, 10),
  grade_level: '',
  subject: '',
  phase: '',
  session: '',
  topic: '',
  early_learning_goals: '',
  objective_1: '',
  objective_2: '',
  objective_3: '',
  assessment_method: '',
  assessment_criteria: '',
  materials_needed: '',
  preliminaries_time: '',
  preliminaries_activity: '',
  lesson_proper_time: '',
  lesson_proper_activity: '',
  conclusion_time: '',
  conclusion_activity: '',
  class1_name: '',
  class1_age_group: '',
  class1_considerations: '',
  class1_adjustments: '',
  class2_name: '',
  class2_age_group: '',
  class2_considerations: '',
  class2_adjustments: '',
  class3_name: '',
  class3_age_group: '',
  class3_considerations: '',
  class3_adjustments: '',
  reflection_went_well: '',
  reflection_amazing_moments: '',
  reflection_challenges: '',
  reflection_improvements: '',
});

const populateFormFromPlan = (plan) => ({
  lesson_date: plan.lesson_date ? String(plan.lesson_date).slice(0, 10) : '',
  grade_level: plan.grade_level || '',
  subject: plan.subject || '',
  phase: plan.phase || '',
  session: plan.session || '',
  topic: plan.topic || '',
  early_learning_goals: plan.early_learning_goals || '',
  objective_1: plan.objective_1 || '',
  objective_2: plan.objective_2 || '',
  objective_3: plan.objective_3 || '',
  assessment_method: plan.assessment_method || '',
  assessment_criteria: plan.assessment_criteria || '',
  materials_needed: plan.materials_needed || '',
  preliminaries_time: plan.preliminaries_time || '',
  preliminaries_activity: plan.preliminaries_activity || '',
  lesson_proper_time: plan.lesson_proper_time || '',
  lesson_proper_activity: plan.lesson_proper_activity || '',
  conclusion_time: plan.conclusion_time || '',
  conclusion_activity: plan.conclusion_activity || '',
  class1_name: plan.class1_name || '',
  class1_age_group: plan.class1_age_group || '',
  class1_considerations: plan.class1_considerations || '',
  class1_adjustments: plan.class1_adjustments || '',
  class2_name: plan.class2_name || '',
  class2_age_group: plan.class2_age_group || '',
  class2_considerations: plan.class2_considerations || '',
  class2_adjustments: plan.class2_adjustments || '',
  class3_name: plan.class3_name || '',
  class3_age_group: plan.class3_age_group || '',
  class3_considerations: plan.class3_considerations || '',
  class3_adjustments: plan.class3_adjustments || '',
  reflection_went_well: plan.reflection_went_well || '',
  reflection_amazing_moments: plan.reflection_amazing_moments || '',
  reflection_challenges: plan.reflection_challenges || '',
  reflection_improvements: plan.reflection_improvements || '',
});

const formatStatus = (status) => {
  if (status === 'awaiting_reflection') return 'Awaiting Reflection';
  if (status === 'completed') return 'Completed';
  if (status === 'revision_requested') return 'Revision requested';
  return (status || 'draft').replace(/_/g, ' ');
};

const statusBadgeStyle = (status) => {
  if (status === 'completed') return { background: '#e8f5e9', color: '#2e7d32' };
  if (status === 'awaiting_reflection') return { background: '#fff4e5', color: '#b26a00' };
  if (status === 'submitted') return { background: '#e3f2fd', color: '#1565c0' };
  if (status === 'revision_requested') return { background: '#fff4e5', color: '#b26a00' };
  return { background: '#f5f5f5', color: '#666666' };
};

/** Asia/Manila calendar date YYYY-MM-DD */
function getManilaTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isLessonDateToday(lessonDate, todayYmd = getManilaTodayYmd()) {
  if (!lessonDate) return false;
  return String(lessonDate).slice(0, 10) === todayYmd;
}

function parseRevisionFeedbackClient(raw) {
  const text = raw == null ? '' : String(raw);
  if (!text.trim()) return { items: [], general: null, legacy: true };
  try {
    const parsed = JSON.parse(text);
    if (parsed && Number(parsed.v) === 1 && Array.isArray(parsed.items)) {
      return {
        items: parsed.items,
        general: parsed.general || null,
        legacy: false,
      };
    }
  } catch {
    /* legacy plain text */
  }
  return { items: [], general: text, legacy: true };
}

function getPlanRevisionFeedback(plan) {
  return plan?.revision_feedback || parseRevisionFeedbackClient(plan?.revision_reason);
}

function getRevisionItemsForField(plan, fieldKey) {
  const feedback = getPlanRevisionFeedback(plan);
  const items = Array.isArray(feedback?.items) ? feedback.items : [];
  return items.filter((item) => item?.field === fieldKey);
}

/** Inline revision notes placed directly under the matching form field. */
function FieldRevisionNotes({ plan, fieldKey }) {
  if (plan?.status !== 'revision_requested') return null;
  const items = getRevisionItemsForField(plan, fieldKey);
  if (!items.length) return null;

  return (
    <div className="col-span-full -mt-1 mb-1 space-y-1.5">
      {items.map((item, idx) => (
        <div
          key={`${fieldKey}-${idx}`}
          className="rounded-md border border-red-300 bg-red-100 px-2.5 py-2 text-[12px] text-red-900"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-red-700">
            Revision feedback
          </p>
          {item.highlight ? (
            <blockquote className="mt-1 border-l-2 border-red-500 pl-2 text-[12px] italic text-red-950">
              “{item.highlight}”
            </blockquote>
          ) : null}
          {item.note ? (
            <p className="mt-1 whitespace-pre-wrap leading-snug text-[13px] text-red-950">{item.note}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** General / legacy revision note (not tied to a specific field). */
function GeneralRevisionNotes({ plan }) {
  if (plan?.status !== 'revision_requested') return null;
  const feedback = getPlanRevisionFeedback(plan);
  const general =
    typeof feedback?.general === 'string' && feedback.general.trim()
      ? feedback.general.trim()
      : '';
  if (!general) return null;

  return (
    <div className="mt-2.5 rounded-lg border border-red-300 bg-red-100 p-3 text-[13px] text-red-900">
      <p className="mb-1 font-semibold text-red-700">
        {feedback.legacy ? 'Revision feedback' : 'General revision feedback'}
      </p>
      <p className="whitespace-pre-wrap text-red-950">{general}</p>
    </div>
  );
}

/** Shared field chrome from TeacherLessonPlans.jsx Field styled-component */
const fieldControlCls =
  'min-w-0 flex-1 rounded-lg border border-[#d8d8d8] bg-transparent px-3 py-2.5 text-base font-normal text-[#111111] focus:border-[#ff9f40] focus:outline-none focus:shadow-[0_0_0_3px_rgba(255,159,64,0.15)] disabled:cursor-not-allowed disabled:opacity-60';

const fieldLabelCls =
  'flex flex-row items-baseline gap-2 text-base font-medium text-[#111111]';

const blockLabelCls =
  'col-span-full flex flex-col items-stretch gap-2 text-base font-medium text-[#111111]';

const btnBaseCls =
  'cursor-pointer rounded-lg border px-4 py-[11px] font-semibold text-[#333333] disabled:cursor-not-allowed disabled:opacity-60';

const btnSecondaryCls = `${btnBaseCls} border-[#eeeeee] bg-white hover:enabled:bg-[#fff0e6]`;

const btnPrimaryCls = `${btnBaseCls} border-[#ffddc9] bg-[#ffddc9] hover:enabled:bg-[#fff0e6]`;

/**
 * Teacher Lesson Plan page — styling matched to TeacherLessonPlans.jsx (QA/CMS reference).
 */
export default function TeacherLessonPlans() {
  const { userInfo } = useAuth();
  const [meta, setMeta] = useState(null);
  const [lessonPlans, setLessonPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [formData, setFormData] = useState(createEmptyForm);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sheetFlash, setSheetFlash] = useState(false);
  const [manilaToday, setManilaToday] = useState(getManilaTodayYmd);
  const flashTimerRef = useRef(null);

  const preparedBy =
    userInfo?.full_name || userInfo?.fullName || userInfo?.email || 'Current Teacher';

  const canEdit = useMemo(() => {
    if (!selectedPlan) return true;
    return ['draft', 'revision_requested'].includes(selectedPlan.status);
  }, [selectedPlan]);

  const canEditReflections = useMemo(() => {
    if (!selectedPlan || selectedPlan.status !== 'awaiting_reflection') return false;
    return isLessonDateToday(selectedPlan.lesson_date || formData.lesson_date, manilaToday);
  }, [selectedPlan, formData.lesson_date, manilaToday]);

  const subjectOptions = useMemo(() => {
    if (!meta?.subjects_by_grade || !formData.grade_level) return [];
    return meta.subjects_by_grade[formData.grade_level] || [];
  }, [meta, formData.grade_level]);

  const filteredPlans = useMemo(() => {
    if (statusFilter === 'all') return lessonPlans;
    return lessonPlans.filter((p) => p.status === statusFilter);
  }, [lessonPlans, statusFilter]);

  const submitButtonLabel =
    selectedPlan?.status === 'revision_requested'
      ? 'Resubmit for Verification'
      : 'Submit for Verification';

  useEffect(() => {
    const tick = () => setManilaToday(getManilaTodayYmd());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchPlans = useCallback(async () => {
    const res = await apiRequest('/lesson-plans?limit=100');
    setLessonPlans(res.data || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const [metaRes] = await Promise.all([
          apiRequest('/lesson-plans/meta'),
          fetchPlans(),
        ]);
        if (cancelled) return;
        setMeta(metaRes.data || null);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load lesson plans');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPlans]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const flashLessonPlanSheet = () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setSheetFlash(false);
    requestAnimationFrame(() => {
      setSheetFlash(true);
      flashTimerRef.current = setTimeout(() => setSheetFlash(false), 1600);
    });
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleNewPlan = () => {
    setSelectedPlan(null);
    setFormData(createEmptyForm());
    setError('');
    flashLessonPlanSheet();
  };

  const handleSelectPlan = (plan) => {
    setSelectedPlan(plan);
    setFormData(populateFormFromPlan(plan));
    setError('');
    flashLessonPlanSheet();
  };

  const saveLessonPlan = async ({ submit = false } = {}) => {
    try {
      setSaving(true);
      setError('');

      // Reflections are never saved during draft/submit — locked until lesson date after approval.
      const payload = {
        ...formData,
        reflection_went_well: '',
        reflection_amazing_moments: '',
        reflection_challenges: '',
        reflection_improvements: '',
      };

      if (selectedPlan) {
        await apiRequest(`/lesson-plans/${selectedPlan.lesson_plan_id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        if (submit) {
          await apiRequest(`/lesson-plans/${selectedPlan.lesson_plan_id}/submit`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          await appAlert('Lesson plan submitted for verification');
          handleNewPlan();
        } else {
          await appAlert('Lesson plan saved');
        }
      } else {
        const res = await apiRequest('/lesson-plans', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            status: submit ? 'submitted' : 'draft',
          }),
        });
        if (submit) {
          await appAlert('Lesson plan submitted for verification');
          handleNewPlan();
        } else {
          setSelectedPlan(res.data);
          await appAlert('Lesson plan saved as draft');
        }
      }
      await fetchPlans();
    } catch (err) {
      setError(err.message || 'Failed to save lesson plan');
    } finally {
      setSaving(false);
    }
  };

  const saveReflectionsAndComplete = async () => {
    if (!selectedPlan) return;
    try {
      setSaving(true);
      setError('');
      const res = await apiRequest(`/lesson-plans/${selectedPlan.lesson_plan_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          reflection_went_well: formData.reflection_went_well,
          reflection_amazing_moments: formData.reflection_amazing_moments,
          reflection_challenges: formData.reflection_challenges,
          reflection_improvements: formData.reflection_improvements,
        }),
      });
      setSelectedPlan(res.data);
      setFormData((prev) => ({
        ...prev,
        reflection_went_well: res.data.reflection_went_well || '',
        reflection_amazing_moments: res.data.reflection_amazing_moments || '',
        reflection_challenges: res.data.reflection_challenges || '',
        reflection_improvements: res.data.reflection_improvements || '',
      }));
      await appAlert('Teacher reflection saved. Lesson plan marked as Completed.');
      await fetchPlans();
    } catch (err) {
      setError(err.message || 'Failed to save teacher reflection');
    } finally {
      setSaving(false);
    }
  };

  const sheetFont = { fontFamily: '"Poppins", "Inter", "Segoe UI", sans-serif' };

  const reflectionHint = (() => {
    const lessonYmd = String(
      (selectedPlan?.lesson_date || formData.lesson_date || '').slice(0, 10)
    );
    if (selectedPlan?.status === 'completed') {
      return 'Teacher reflection is complete. This lesson plan is Completed.';
    }
    if (selectedPlan?.status === 'awaiting_reflection') {
      if (canEditReflections) {
        return `Unlocked today (${manilaToday}). Fill in all reflection fields and save to mark this plan Completed. No further verifier approval is required.`;
      }
      return `Locked. Teacher reflection opens only on the lesson date (${lessonYmd || '—'}) and locks again after that day. Today is ${manilaToday}.`;
    }
    return `Locked until the lesson date after a verifier approves this plan. You can only edit reflections on ${lessonYmd || 'the selected lesson date'} (not before or after).`;
  })();

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* PageWrapper */}
      <div className="grid grid-cols-1 gap-6 min-[1101px]:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <style>{`
          @keyframes lessonPlanSheetFlash {
            0%, 100% {
              border-color: #eeeeee;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
            }
            50% {
              border-color: #ef4444;
              box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.35), 0 10px 30px rgba(0, 0, 0, 0.08);
            }
          }
        `}</style>
        {/* LessonPlanSheet */}
        <div
          className="rounded-md border border-[#eeeeee] bg-white px-[42px] py-[34px] text-[#111111] shadow-[0_10px_30px_rgba(0,0,0,0.08)] max-md:px-5 max-md:py-6"
          style={{
            ...sheetFont,
            ...(sheetFlash
              ? { animation: 'lessonPlanSheetFlash 0.45s ease-in-out 3' }
              : null),
          }}
        >
          <LessonPlanHeader branch={meta?.branch || null} />

          {/* FormGrid */}
          <div className="grid grid-cols-1 gap-x-[34px] gap-y-[14px] md:grid-cols-2">
            <div className="col-span-full my-0.5 mb-2 border-t-2 border-[#111111]" />

            <label className={fieldLabelCls}>
              <span className="shrink-0">Lesson Date</span>
              <input
                type="date"
                disabled={!canEdit}
                value={formData.lesson_date}
                onChange={(e) => handleInputChange('lesson_date', e.target.value)}
                className={fieldControlCls}
              />
            </label>

            <label className={fieldLabelCls}>
              <span className="shrink-0">Grade Level</span>
              <select
                disabled={!canEdit || loading}
                value={formData.grade_level}
                onChange={(e) => {
                  const gradeLevel = e.target.value;
                  const nextSubjects = meta?.subjects_by_grade?.[gradeLevel] || [];
                  setFormData((prev) => ({
                    ...prev,
                    grade_level: gradeLevel,
                    subject: nextSubjects.includes(prev.subject) ? prev.subject : '',
                  }));
                }}
                className={fieldControlCls}
              >
                <option value="">Select grade level</option>
                {(meta?.grade_levels || []).map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>

            <label className={`${fieldLabelCls} col-span-full`}>
              <span className="shrink-0">Subject</span>
              <select
                disabled={!canEdit || !formData.grade_level}
                value={formData.subject}
                onChange={(e) => handleInputChange('subject', e.target.value)}
                className={fieldControlCls}
              >
                <option value="">
                  {formData.grade_level ? 'Select subject' : 'Select grade level first'}
                </option>
                {subjectOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className={fieldLabelCls}>
              <span className="shrink-0">Phase</span>
              <input
                disabled={!canEdit}
                value={formData.phase}
                onChange={(e) => handleInputChange('phase', e.target.value)}
                placeholder="Enter phase"
                className={fieldControlCls}
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="phase" />

            <label className={fieldLabelCls}>
              <span className="shrink-0">Session</span>
              <input
                disabled={!canEdit}
                value={formData.session}
                onChange={(e) => handleInputChange('session', e.target.value)}
                placeholder="Enter session"
                className={fieldControlCls}
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="session" />

            <label className={`${fieldLabelCls} col-span-full`}>
              <span className="shrink-0">Topic</span>
              <input
                disabled={!canEdit}
                value={formData.topic}
                onChange={(e) => handleInputChange('topic', e.target.value)}
                placeholder="Enter lesson topic"
                className={fieldControlCls}
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="topic" />

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              1. Early Learning Goals
            </h3>

            <label className={blockLabelCls}>
              Early Learning Goals
              <textarea
                disabled={!canEdit}
                rows={4}
                value={formData.early_learning_goals}
                onChange={(e) => handleInputChange('early_learning_goals', e.target.value)}
                placeholder="List early learning goals"
                className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="early_learning_goals" />

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              2. Learning Objectives
            </h3>

            {[
              ['objective_1', 'Objective 1'],
              ['objective_2', 'Objective 2'],
              ['objective_3', 'Objective 3'],
            ].map(([field, title]) => (
              <Fragment key={field}>
                <label className={`${fieldLabelCls} col-span-full`}>
                  <span className="shrink-0">{title}</span>
                  <input
                    disabled={!canEdit}
                    value={formData[field]}
                    onChange={(e) => handleInputChange(field, e.target.value)}
                    placeholder={title}
                    className={fieldControlCls}
                  />
                </label>
                <FieldRevisionNotes plan={selectedPlan} fieldKey={field} />
              </Fragment>
            ))}

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              3. Assessment
            </h3>

            <label className={blockLabelCls}>
              Assessment Method
              <textarea
                disabled={!canEdit}
                rows={3}
                value={formData.assessment_method}
                onChange={(e) => handleInputChange('assessment_method', e.target.value)}
                placeholder="Describe assessment method"
                className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="assessment_method" />

            <label className={blockLabelCls}>
              Assessment Criteria
              <textarea
                disabled={!canEdit}
                rows={3}
                value={formData.assessment_criteria}
                onChange={(e) => handleInputChange('assessment_criteria', e.target.value)}
                placeholder="Describe assessment criteria"
                className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="assessment_criteria" />

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              4. Materials Needed To Prepare
            </h3>

            <label className={blockLabelCls}>
              Materials Needed
              <textarea
                disabled={!canEdit}
                rows={3}
                value={formData.materials_needed}
                onChange={(e) => handleInputChange('materials_needed', e.target.value)}
                placeholder="List materials needed to prepare"
                className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="materials_needed" />

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              5. General Lesson Overview
            </h3>

            {[
              ['preliminaries', 'Preliminaries'],
              ['lesson_proper', 'Lesson Proper'],
              ['conclusion', 'Conclusion'],
            ].map(([prefix, title]) => (
              <Fragment key={prefix}>
                <p className="col-span-full mb-0 mt-1 text-[15px] font-semibold text-[#111111]">
                  {title}
                </p>
                <label className={fieldLabelCls}>
                  <span className="shrink-0">Time</span>
                  <input
                    disabled={!canEdit}
                    value={formData[`${prefix}_time`]}
                    onChange={(e) => handleInputChange(`${prefix}_time`, e.target.value)}
                    placeholder="e.g. 10 mins"
                    className={fieldControlCls}
                  />
                </label>
                <FieldRevisionNotes plan={selectedPlan} fieldKey={`${prefix}_time`} />
                <label className={blockLabelCls}>
                  Activity &amp; Goal
                  <textarea
                    disabled={!canEdit}
                    rows={3}
                    value={formData[`${prefix}_activity`]}
                    onChange={(e) => handleInputChange(`${prefix}_activity`, e.target.value)}
                    placeholder={`${title} activity and goal`}
                    className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
                  />
                </label>
                <FieldRevisionNotes plan={selectedPlan} fieldKey={`${prefix}_activity`} />
              </Fragment>
            ))}

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              6. Class-Specific Adjustments
            </h3>

            {[1, 2, 3].map((n) => (
              <Fragment key={`class${n}`}>
                <p className="col-span-full mb-0 mt-1 text-[15px] font-semibold text-[#111111]">
                  Class {n}
                </p>
                <label className={fieldLabelCls}>
                  <span className="shrink-0">Name</span>
                  <input
                    disabled={!canEdit}
                    value={formData[`class${n}_name`]}
                    onChange={(e) => handleInputChange(`class${n}_name`, e.target.value)}
                    placeholder={`Class ${n} name`}
                    className={fieldControlCls}
                  />
                </label>
                <FieldRevisionNotes plan={selectedPlan} fieldKey={`class${n}_name`} />
                <label className={fieldLabelCls}>
                  <span className="shrink-0">Age Group</span>
                  <input
                    disabled={!canEdit}
                    value={formData[`class${n}_age_group`]}
                    onChange={(e) => handleInputChange(`class${n}_age_group`, e.target.value)}
                    placeholder="Age group"
                    className={fieldControlCls}
                  />
                </label>
                <FieldRevisionNotes plan={selectedPlan} fieldKey={`class${n}_age_group`} />
                <label className={blockLabelCls}>
                  Considerations
                  <textarea
                    disabled={!canEdit}
                    rows={2}
                    value={formData[`class${n}_considerations`]}
                    onChange={(e) =>
                      handleInputChange(`class${n}_considerations`, e.target.value)
                    }
                    placeholder="Class considerations"
                    className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
                  />
                </label>
                <FieldRevisionNotes plan={selectedPlan} fieldKey={`class${n}_considerations`} />
                <label className={blockLabelCls}>
                  Adjustments
                  <textarea
                    disabled={!canEdit}
                    rows={2}
                    value={formData[`class${n}_adjustments`]}
                    onChange={(e) => handleInputChange(`class${n}_adjustments`, e.target.value)}
                    placeholder="Class adjustments"
                    className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
                  />
                </label>
                <FieldRevisionNotes plan={selectedPlan} fieldKey={`class${n}_adjustments`} />
              </Fragment>
            ))}

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              7. Teacher&apos;s Reflection
            </h3>

            <p className="col-span-full -mt-1 mb-1 text-[13px] leading-snug text-[#7a4b00]">
              {reflectionHint}
            </p>

            {[
              ['reflection_went_well', 'Successes'],
              ['reflection_amazing_moments', 'Amazing Moments'],
              ['reflection_challenges', 'Challenges'],
              ['reflection_improvements', 'Improvements'],
            ].map(([field, title]) => (
              <label key={field} className={blockLabelCls}>
                {title}
                <textarea
                  disabled={!canEditReflections}
                  rows={3}
                  value={formData[field]}
                  onChange={(e) => handleInputChange(field, e.target.value)}
                  className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
                />
              </label>
            ))}

            {selectedPlan &&
              ['awaiting_reflection', 'completed'].includes(selectedPlan.status) && (
                <>
                  <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
                    8. Head Teacher&apos;s Review and Feedback
                  </h3>
                  <p className="col-span-full -mt-1 mb-1 text-[13px] leading-snug text-[#555555]">
                    Filled by the verifier when this lesson plan was approved. Read-only.
                  </p>
                  {[
                    ['head_teacher_overall_assessment', 'Overall Assessment'],
                    ['head_teacher_specific_feedback', 'Specific Feedback'],
                    ['head_teacher_next_steps', 'Next Steps'],
                  ].map(([field, title]) => (
                    <div key={field} className={blockLabelCls}>
                      {title}
                      <div
                        className={`${fieldControlCls} min-h-[60px] whitespace-pre-wrap leading-normal text-[#111111]`}
                      >
                        {(selectedPlan[field] || '').trim() || '—'}
                      </div>
                    </div>
                  ))}
                </>
              )}

            <label className={`${fieldLabelCls} col-span-full`}>
              <span className="shrink-0">Prepared by</span>
              <input value={preparedBy} disabled className={fieldControlCls} />
            </label>
          </div>

          {!canEdit && !canEditReflections && selectedPlan?.status !== 'completed' && (
            <div className="mt-2.5 rounded-lg border border-[#ffddc9] bg-[#fff8f3] p-2.5 text-[13px] text-[#7a4b00]">
              {selectedPlan?.status === 'awaiting_reflection'
                ? 'Lesson body is locked after verification. Teacher reflection unlocks only on the lesson date.'
                : 'This lesson plan is submitted and can no longer be edited until a revision is requested.'}
            </div>
          )}

          {selectedPlan?.status === 'completed' && (
            <div className="mt-2.5 rounded-lg border border-green-200 bg-green-50 p-2.5 text-[13px] text-green-800">
              This lesson plan is Completed. No further verifier approval is needed.
            </div>
          )}

          <GeneralRevisionNotes plan={selectedPlan} />

          <div className="mt-5 flex flex-wrap justify-end gap-3">
            {canEditReflections ? (
              <button
                type="button"
                disabled={saving}
                onClick={saveReflectionsAndComplete}
                className={btnPrimaryCls}
              >
                {saving ? 'Saving...' : 'Save Reflection & Mark Completed'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={saving || !canEdit}
                  onClick={() => saveLessonPlan({ submit: false })}
                  className={btnSecondaryCls}
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  disabled={saving || !canEdit}
                  onClick={() => saveLessonPlan({ submit: true })}
                  className={btnPrimaryCls}
                >
                  {saving ? 'Submitting...' : submitButtonLabel}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Sidebar Card */}
        <div
          className="rounded-[14px] border border-[#f3e5dc] bg-white p-6 shadow-[0_8px_24px_rgba(0,0,0,0.05)]"
          style={sheetFont}
        >
          <div className="mb-5 flex flex-col items-start justify-between gap-3.5 sm:flex-row">
            <div>
              <h2 className="mb-2 text-2xl text-[#333333]">My Submissions</h2>
              <p className="m-0 text-[#666666]">
                Track review status and revise when requested.
              </p>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={handleNewPlan}
              className={`${btnPrimaryCls} shrink-0`}
            >
              Create Lesson Plan
            </button>
          </div>

          <div className="mb-[18px] flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[#ffeadc] bg-[#fff8f3] px-3.5 py-3 sm:flex-row sm:items-center">
            <span className="text-[13px] font-semibold text-[#555555]">Filter submissions</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-w-[170px] rounded-lg border border-[#ffddc9] bg-white py-2 pl-2.5 pr-8 text-[13px] text-[#333333] focus:border-[#ff9f40] focus:outline-none focus:shadow-[0_0_0_3px_rgba(255,221,201,0.35)] sm:w-auto w-full"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="awaiting_reflection">Awaiting Reflection</option>
              <option value="revision_requested">Revision Requested</option>
              <option value="completed">Completed</option>
            </select>
          </div>

          {loading ? (
            <div className="py-6 text-center text-[#666666]">Loading lesson plans...</div>
          ) : lessonPlans.length === 0 ? (
            <div className="py-6 text-center text-[#666666]">No lesson plans submitted yet.</div>
          ) : filteredPlans.length === 0 ? (
            <div className="py-6 text-center text-[#666666]">
              No lesson plans found for this status.
            </div>
          ) : (
            <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
              {filteredPlans.map((plan) => {
                const active = selectedPlan?.lesson_plan_id === plan.lesson_plan_id;
                const badge = statusBadgeStyle(plan.status);
                return (
                  <button
                    key={plan.lesson_plan_id}
                    type="button"
                    onClick={() => handleSelectPlan(plan)}
                    className={`rounded-[10px] border p-3.5 text-left ${
                      active
                        ? 'border-[#ffddc9] bg-[#fff0e6]'
                        : 'border-[#eeeeee] bg-white hover:border-[#ffddc9]'
                    }`}
                  >
                    <h4 className="mb-2 text-[15px] text-[#333333]">
                      {plan.topic || 'Untitled topic'}
                    </h4>
                    <p className="mb-2.5 text-[13px] text-[#666666]">
                      {plan.grade_level || 'No grade'} | {plan.subject || 'No subject'} |{' '}
                      {plan.lesson_date
                        ? new Date(plan.lesson_date).toLocaleDateString()
                        : 'No date'}
                    </p>
                    <span
                      className="inline-block rounded-full px-2.5 py-1.5 text-xs font-bold capitalize"
                      style={badge}
                    >
                      {formatStatus(plan.status)}
                    </span>
                    {plan.status === 'revision_requested' && (
                      <div className="mt-2.5 text-[12px] text-[#7a4b00]">
                        Open the plan to view detailed revision feedback.
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
