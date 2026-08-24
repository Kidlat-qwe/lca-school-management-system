import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { appAlert } from '../../utils/appAlert';
import {
  LessonPlanHeader,
  LESSON_PLAN_SCHOOL_ADDRESS,
} from '../../components/lessonPlanHeader';

const createEmptyForm = () => ({
  lesson_date: new Date().toISOString().slice(0, 10),
  grade_level: '',
  subject: '',
  topic: '',
  learning_objectives: '',
  materials_resources: '',
  opening_routine: '',
  review: '',
  lesson_presentation: '',
  guided_practice: '',
  assessment: '',
  closing_wrapping_up: '',
  reflection_went_well: '',
  reflection_challenges: '',
  reflection_improvements: '',
});

const formatStatus = (status) => (status || 'draft').replace(/_/g, ' ');

const statusBadgeStyle = (status) => {
  if (status === 'approved') return { background: '#e8f5e9', color: '#2e7d32' };
  if (status === 'submitted') return { background: '#e3f2fd', color: '#1565c0' };
  if (status === 'revision_requested') return { background: '#fff4e5', color: '#b26a00' };
  return { background: '#f5f5f5', color: '#666666' };
};

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

  const preparedBy =
    userInfo?.full_name || userInfo?.fullName || userInfo?.email || 'Current Teacher';

  const canEdit = useMemo(() => {
    if (!selectedPlan) return true;
    return ['draft', 'revision_requested'].includes(selectedPlan.status);
  }, [selectedPlan]);

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

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleNewPlan = () => {
    setSelectedPlan(null);
    setFormData(createEmptyForm());
    setError('');
  };

  const handleSelectPlan = (plan) => {
    setSelectedPlan(plan);
    setFormData({
      lesson_date: plan.lesson_date ? String(plan.lesson_date).slice(0, 10) : '',
      grade_level: plan.grade_level || '',
      subject: plan.subject || '',
      topic: plan.topic || '',
      learning_objectives: plan.learning_objectives || '',
      materials_resources: plan.materials_resources || '',
      opening_routine: plan.opening_routine || '',
      review: plan.review || '',
      lesson_presentation: plan.lesson_presentation || '',
      guided_practice: plan.guided_practice || '',
      assessment: plan.assessment || '',
      closing_wrapping_up: plan.closing_wrapping_up || '',
      reflection_went_well: plan.reflection_went_well || '',
      reflection_challenges: plan.reflection_challenges || '',
      reflection_improvements: plan.reflection_improvements || '',
    });
    setError('');
  };

  const saveLessonPlan = async ({ submit = false } = {}) => {
    try {
      setSaving(true);
      setError('');

      if (selectedPlan) {
        await apiRequest(`/lesson-plans/${selectedPlan.lesson_plan_id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
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
            ...formData,
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

  const sheetFont = { fontFamily: '"Poppins", "Inter", "Segoe UI", sans-serif' };

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* PageWrapper */}
      <div className="grid grid-cols-1 gap-6 min-[1101px]:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        {/* LessonPlanSheet */}
        <div
          className="rounded-md border border-[#eeeeee] bg-white px-[42px] py-[34px] text-[#111111] shadow-[0_10px_30px_rgba(0,0,0,0.08)] max-md:px-5 max-md:py-6"
          style={sheetFont}
        >
          <LessonPlanHeader
            address={meta?.branch?.branch_address || LESSON_PLAN_SCHOOL_ADDRESS}
          />

          <h2 className="mb-[22px] mt-[18px] text-center text-[20px] font-semibold text-[#111111]">
            Lesson Plan
          </h2>

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

            <label className={blockLabelCls}>
              Learning Objectives
              <textarea
                disabled={!canEdit}
                rows={4}
                value={formData.learning_objectives}
                onChange={(e) => handleInputChange('learning_objectives', e.target.value)}
                placeholder="List learning objectives"
                className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
              />
            </label>

            <label className={blockLabelCls}>
              Materials/Resources
              <textarea
                disabled={!canEdit}
                rows={3}
                value={formData.materials_resources}
                onChange={(e) => handleInputChange('materials_resources', e.target.value)}
                placeholder="List materials and resources"
                className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
              />
            </label>

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              Lesson Flow
            </h3>

            {[
              ['opening_routine', 'I. Opening Routine', 3],
              ['review', 'II. Review', 3],
              ['lesson_presentation', 'III. Lesson Presentation', 4],
              ['guided_practice', 'IV. Guided Practice', 4],
              ['assessment', 'VI. Assessment', 3],
              ['closing_wrapping_up', 'VII. Closing/Wrapping Up', 3],
            ].map(([field, title, rows]) => (
              <label key={field} className={blockLabelCls}>
                {title}
                <textarea
                  disabled={!canEdit}
                  rows={rows}
                  value={formData[field]}
                  onChange={(e) => handleInputChange(field, e.target.value)}
                  className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
                />
              </label>
            ))}

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              Teacher&apos;s Reflection
            </h3>

            {[
              ['reflection_went_well', 'What went well?'],
              ['reflection_challenges', 'What challenges occurred?'],
              ['reflection_improvements', 'What can be improved?'],
            ].map(([field, title]) => (
              <label key={field} className={blockLabelCls}>
                {title}
                <textarea
                  disabled={!canEdit}
                  rows={3}
                  value={formData[field]}
                  onChange={(e) => handleInputChange(field, e.target.value)}
                  className={`${fieldControlCls} min-h-[60px] resize-y leading-normal`}
                />
              </label>
            ))}

            <label className={`${fieldLabelCls} col-span-full`}>
              <span className="shrink-0">Prepared by</span>
              <input value={preparedBy} disabled className={fieldControlCls} />
            </label>
          </div>

          {!canEdit && (
            <div className="mt-2.5 rounded-lg border border-[#ffddc9] bg-[#fff8f3] p-2.5 text-[13px] text-[#7a4b00]">
              This lesson plan is approved / submitted and can no longer be edited.
            </div>
          )}

          {selectedPlan?.status === 'revision_requested' && selectedPlan.revision_reason && (
            <div className="mt-2.5 rounded-lg border border-[#ffddc9] bg-[#fff8f3] p-2.5 text-[13px] text-[#7a4b00]">
              <strong>Revision reason:</strong> {selectedPlan.revision_reason}
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-3">
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
              <option value="revision_requested">Revision Requested</option>
              <option value="approved">Approved</option>
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
                    {plan.status === 'revision_requested' && plan.revision_reason && (
                      <div className="mt-2.5 rounded-lg border border-[#ffddc9] bg-[#fff8f3] p-2.5 text-[13px] text-[#7a4b00]">
                        <strong>Revision reason:</strong> {plan.revision_reason}
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
