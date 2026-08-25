/**
 * Lesson plan field mapping and validation helpers.
 */

export const LESSON_PLAN_STATUSES = [
  'draft',
  'submitted',
  'awaiting_reflection',
  'revision_requested',
  'completed',
];

export const EDITABLE_STATUSES = new Set(['draft', 'revision_requested']);

/** Statuses where the teacher may edit Teacher's Reflection (date-gated separately). */
export const REFLECTION_EDITABLE_STATUSES = new Set(['awaiting_reflection']);

export const REFLECTION_FIELDS = [
  'reflection_went_well',
  'reflection_challenges',
  'reflection_improvements',
];

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

/** Calendar date in Asia/Manila as YYYY-MM-DD. */
export function getManilaTodayYmd(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function normalizeLessonDateYmd(lessonDate) {
  if (!lessonDate) return null;
  if (lessonDate instanceof Date) {
    return getManilaTodayYmd(lessonDate);
  }
  const s = String(lessonDate).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** True when lesson_date equals today's date in Asia/Manila. */
export function isLessonDateToday(lessonDate, now = new Date()) {
  const lessonYmd = normalizeLessonDateYmd(lessonDate);
  if (!lessonYmd) return false;
  return lessonYmd === getManilaTodayYmd(now);
}

/** Force empty reflections (used on create / draft edit / submit). */
export function clearReflectionFields(payload = {}) {
  return {
    ...payload,
    reflection_went_well: '',
    reflection_challenges: '',
    reflection_improvements: '',
  };
}

export function validateReflectionPayload(payload) {
  const errors = [];
  for (const key of REFLECTION_FIELDS) {
    if (!String(payload[key] || '').trim()) {
      errors.push(`${key} is required to complete the lesson plan`);
    }
  }
  return errors;
}

/** Teacher-facing status label. */
export function formatLessonPlanStatusForTeacher(status) {
  if (status === 'awaiting_reflection') return 'Awaiting Reflection';
  if (status === 'revision_requested') return 'Revision requested';
  if (status === 'completed') return 'Completed';
  if (status === 'submitted') return 'Submitted';
  if (status === 'draft') return 'Draft';
  return String(status || 'draft').replace(/_/g, ' ');
}

/** Fields a verifier can flag for revision (API key → label). */
export const REVISION_FIELD_LABELS = {
  topic: 'Topic',
  learning_objectives: 'Learning Objectives',
  materials_resources: 'Materials/Resources',
  opening_routine: 'I. Opening Routine',
  review: 'II. Review',
  lesson_presentation: 'III. Lesson Presentation',
  guided_practice: 'IV. Guided Practice',
  assessment: 'VI. Assessment',
  closing_wrapping_up: 'VII. Closing/Wrapping Up',
};

/**
 * Normalize verifier revision items into a JSON payload stored in revision_reason.
 * Supports highlighting quoted text and/or naming a specific field.
 */
export function buildRevisionFeedbackPayload({ items = [], general = '' } = {}) {
  const cleaned = (Array.isArray(items) ? items : [])
    .map((item) => {
      const fieldKey = String(item?.field || item?.field_key || '').trim();
      const label =
        String(item?.label || '').trim() ||
        REVISION_FIELD_LABELS[fieldKey] ||
        (fieldKey ? fieldKey : '');
      return {
        field: fieldKey && REVISION_FIELD_LABELS[fieldKey] ? fieldKey : null,
        label: label || null,
        highlight: String(item?.highlight || '').trim() || null,
        note: String(item?.note || '').trim() || null,
      };
    })
    .filter((item) => item.field || item.highlight || item.note);

  return {
    v: 1,
    items: cleaned,
    general: String(general || '').trim() || null,
  };
}

export function serializeRevisionFeedback(payload) {
  return JSON.stringify(payload);
}

/** Parse revision_reason: structured JSON (v1) or legacy plain text. */
export function parseRevisionFeedback(raw) {
  const text = raw == null ? '' : String(raw);
  if (!text.trim()) {
    return { v: 0, items: [], general: null, legacy: true };
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && Number(parsed.v) === 1 && Array.isArray(parsed.items)) {
      return {
        v: 1,
        items: parsed.items,
        general: parsed.general || null,
        legacy: false,
      };
    }
  } catch {
    /* legacy plain text */
  }
  return { v: 0, items: [], general: text, legacy: true };
}

export function summarizeRevisionFeedbackForNotification(payloadOrRaw) {
  const feedback =
    payloadOrRaw && typeof payloadOrRaw === 'object' && !Array.isArray(payloadOrRaw)
      ? payloadOrRaw
      : parseRevisionFeedback(payloadOrRaw);
  if (feedback.legacy && feedback.general) return String(feedback.general).slice(0, 280);
  const parts = [];
  for (const item of feedback.items || []) {
    const bits = [];
    if (item.label || item.field) bits.push(item.label || item.field);
    if (item.highlight) bits.push(`"${String(item.highlight).slice(0, 80)}"`);
    if (item.note) bits.push(item.note);
    if (bits.length) parts.push(bits.join(' — '));
  }
  if (feedback.general) parts.push(feedback.general);
  return parts.join(' | ').slice(0, 400) || 'Please revise the lesson plan.';
}

export function validateRevisionFeedbackPayload(payload) {
  const errors = [];
  if (!payload || (!payload.general && !(payload.items && payload.items.length))) {
    errors.push('Add at least one revision item (field and/or highlighted text) or a general note');
  }
  for (const item of payload?.items || []) {
    if (item.field && !REVISION_FIELD_LABELS[item.field]) {
      errors.push(`Unknown revision field: ${item.field}`);
    }
  }
  return errors;
}

/** Map DB row → API shape (review_section → review). */
export function mapLessonPlanRow(row) {
  if (!row) return null;
  const revisionReason = row.revision_reason;
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
    revision_reason: revisionReason,
    revision_feedback: parseRevisionFeedback(revisionReason),
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
