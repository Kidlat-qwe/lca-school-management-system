/**
 * Read-only lesson plan document modal (LCA / PDF field order).
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LessonPlanHeader } from '../lessonPlanHeader';
import {
  FieldRevisionNotes,
  RevisionFeedbackSummary,
} from '../lessonPlanRevisionFeedback';
import { formatLessonPlanDateDisplay } from '../../utils/lessonPlanPhaseSession';

/** Display title + plan field key + revision flag field key (verifier may use class_id). */
const META_SECTIONS = [
  ['Lesson Topic', 'topic', 'topic'],
  ['Phase', 'phase', 'phase'],
  ['Session', 'session', 'session'],
  ['Class Code', 'class_label', 'class_id'],
];

const GOALS_SECTIONS = [
  ['Early Learning Goals', 'early_learning_goals', 'early_learning_goals'],
  ['Objective 1', 'objective_1', 'objective_1'],
  ['Objective 2', 'objective_2', 'objective_2'],
  ['Objective 3', 'objective_3', 'objective_3'],
];

const ASSESSMENT_SECTIONS = [
  ['Assessment Method', 'assessment_method', 'assessment_method'],
  ['Assessment Criteria', 'assessment_criteria', 'assessment_criteria'],
];

const MATERIALS_SECTIONS = [
  ['Materials Needed To Prepare', 'materials_needed', 'materials_needed'],
];

const PROCEDURE_SECTIONS = [
  ['Preliminaries — Activity & Goal', 'preliminaries_activity', 'preliminaries_activity'],
  ['Lesson Proper — Activity & Goal', 'lesson_proper_activity', 'lesson_proper_activity'],
  ['Conclusion — Activity & Goal', 'conclusion_activity', 'conclusion_activity'],
];

const CLASS_SECTIONS = [
  ['Class — Considerations', 'class1_considerations', 'class1_considerations'],
  ['Class — Adjustments', 'class1_adjustments', 'class1_adjustments'],
];

const REFLECTION_SECTIONS = [
  ['Successes', 'reflection_went_well'],
  ['Amazing Moments', 'reflection_amazing_moments'],
  ['Challenges', 'reflection_challenges'],
  ['Improvements', 'reflection_improvements'],
];

const HEAD_TEACHER_SECTIONS = [
  ['Overall Assessment', 'head_teacher_overall_assessment'],
  ['Specific Feedback', 'head_teacher_specific_feedback'],
  ['Next Steps', 'head_teacher_next_steps'],
];

function formatStatus(status) {
  if (status === 'awaiting_reflection') return 'Awaiting Reflection';
  if (status === 'completed') return 'Completed';
  if (status === 'revision_requested') return 'Revision requested';
  return (status || 'draft').replace(/_/g, ' ');
}

