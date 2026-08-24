/**
 * Lesson plan field mapping and validation helpers.
 */

export const LESSON_PLAN_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'revision_requested',
];

export const EDITABLE_STATUSES = new Set(['draft', 'revision_requested']);

export const GRADE_LEVEL_OPTIONS = [
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

export const SUBJECT_OPTIONS_BY_GRADE = {
  Nursery: ['Literacy (Jolly Phonics)', 'Numeracy', 'Understanding the World'],
  'Pre Kindergarten': [
    'Communication and Language',
    'Mathematics',
    'Understanding the World',
    'Expressive Arts and Design',
  ],
  Kindergarten: [
    'Language',
    'Mathematics',
    'Physical and Natural Environment',
    'Makabansa',
    'GMRC',
  ],
  'Grade 1': ['Reading and Literacy', 'GMRC', 'Language', 'Mathematics', 'Makabansa'],
  'Grade 2': ['English', 'Filipino', 'Mathematics', 'GMRC', 'Makabansa'],
  'Grade 3': ['English', 'Filipino', 'Mathematics', 'GMRC', 'Makabansa', 'Science'],
  'Grade 4': [
    'English',
    'Filipino',
    'Mathematics',
    'ESP/GMRC',
    'AP',
    'EPP/TLE',
    'Science',
    'MAPEH',
  ],
  'Grade 5': [
    'English',
    'Filipino',
    'Mathematics',
    'ESP/GMRC',
    'AP',
    'EPP/TLE',
    'Science',
    'MAPEH',
  ],
  'Grade 6': [
    'English',
    'Filipino',
    'Mathematics',
    'ESP/GMRC',
    'AP',
    'EPP/TLE',
    'Science',
    'MAPEH',
  ],
};

const TEXT_FIELDS = [
  'topic',
  'learning_objectives',
  'materials_resources',
  'opening_routine',
  'review',
  'lesson_presentation',
  'guided_practice',
  'assessment',
  'closing_wrapping_up',
  'reflection_went_well',
  'reflection_challenges',
  'reflection_improvements',
];

export function normalizeLessonPlanBody(body = {}) {
  const out = {};
  if (body.lesson_date != null) out.lesson_date = String(body.lesson_date).slice(0, 10);
  if (body.grade_level != null) out.grade_level = String(body.grade_level).trim();
  if (body.subject != null) out.subject = String(body.subject).trim();
  for (const key of TEXT_FIELDS) {
    if (body[key] != null) out[key] = String(body[key]);
  }
  return out;
}

export function validateLessonPlanPayload(payload, { requireAll = false } = {}) {
  const errors = [];
  if (requireAll || payload.lesson_date !== undefined) {
    if (!payload.lesson_date || !/^\d{4}-\d{2}-\d{2}$/.test(payload.lesson_date)) {
      errors.push('lesson_date is required (YYYY-MM-DD)');
    }
  }
  if (requireAll || payload.grade_level !== undefined) {
    if (!payload.grade_level) errors.push('grade_level is required');
  }
  if (requireAll || payload.subject !== undefined) {
    if (!payload.subject) errors.push('subject is required');
  }
  if (requireAll || payload.topic !== undefined) {
    if (!payload.topic?.trim()) errors.push('topic is required');
  }
  return errors;
}

/** Map DB row → API shape (review_section → review). */
export function mapLessonPlanRow(row) {
  if (!row) return null;
  return {
    lesson_plan_id: row.lesson_plan_id,
    branch_id: row.branch_id,
    branch_name: row.branch_name || null,
    branch_address: row.branch_address || null,
    teacher_user_id: row.teacher_user_id,
    teacher_name: row.teacher_name || null,
    lesson_date: row.lesson_date,
    grade_level: row.grade_level,
    subject: row.subject,
    topic: row.topic,
    learning_objectives: row.learning_objectives,
    materials_resources: row.materials_resources,
    opening_routine: row.opening_routine,
    review: row.review_section,
    lesson_presentation: row.lesson_presentation,
    guided_practice: row.guided_practice,
    assessment: row.assessment,
    closing_wrapping_up: row.closing_wrapping_up,
    reflection_went_well: row.reflection_went_well,
    reflection_challenges: row.reflection_challenges,
    reflection_improvements: row.reflection_improvements,
    status: row.status,
    submitted_at: row.submitted_at,
    revision_reason: row.revision_reason,
    verified_by: row.verified_by,
    verified_by_name: row.verified_by_name || null,
    verified_at: row.verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function lessonPlanWriteColumns(payload) {
  return {
    lesson_date: payload.lesson_date,
    grade_level: payload.grade_level,
    subject: payload.subject,
    topic: payload.topic ?? '',
    learning_objectives: payload.learning_objectives ?? '',
    materials_resources: payload.materials_resources ?? '',
    opening_routine: payload.opening_routine ?? '',
    review_section: payload.review ?? '',
    lesson_presentation: payload.lesson_presentation ?? '',
    guided_practice: payload.guided_practice ?? '',
    assessment: payload.assessment ?? '',
    closing_wrapping_up: payload.closing_wrapping_up ?? '',
    reflection_went_well: payload.reflection_went_well ?? '',
    reflection_challenges: payload.reflection_challenges ?? '',
    reflection_improvements: payload.reflection_improvements ?? '',
  };
}

export {
  notifyTeacherOfLessonPlanReview,
  notifyVerifiersOfLessonPlanSubmission,
} from './notifications.js';
