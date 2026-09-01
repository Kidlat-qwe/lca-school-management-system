/**
 * Lesson plan field mapping and validation helpers.
 * Form fields follow the LCA Lesson Plan PDF (teacher body + reflections + verifier Head Teacher review).
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
  'reflection_went_well', // Successes
  'reflection_amazing_moments',
  'reflection_challenges',
  'reflection_improvements',
];

/** Verifier-only Head Teacher review fields (saved on approve). */
export const HEAD_TEACHER_REVIEW_FIELDS = [
  'head_teacher_overall_assessment',
  'head_teacher_specific_feedback',
  'head_teacher_next_steps',
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

/** Normalize grade/level labels for matching (handles hyphen vs space). */
export function normalizeGradeLevelKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, ' ');
}

/**
 * Unique grade levels from branch classes' level_tag, sorted by GRADE_LEVEL_OPTIONS order.
 * @param {{ level_tag?: string }[]} classes
 */
export function deriveBranchGradeLevelsFromClasses(classes = []) {
  const seen = new Map();
  for (const cls of classes) {
    const tag = String(cls?.level_tag || '').trim();
    if (!tag) continue;
    const key = normalizeGradeLevelKey(tag);
    if (!seen.has(key)) seen.set(key, tag);
  }
  const tags = [...seen.values()];
  tags.sort((a, b) => {
    const ai = GRADE_LEVEL_OPTIONS.findIndex(
      (g) => normalizeGradeLevelKey(g) === normalizeGradeLevelKey(a)
    );
    const bi = GRADE_LEVEL_OPTIONS.findIndex(
      (g) => normalizeGradeLevelKey(g) === normalizeGradeLevelKey(b)
    );
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
  return tags;
}

export function classMatchesGradeLevel(classRow, gradeLevel) {
  if (!gradeLevel) return false;
  return normalizeGradeLevelKey(classRow?.level_tag) === normalizeGradeLevelKey(gradeLevel);
}

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

/** Teacher-editable content fields (LCA form). */
const TEXT_FIELDS = [
  'phase',
  'session',
  'topic',
  'early_learning_goals',
  'objective_1',
  'objective_2',
  'objective_3',
  'assessment_method',
  'assessment_criteria',
  'materials_needed',
  'preliminaries_activity',
  'lesson_proper_activity',
  'conclusion_activity',
  'class1_considerations',
  'class1_adjustments',
  'reflection_went_well',
  'reflection_amazing_moments',
  'reflection_challenges',
  'reflection_improvements',
];

/** Display label for a CMS class row (Settings / meta / legacy subject column). */
export function formatLessonPlanClassLabel(classRow = null) {
  if (!classRow) return '';
  const name = String(classRow.class_name || '').trim();
  const program = String(classRow.program_name || '').trim();
  const level = String(classRow.level_tag || '').trim();
  const parts = [name, program, level].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  const id = classRow.class_id;
  return id != null ? `Class #${id}` : '';
}

export function normalizeLessonPlanBody(body = {}) {
  const out = {};
  if (body.lesson_date != null) out.lesson_date = String(body.lesson_date).slice(0, 10);
  if (body.grade_level != null) out.grade_level = String(body.grade_level).trim();
  if (body.class_id != null && body.class_id !== '') {
    const classId = Number(body.class_id);
    if (Number.isFinite(classId) && classId > 0) out.class_id = classId;
  }
  if (body.subject != null) out.subject = String(body.subject).trim();
  for (const key of TEXT_FIELDS) {
    if (body[key] != null) out[key] = String(body[key]);
  }
  return out;
}

/**
 * Resolve class_id → denormalized subject/class1 fields; clears legacy class2/3 slots.
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, errors: string[] }>}
 */
export async function enrichLessonPlanPayloadWithClass(runQuery, payload = {}, branchId = null) {
  const classId = Number(payload.class_id);
  if (!Number.isFinite(classId) || classId <= 0) {
    return { ok: false, errors: ['class_id is required'] };
  }

  const result = await runQuery(
    `
    SELECT
      c.class_id,
      c.class_name,
      c.level_tag,
      c.branch_id,
      p.program_name
    FROM classestbl c
    LEFT JOIN programstbl p ON p.program_id = c.program_id
    WHERE c.class_id = $1 AND c.archived_at IS NULL
    `,
    [classId]
  );
  const row = result.rows?.[0];
  if (!row) {
    return { ok: false, errors: ['Selected class was not found or is archived'] };
  }
  if (branchId != null && Number(row.branch_id) !== Number(branchId)) {
    return { ok: false, errors: ['Selected class does not belong to your branch'] };
  }

  const label = formatLessonPlanClassLabel(row);
  const levelTag = String(row.level_tag || '').trim();
  const gradeLevel = payload.grade_level || levelTag || '';

  return {
    ok: true,
    payload: {
      ...payload,
      class_id: classId,
      grade_level: gradeLevel,
      subject: label,
      class1_name: String(row.class_name || '').trim() || label,
      class1_age_group: levelTag,
      class1_considerations: payload.class1_considerations ?? '',
      class1_adjustments: payload.class1_adjustments ?? '',
      class2_name: '',
      class2_age_group: '',
      class2_considerations: '',
      class2_adjustments: '',
      class3_name: '',
      class3_age_group: '',
      class3_considerations: '',
      class3_adjustments: '',
    },
  };
}

export function normalizeHeadTeacherReviewBody(body = {}) {
  const out = {};
  for (const key of HEAD_TEACHER_REVIEW_FIELDS) {
    if (body[key] != null) out[key] = String(body[key]);
  }
  return out;
}

/** Sections 1–6 — all fields required before submit for verification. */
export const LESSON_PLAN_SECTION_REQUIRED_FIELDS = Object.freeze([
  'early_learning_goals',
  'objective_1',
  'objective_2',
  'objective_3',
  'assessment_method',
  'assessment_criteria',
  'materials_needed',
  'preliminaries_activity',
  'lesson_proper_activity',
  'conclusion_activity',
  'class1_considerations',
  'class1_adjustments',
]);

const LESSON_PLAN_SECTION_FIELD_LABELS = Object.freeze({
  early_learning_goals: 'Early Learning Goals',
  objective_1: 'Objective 1',
  objective_2: 'Objective 2',
  objective_3: 'Objective 3',
  assessment_method: 'Assessment Method',
  assessment_criteria: 'Assessment Criteria',
  materials_needed: 'Materials Needed To Prepare',
  preliminaries_activity: 'Preliminaries — Activity & Goal',
  lesson_proper_activity: 'Lesson Proper — Activity & Goal',
  conclusion_activity: 'Conclusion — Activity & Goal',
  class1_considerations: 'Class — Considerations',
  class1_adjustments: 'Class — Adjustments',
});

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
  if (requireAll || payload.class_id !== undefined) {
    if (!payload.class_id) errors.push('class_id is required');
  }
  if (requireAll || payload.topic !== undefined) {
    if (!payload.topic?.trim()) errors.push('topic is required');
  }
  if (requireAll || payload.phase !== undefined) {
    if (!String(payload.phase || '').trim()) errors.push('phase is required');
  }
  if (requireAll || payload.session !== undefined) {
    if (!String(payload.session || '').trim()) errors.push('session is required');
  }
  if (requireAll) {
    for (const key of LESSON_PLAN_SECTION_REQUIRED_FIELDS) {
      if (!String(payload[key] || '').trim()) {
        errors.push(`${LESSON_PLAN_SECTION_FIELD_LABELS[key] || key} is required`);
      }
    }
  }
  return errors;
}

/** True when header + sections 1–6 are filled (submit for verification). */
export function isLessonPlanReadyForSubmit(payload = {}) {
  const normalized = normalizeLessonPlanBody(payload);
  return validateLessonPlanPayload(normalized, { requireAll: true }).length === 0;
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
    reflection_amazing_moments: '',
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

/** Fields a verifier can flag for revision (API key → label). Excludes reflections. */
export const REVISION_FIELD_LABELS = {
  topic: 'Lesson Topic',
  phase: 'Phase',
  session: 'Session',
  early_learning_goals: 'Early Learning Goals',
  objective_1: 'Objective 1',
  objective_2: 'Objective 2',
  objective_3: 'Objective 3',
  assessment_method: 'Assessment Method',
  assessment_criteria: 'Assessment Criteria',
  materials_needed: 'Materials Needed To Prepare',
  preliminaries_activity: 'Preliminaries — Activity & Goal',
  lesson_proper_activity: 'Lesson Proper — Activity & Goal',
  conclusion_activity: 'Conclusion — Activity & Goal',
  class_id: 'Class',
  class1_considerations: 'Class — Considerations',
  class1_adjustments: 'Class — Adjustments',
};

/**
 * Normalize verifier revision items into a JSON payload stored in revision_reason.
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

/** Map DB row → API shape (session_label → session). */
export function mapLessonPlanRow(row) {
  if (!row) return null;
  const revisionReason = row.revision_reason;
  return {
    lesson_plan_id: row.lesson_plan_id,
    branch_id: row.branch_id,
    branch_name: row.branch_name || null,
    branch_address: row.branch_address || null,
    deped_region: row.deped_region || null,
    deped_division: row.deped_division || null,
    deped_district: row.deped_district || null,
    region: row.deped_region || null,
    division: row.deped_division || null,
    district: row.deped_district || null,
    school_id: '411093',

    teacher_user_id: row.teacher_user_id,
    teacher_name: row.teacher_name || null,
    lesson_date: row.lesson_date,
    grade_level: row.grade_level,
    class_id: row.class_id ?? null,
    class_name: row.linked_class_name || row.class1_name || null,
    program_name: row.linked_program_name || null,
    class_label:
      formatLessonPlanClassLabel({
        class_id: row.class_id,
        class_name: row.linked_class_name || row.class1_name,
        program_name: row.linked_program_name,
        level_tag: row.linked_level_tag || row.class1_age_group,
      }) ||
      row.subject ||
      '',
    subject: row.subject,
    phase: row.phase || '',
    session: row.session_label || '',
    topic: row.topic,
    early_learning_goals: row.early_learning_goals || '',
    objective_1: row.objective_1 || '',
    objective_2: row.objective_2 || '',
    objective_3: row.objective_3 || '',
    assessment_method: row.assessment_method || '',
    assessment_criteria: row.assessment_criteria || '',
    materials_needed: row.materials_needed || '',
    preliminaries_time: row.preliminaries_time || '',
    preliminaries_activity: row.preliminaries_activity || '',
    lesson_proper_time: row.lesson_proper_time || '',
    lesson_proper_activity: row.lesson_proper_activity || '',
    conclusion_time: row.conclusion_time || '',
    conclusion_activity: row.conclusion_activity || '',
    class1_name: row.class1_name || '',
    class1_age_group: row.class1_age_group || '',
    class1_considerations: row.class1_considerations || '',
    class1_adjustments: row.class1_adjustments || '',
    class2_name: row.class2_name || '',
    class2_age_group: row.class2_age_group || '',
    class2_considerations: row.class2_considerations || '',
    class2_adjustments: row.class2_adjustments || '',
    class3_name: row.class3_name || '',
    class3_age_group: row.class3_age_group || '',
    class3_considerations: row.class3_considerations || '',
    class3_adjustments: row.class3_adjustments || '',
    reflection_went_well: row.reflection_went_well || '',
    reflection_amazing_moments: row.reflection_amazing_moments || '',
    reflection_challenges: row.reflection_challenges || '',
    reflection_improvements: row.reflection_improvements || '',
    head_teacher_overall_assessment: row.head_teacher_overall_assessment || '',
    head_teacher_specific_feedback: row.head_teacher_specific_feedback || '',
    head_teacher_next_steps: row.head_teacher_next_steps || '',
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

/** Columns written for teacher create/update (DB names). */
export function lessonPlanWriteColumns(payload) {
  return {
    lesson_date: payload.lesson_date,
    grade_level: payload.grade_level,
    class_id: payload.class_id ?? null,
    subject: payload.subject ?? '',
    phase: payload.phase ?? '',
    session_label: payload.session ?? '',
    topic: payload.topic ?? '',
    early_learning_goals: payload.early_learning_goals ?? '',
    objective_1: payload.objective_1 ?? '',
    objective_2: payload.objective_2 ?? '',
    objective_3: payload.objective_3 ?? '',
    assessment_method: payload.assessment_method ?? '',
    assessment_criteria: payload.assessment_criteria ?? '',
    materials_needed: payload.materials_needed ?? '',
    preliminaries_time: '',
    preliminaries_activity: payload.preliminaries_activity ?? '',
    lesson_proper_time: '',
    lesson_proper_activity: payload.lesson_proper_activity ?? '',
    conclusion_time: '',
    conclusion_activity: payload.conclusion_activity ?? '',
    class1_name: payload.class1_name ?? '',
    class1_age_group: payload.class1_age_group ?? '',
    class1_considerations: payload.class1_considerations ?? '',
    class1_adjustments: payload.class1_adjustments ?? '',
    class2_name: payload.class2_name ?? '',
    class2_age_group: payload.class2_age_group ?? '',
    class2_considerations: payload.class2_considerations ?? '',
    class2_adjustments: payload.class2_adjustments ?? '',
    class3_name: payload.class3_name ?? '',
    class3_age_group: payload.class3_age_group ?? '',
    class3_considerations: payload.class3_considerations ?? '',
    class3_adjustments: payload.class3_adjustments ?? '',
    reflection_went_well: payload.reflection_went_well ?? '',
    reflection_amazing_moments: payload.reflection_amazing_moments ?? '',
    reflection_challenges: payload.reflection_challenges ?? '',
    reflection_improvements: payload.reflection_improvements ?? '',
  };
}

export {
  notifyTeacherOfLessonPlanReview,
  notifyVerifiersOfLessonPlanSubmission,
} from './notifications.js';
