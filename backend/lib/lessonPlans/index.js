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

/**
 * Coerce DB Date / ISO / MM/DD/YYYY / session schedule values to YYYY-MM-DD.
 * node-pg returns PostgreSQL `date` as a JS Date at UTC midnight for that calendar day.
 */
export function toLessonPlanDateYmd(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const mm = mdy[1].padStart(2, '0');
    const dd = mdy[2].padStart(2, '0');
    return `${mdy[3]}-${mm}-${dd}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

/** Display label for a CMS class row (Settings / meta / legacy subject column). */
export function formatLessonPlanClassLabel(classRow = null) {
  if (!classRow) return '';
  const code = String(classRow.class_code || '').trim();
  if (code) return code;
  const name = String(classRow.class_name || '').trim();
  const program = String(classRow.program_name || '').trim();
  const level = String(classRow.level_tag || '').trim();
  const parts = [name, program, level].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  const id = classRow.class_id;
  return id != null ? `Class #${id}` : '';
}

/**
 * True when teacher is primary or junction-assigned on the class.
 */
export async function isTeacherAssignedToClass(runQuery, classId, teacherUserId) {
  const cid = Number(classId);
  const tid = Number(teacherUserId);
  if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(tid) || tid <= 0) {
    return false;
  }
  const result = await runQuery(
    `
    SELECT 1
    FROM classestbl c
    WHERE c.class_id = $1
      AND c.archived_at IS NULL
      AND (
        c.teacher_id = $2
        OR EXISTS (
          SELECT 1
          FROM classteacherstbl ct
          WHERE ct.class_id = c.class_id
            AND ct.teacher_id = $2
        )
      )
    LIMIT 1
    `,
    [cid, tid]
  );
  return result.rows.length > 0;
}

/**
 * Branch classes for lesson plan meta. Teachers only see designated classes.
 */
export async function fetchLessonPlanMetaClasses(
  runQuery,
  { branchId, teacherUserId = null } = {}
) {
  if (branchId == null) return [];
  const params = [branchId];
  let teacherFilterSql = '';
  if (teacherUserId != null) {
    params.push(teacherUserId);
    teacherFilterSql = `
      AND (
        c.teacher_id = $2
        OR EXISTS (
          SELECT 1
          FROM classteacherstbl ct
          WHERE ct.class_id = c.class_id
            AND ct.teacher_id = $2
        )
      )`;
  }

  const result = await runQuery(
    `
    SELECT
      c.class_id,
      c.class_name,
      c.level_tag,
      c.status,
      p.program_name,
      (
        SELECT cs.class_code
        FROM classsessionstbl cs
        WHERE cs.class_id = c.class_id
          AND NULLIF(TRIM(cs.class_code), '') IS NOT NULL
        ORDER BY cs.scheduled_date ASC NULLS LAST, cs.classsession_id ASC
        LIMIT 1
      ) AS class_code
    FROM classestbl c
    LEFT JOIN programstbl p ON p.program_id = c.program_id
    WHERE c.branch_id = $1
      AND c.archived_at IS NULL
      ${teacherFilterSql}
    ORDER BY p.program_name NULLS LAST, c.class_name NULLS LAST, c.class_id
    `,
    params
  );

  return (result.rows || []).map((row) => ({
    class_id: row.class_id,
    class_name: row.class_name || '',
    class_code: row.class_code || '',
    program_name: row.program_name || '',
    level_tag: row.level_tag || '',
    status: row.status || '',
    label: formatLessonPlanClassLabel(row),
  }));
}