function statusBadgeClass(status) {
  if (status === 'completed') return 'bg-green-100 text-green-800';
  if (status === 'awaiting_reflection') return 'bg-amber-100 text-amber-800';
  if (status === 'submitted') return 'bg-blue-100 text-blue-800';
  if (status === 'revision_requested') return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

function SectionBlock({ title, content, plan, revisionFieldKey }) {
  return (
    <section className="py-3">
      <h4 className="mb-1.5 text-[16px] font-medium text-[#111111]">{title}</h4>
      {revisionFieldKey ? (
        <FieldRevisionNotes plan={plan} fieldKey={revisionFieldKey} />
      ) : null}
      <div className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2.5 shadow-sm">
        <p className="min-h-[2.5rem] whitespace-pre-wrap text-[15px] leading-relaxed text-[#111111]">
          {content || '—'}
        </p>
      </div>
    </section>
  );
}

function resolveFieldContent(plan, key) {
  if (key === 'class_label') {
    return plan.class_label || plan.class_code || plan.subject || '';
  }
  return plan[key];
}

/**
 * @param {{ plan: object|null, open: boolean, onClose: () => void, onEdit?: (plan: object) => void }} props
 */
export default function LessonPlanViewModal({ plan, open, onClose, onEdit }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || !plan) return null;

  const canEditPlan = ['draft', 'revision_requested', 'awaiting_reflection'].includes(
    plan.status
  );
  const editButtonLabel =
    plan.status === 'awaiting_reflection' ? 'Complete Reflection' : 'Edit';
  const showHeadTeacher = HEAD_TEACHER_SECTIONS.some(([_, key]) =>
    String(plan[key] || '').trim()
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black/55 p-3 sm:p-5 lg:p-8"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-md bg-[#f3f4f6] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Lesson plan details"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
          <h2 className="truncate text-base font-semibold text-[#333333] sm:text-lg">
            Lesson Plan
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {canEditPlan && onEdit ? (
              <button
                type="button"
                onClick={() => onEdit(plan)}
                className="rounded-lg border border-[#ffddc9] bg-[#ffddc9] px-3 py-1.5 text-sm font-semibold text-[#333333] hover:bg-[#fff0e6]"
              >
                {editButtonLabel}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[28px] font-bold leading-none text-[#d32f2f] hover:bg-red-50 hover:text-red-800"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

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
            <LessonPlanHeader branch={plan} />

            <div className="mb-4 border-t-2 border-[#111111]" />

            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-1.5 text-xs font-bold capitalize ${statusBadgeClass(
                  plan.status
                )}`}
              >
                {formatStatus(plan.status)}
              </span>
              {plan.teacher_name ? (
                <span className="text-[15px] text-[#666666]">
                  Prepared by {plan.teacher_name}
                </span>
              ) : null}
            </div>

            <RevisionFeedbackSummary plan={plan} />

            <div className="mb-2 grid grid-cols-1 gap-x-[34px] gap-y-3 sm:grid-cols-2">
              <p className="text-[16px] text-[#111111]">
                <span className="font-medium">Lesson Date</span>{' '}
                <span className="font-normal">
                  {plan.lesson_date
                    ? formatLessonPlanDateDisplay(plan.lesson_date)
                    : '—'}
                </span>
              </p>
              <p className="text-[16px] text-[#111111]">
                <span className="font-medium">Grade Level</span>{' '}
                <span className="font-normal">{plan.grade_level || '—'}</span>
              </p>
              <p className="text-[16px] text-[#111111]">
                <span className="font-medium">Class Code</span>{' '}
                <span className="font-normal">
                  {plan.class_label || plan.class_code || plan.subject || '—'}
                </span>
              </p>
              <p className="text-[16px] text-[#111111]">
                <span className="font-medium">Phase</span>{' '}
                <span className="font-normal">{plan.phase || '—'}</span>
              </p>
              <p className="col-span-full text-[16px] text-[#111111] sm:col-span-1">
                <span className="font-medium">Session</span>{' '}
                <span className="font-normal">{plan.session || '—'}</span>
              </p>
            </div>

            {[
              { heading: null, sections: META_SECTIONS },
              { heading: '1. Early Learning Goals', sections: GOALS_SECTIONS },
              { heading: '2. Assessment', sections: ASSESSMENT_SECTIONS },
              { heading: '3. Materials', sections: MATERIALS_SECTIONS },
              { heading: '4. Procedure', sections: PROCEDURE_SECTIONS },
              {
                heading: '5. Class-Specific Adjustments',
                sections: CLASS_SECTIONS,
              },
            ].map((group) => (
              <div key={group.heading || group.sections[0][1]}>
                {group.heading ? (
                  <h4 className="mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-[18px] font-bold text-[#111111]">
                    {group.heading}
                  </h4>
                ) : null}
                {group.sections.map(([title, key, revisionKey]) => (
                  <SectionBlock
                    key={key}
                    title={title}
                    content={resolveFieldContent(plan, key)}
                    plan={plan}
                    revisionFieldKey={revisionKey}
                  />
                ))}
              </div>
            ))}

            <h4 className="mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-[18px] font-bold text-[#111111]">
              6. Teacher&apos;s Reflection
            </h4>
            {plan.status === 'awaiting_reflection' ? (
              <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                Reflection fields are empty until you complete them. Click{' '}
                <strong>Complete Reflection</strong> above to enter Successes, Amazing Moments,
                Challenges, and Improvements.
              </p>
            ) : null}
            {REFLECTION_SECTIONS.map(([title, key]) => (
              <SectionBlock key={key} title={title} content={plan[key]} />
            ))}

            {showHeadTeacher ? (
              <>
                <h4 className="mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-[18px] font-bold text-[#111111]">
                  Head Teacher&apos;s Review and Feedback
                </h4>
                {HEAD_TEACHER_SECTIONS.map(([title, key]) => (
                  <SectionBlock key={key} title={title} content={plan[key]} />
                ))}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