export function normalizeLessonPlanBody(body = {}) {
  const out = {};
  if (body.lesson_date != null) out.lesson_date = toLessonPlanDateYmd(body.lesson_date);
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
export async function enrichLessonPlanPayloadWithClass(
  runQuery,
  payload = {},
  branchId = null,
  teacherUserId = null
) {
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
      p.program_name,
      (
        SELECT cs.class_code
        FROM classsessionstbl cs
        WHERE cs.class_id = c.class_id
          AND NULLIF(TRIM(cs.class_code), '') IS NOT NULL
        ORDER BY cs.scheduled_date ASC NULLS LAST, cs.classsession_id ASC
        LIMIT 1
      ) AS class_code
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
  if (teacherUserId != null) {
    const assigned = await isTeacherAssignedToClass(runQuery, classId, teacherUserId);
    if (!assigned) {
      return { ok: false, errors: ['You are not assigned to the selected class'] };
    }
  }

  const label = formatLessonPlanClassLabel(row);
  const levelTag = String(row.level_tag || '').trim();
  const gradeLevel = payload.grade_level || levelTag || '';

  // Prefer the session class_code for the plan's phase/session (same as View Class Details).
  let sessionClassCode = String(row.class_code || '').trim();
  const phaseNum = String(payload.phase || '').match(/(\d+)/)?.[1];
  const sessionNum = String(payload.session || '').match(/Session\s*(\d+)/i)?.[1];
  if (phaseNum && sessionNum) {
    const sessionRes = await runQuery(
      `
      SELECT class_code
      FROM classsessionstbl
      WHERE class_id = $1
        AND phase_number = $2
        AND phase_session_number = $3
        AND NULLIF(TRIM(class_code), '') IS NOT NULL
      ORDER BY classsession_id ASC
      LIMIT 1
      `,
      [classId, Number(phaseNum), Number(sessionNum)]
    );
    if (sessionRes.rows?.[0]?.class_code) {
      sessionClassCode = String(sessionRes.rows[0].class_code).trim();
      row.class_code = sessionClassCode;
    }
  }

  const displayLabel = formatLessonPlanClassLabel(row) || label;

  return {
    ok: true,
    payload: {
      ...payload,
      class_id: classId,
      grade_level: gradeLevel,
      subject: displayLabel,
      class1_name: String(row.class_name || '').trim() || displayLabel,
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

const HEAD_TEACHER_REVIEW_LABELS = Object.freeze({
  head_teacher_overall_assessment: 'Overall Assessment',
  head_teacher_specific_feedback: 'Specific Feedback',
  head_teacher_next_steps: 'Next Steps',
});

/** All Head Teacher review fields required before approve. */
export function validateHeadTeacherReviewPayload(payload = {}) {
  const errors = [];
  for (const key of HEAD_TEACHER_REVIEW_FIELDS) {
    if (!String(payload[key] || '').trim()) {
      errors.push(`${HEAD_TEACHER_REVIEW_LABELS[key] || key} is required before approving`);
    }
  }
  return errors;
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
  const ymd = toLessonPlanDateYmd(lessonDate);
  return ymd || null;
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
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    if (Number(raw.v) === 1 && Array.isArray(raw.items)) {
      return {
        v: 1,
        items: raw.items,
        general: raw.general || null,
        legacy: false,
      };
    }
    if (Array.isArray(raw.items) || raw.general) {
      return {
        v: Number(raw.v) === 1 ? 1 : 0,
        items: Array.isArray(raw.items) ? raw.items : [],
        general: raw.general || null,
        legacy: Boolean(raw.legacy),
      };
    }
  }

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
  // Prefer the session class_code saved on the plan (subject) / phase-session match.
  const savedClassCode = String(row.subject || '').trim();
  const linkedClassCode = String(row.linked_class_code || '').trim();
  const displayClassCode = linkedClassCode || savedClassCode;
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
    lesson_date: toLessonPlanDateYmd(row.lesson_date),
    grade_level: row.grade_level,
    class_id: row.class_id ?? null,
    class_name: row.linked_class_name || row.class1_name || null,
    class_code: displayClassCode || null,
    program_name: row.linked_program_name || null,
    class_label:
      displayClassCode ||
      formatLessonPlanClassLabel({
        class_id: row.class_id,
        class_code: linkedClassCode,
        class_name: row.linked_class_name || row.class1_name,
        program_name: row.linked_program_name,
        level_tag: row.linked_level_tag || row.class1_age_group,
      }) ||
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
    lesson_date: toLessonPlanDateYmd(payload.lesson_date) || payload.lesson_date,
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

/** Statuses that count as a submitted lesson plan (draft does not). */
export const SUBMITTED_LESSON_PLAN_STATUSES = Object.freeze([
  'submitted',
  'revision_requested',
  'awaiting_reflection',
  'completed',
]);

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Missed-tab go-live: sessions before this date are ignored.
 * Redeploy start (Asia/Manila). Change here when rolling out tracking.
 */
export const LESSON_PLAN_MISSED_SINCE_DEFAULT = '2026-09-19';

/** Asia/Manila calendar date as YYYY-MM-DD. */
export function getLessonPlanManilaTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Default "track missed from" date (code constant, not .env).
 */
export function getDefaultLessonPlanMissedSince() {
  if (YMD_RE.test(LESSON_PLAN_MISSED_SINCE_DEFAULT)) {
    return LESSON_PLAN_MISSED_SINCE_DEFAULT;
  }
  const today = getLessonPlanManilaTodayYmd();
  const [y, m, d] = today.split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() - 14);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Resolve effective missed window start (inclusive).
 * Requested `since` wins when valid; otherwise the configured default.
 */
export function resolveLessonPlanMissedSince(requestedSince = null) {
  const req = String(requestedSince || '').trim().slice(0, 10);
  if (YMD_RE.test(req)) return req;
  return getDefaultLessonPlanMissedSince();
}

/**
 * Map a missed-session row → API shape (expected plan that was never submitted).
 */
export function mapMissedLessonPlanRow(row) {
  if (!row) return null;
  const phaseNumber = row.phase_number != null ? Number(row.phase_number) : null;
  const sessionNumber =
    row.phase_session_number != null ? Number(row.phase_session_number) : null;
  const topic = String(row.topic || '').trim();
  const sessionLabel =
    sessionNumber != null && Number.isFinite(sessionNumber)
      ? topic
        ? `Session ${sessionNumber} — ${topic}`
        : `Session ${sessionNumber}`
      : '';
  const classCode = String(row.class_code || '').trim();
  return {
    miss_key: [
      row.classsession_id,
      row.teacher_user_id,
      row.class_id,
      phaseNumber,
      sessionNumber,
    ].join(':'),
    classsession_id: row.classsession_id,
    class_id: row.class_id,
    branch_id: row.branch_id ?? null,
    branch_name: row.branch_name || null,
    teacher_user_id: row.teacher_user_id,
    teacher_name: row.teacher_name || null,
    scheduled_date: toLessonPlanDateYmd(row.scheduled_date),
    lesson_date: toLessonPlanDateYmd(row.scheduled_date),
    grade_level: String(row.grade_level || row.level_tag || '').trim() || null,
    class_name: row.class_name || null,
    class_code: classCode || null,
    class_label: classCode || row.class_name || null,
    phase: phaseNumber != null && Number.isFinite(phaseNumber) ? `Phase ${phaseNumber}` : '',
    session: sessionLabel,
    phase_number: phaseNumber,
    phase_session_number: sessionNumber,
    topic: topic || null,
    days_overdue: Number(row.days_overdue) || 0,
    status: 'missed',
  };
}

/**
 * Overdue scheduled sessions with no submitted lesson plan for the assigned teacher.
 * Missed = since <= scheduled_date < today (Asia/Manila). Draft plans do not count.
 * `since` defaults to LESSON_PLAN_MISSED_SINCE_DEFAULT (2026-09-19) so older class history is ignored.
 *
 * @param {Function} runQuery
 * @param {{
 *   teacherUserId?: number|null,
 *   branchId?: number|null,
 *   since?: string|null,
 *   limit?: number,
 * }} [options]
 * @returns {Promise<{ rows: object[], meta: { since: string, default_since: string, today: string } }>}
 */
export async function fetchMissedLessonPlans(
  runQuery,
  { teacherUserId = null, branchId = null, since = null, limit = 500 } = {}
) {
  const defaultSince = getDefaultLessonPlanMissedSince();
  const effectiveSince = resolveLessonPlanMissedSince(since);
  const today = getLessonPlanManilaTodayYmd();
  const params = [];
  let teacherFilter = '';
  let branchFilter = '';

  if (branchId != null) {
    params.push(Number(branchId));
    branchFilter = ` AND c.branch_id = $${params.length}`;
  }
  if (teacherUserId != null) {
    params.push(Number(teacherUserId));
    teacherFilter = ` AND t.teacher_id = $${params.length}`;
  }

  params.push(effectiveSince);
  const sinceParam = `$${params.length}`;

  const submittedStatuses = SUBMITTED_LESSON_PLAN_STATUSES.map((s) => `'${s}'`).join(', ');
  params.push(Math.min(Math.max(Number(limit) || 500, 1), 1000));

  const result = await runQuery(
    `
    WITH class_teachers AS (
      SELECT DISTINCT
        c.class_id,
        c.branch_id,
        c.level_tag,
        c.class_name,
        t.teacher_id
      FROM classestbl c
      CROSS JOIN LATERAL (
        SELECT DISTINCT x.teacher_id
        FROM (
          SELECT c.teacher_id AS teacher_id
          WHERE c.teacher_id IS NOT NULL
          UNION
          SELECT ct.teacher_id
          FROM classteacherstbl ct
          WHERE ct.class_id = c.class_id
        ) x
        WHERE x.teacher_id IS NOT NULL
      ) t
      WHERE c.archived_at IS NULL
        AND COALESCE(NULLIF(TRIM(c.status), ''), 'Active') = 'Active'
        ${branchFilter}
        ${teacherFilter}
    )
    SELECT
      cs.classsession_id,
      cs.class_id,
      cs.phase_number,
      cs.phase_session_number,
      NULLIF(TRIM(cs.class_code), '') AS class_code,
      TO_CHAR(cs.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
      (
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date - cs.scheduled_date
      )::int AS days_overdue,
      NULLIF(TRIM(ps.topic), '') AS topic,
      ct.teacher_id AS teacher_user_id,
      ct.branch_id,
      ct.level_tag AS grade_level,
      ct.class_name,
      u.full_name AS teacher_name,
      b.branch_name
    FROM classsessionstbl cs
    INNER JOIN class_teachers ct ON ct.class_id = cs.class_id
    INNER JOIN userstbl u ON u.user_id = ct.teacher_id
    LEFT JOIN branchestbl b ON b.branch_id = ct.branch_id
    LEFT JOIN phasesessionstbl ps ON ps.phasesessiondetail_id = cs.phasesessiondetail_id
    WHERE cs.scheduled_date IS NOT NULL
      AND cs.scheduled_date >= ${sinceParam}::date
      AND cs.scheduled_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
      AND COALESCE(NULLIF(TRIM(cs.status), ''), 'Scheduled') <> 'Cancelled'
      AND cs.phase_number IS NOT NULL
      AND cs.phase_session_number IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM lessonplanstbl lp
        WHERE lp.teacher_user_id = ct.teacher_id
          AND lp.class_id = cs.class_id
          AND lp.status IN (${submittedStatuses})
          AND NULLIF(substring(lp.phase from '[0-9]+'), '')::int = cs.phase_number
          AND NULLIF(
            (regexp_match(lp.session_label, '[Ss]ession[[:space:]]*([0-9]+)'))[1],
            ''
          )::int = cs.phase_session_number
      )
    ORDER BY cs.scheduled_date ASC, u.full_name ASC NULLS LAST, cs.class_id ASC,
      cs.phase_number ASC, cs.phase_session_number ASC
    LIMIT $${params.length}
    `,
    params
  );

  return {
    rows: (result.rows || []).map(mapMissedLessonPlanRow),
    meta: {
      since: effectiveSince,
      default_since: defaultSince,
      today,
    },
  };
}

/**
 * Whether an Admin user is selected in Settings → Lesson Plans as a verifier.
 */
export async function isConfiguredLessonPlanAdminVerifier(runQuery, userId) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return false;

  const result = await runQuery(
    `
    SELECT 1
    FROM lesson_plan_verifierstbl v
    INNER JOIN userstbl u ON u.user_id = v.user_id
    WHERE v.user_id = $1 AND TRIM(u.user_type) = 'Admin'
  `,
    [id]
  );
  return result.rows.length > 0;
}

export {
  countPendingLessonPlanSubmissions,
  notifyTeacherOfLessonPlanReview,
  notifyVerifiersOfLessonPlanSubmission,
} from './notifications.js';
