import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';
import { appAlert } from '../../utils/appAlert';
import { LessonPlanHeader } from '../../components/lessonPlanHeader';
import LessonPlanClassCodeSelect from '../../components/lessonPlanClassCodeSelect';
import LessonPlanSubmissionsTable from '../../components/lessonPlanSubmissionsTable';
import LessonPlanMissedTable from '../../components/lessonPlanMissedTable';
import LessonPlanViewModal from '../../components/lessonPlanViewModal';
import LessonPlanDateFilter from '../../components/lessonPlanDateFilter';
import {
  FieldRevisionNotes,
  GeneralRevisionNotes,
} from '../../components/lessonPlanRevisionFeedback';
import RichTextEditor, {
  isRichTextEmpty,
  mergeLessonPlanObjectivesHtml,
  LESSON_PLAN_RICH_TEXT_HTML_CLASS,
  isLessonPlanRichTextField,
} from '../../components/richTextEditor';
import {
  buildLessonPlanClassCodeOptions,
  buildLessonPlanClassCodeValue,
  buildLessonPlanPhaseOptions,
  buildLessonPlanPhaseSessionPayload,
  buildLessonPlanSessionOptions,
  buildSessionKey,
  findLessonPlanSession,
  parseLessonPlanPhaseSessionForm,
  resolveSelectedSessionClassCode,
  formatLessonPlanDateDisplay,
} from '../../utils/lessonPlanPhaseSession';

const createEmptyForm = () => ({
  lesson_date: new Date().toISOString().slice(0, 10),
  grade_level: '',
  class_id: '',
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
  preliminaries_activity: '',
  lesson_proper_activity: '',
  conclusion_activity: '',
  class1_considerations: '',
  class1_adjustments: '',
  reflection_went_well: '',
  reflection_amazing_moments: '',
  reflection_challenges: '',
  reflection_improvements: '',
});

const populateFormFromPlan = (plan) => {
  const { phase, session } = parseLessonPlanPhaseSessionForm(plan);
  return {
  lesson_date: plan.lesson_date ? String(plan.lesson_date).slice(0, 10) : '',
  grade_level: plan.grade_level || '',
  class_id: plan.class_id != null ? String(plan.class_id) : '',
  phase,
  session,
  topic: plan.topic || '',
  early_learning_goals: plan.early_learning_goals || '',
  objective_1: mergeLessonPlanObjectivesHtml(plan),
  objective_2: '',
  objective_3: '',
  assessment_method: plan.assessment_method || '',
  assessment_criteria: plan.assessment_criteria || '',
  materials_needed: plan.materials_needed || '',
  preliminaries_activity: plan.preliminaries_activity || '',
  lesson_proper_activity: plan.lesson_proper_activity || '',
  conclusion_activity: plan.conclusion_activity || '',
  class1_considerations: plan.class1_considerations || '',
  class1_adjustments: plan.class1_adjustments || '',
  reflection_went_well: plan.reflection_went_well || '',
  reflection_amazing_moments: plan.reflection_amazing_moments || '',
  reflection_challenges: plan.reflection_challenges || '',
  reflection_improvements: plan.reflection_improvements || '',
  };
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

function normalizeGradeLevelKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, ' ');
}

function classMatchesGradeLevel(classRow, gradeLevel) {
  if (!gradeLevel || !classRow) return false;
  return normalizeGradeLevelKey(classRow.level_tag) === normalizeGradeLevelKey(gradeLevel);
}

/** Header + sections 1–6 must be complete before submit for verification. */
const LESSON_PLAN_SECTION_REQUIRED_FIELDS = [
  'early_learning_goals',
  'objective_1',
  'assessment_method',
  'assessment_criteria',
  'materials_needed',
  'preliminaries_activity',
  'lesson_proper_activity',
  'conclusion_activity',
  'class1_considerations',
  'class1_adjustments',
];

function isLessonPlanSubmitReady(formData = {}) {
  if (!formData.lesson_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(formData.lesson_date).slice(0, 10))) {
    return false;
  }
  if (!String(formData.grade_level || '').trim()) return false;
  if (!String(formData.class_id || '').trim()) return false;
  if (!String(formData.phase || '').trim()) return false;
  if (!String(formData.session || '').trim()) return false;
  if (!String(formData.topic || '').trim()) return false;
  return LESSON_PLAN_SECTION_REQUIRED_FIELDS.every((key) => !isRichTextEmpty(formData[key]));
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
  const [missedPlans, setMissedPlans] = useState([]);
  const [missedSince, setMissedSince] = useState('');
  const [missedDefaultSince, setMissedDefaultSince] = useState('');
  const [listTab, setListTab] = useState('submissions');
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [viewPlan, setViewPlan] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState(createEmptyForm);
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [missedLoading, setMissedLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [classSessions, setClassSessions] = useState([]);
  const [classSessionsLoading, setClassSessionsLoading] = useState(false);
  const [gradeSessions, setGradeSessions] = useState([]);
  const [gradeSessionsLoading, setGradeSessionsLoading] = useState(false);
  const [manilaToday, setManilaToday] = useState(getManilaTodayYmd);
  const formScrollRef = useRef(null);
  const reflectionSectionRef = useRef(null);
  const [reflectionBlink, setReflectionBlink] = useState(false);

  const scrollFormToTop = useCallback(() => {
    requestAnimationFrame(() => {
      formScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

  const scrollToTeacherReflection = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        reflectionSectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 80);
    });
  }, []);

  const preparedBy =
    userInfo?.full_name || userInfo?.fullName || userInfo?.email || 'Current Teacher';

  const branchName =
    meta?.branch?.branch_name ||
    meta?.branch?.name ||
    userInfo?.branch_name ||
    'your branch';

  const canEdit = useMemo(() => {
    if (!selectedPlan) return true;
    return ['draft', 'revision_requested'].includes(selectedPlan.status);
  }, [selectedPlan]);

  const canEditReflections = useMemo(() => {
    if (!selectedPlan) return false;
    return selectedPlan.status === 'awaiting_reflection';
  }, [selectedPlan]);

  const branchClasses = useMemo(() => meta?.classes || [], [meta]);

  const gradeLevelOptions = useMemo(() => meta?.grade_levels || [], [meta]);

  const classOptions = useMemo(() => {
    if (!formData.grade_level) return [];
    const filtered = branchClasses.filter((cls) =>
      classMatchesGradeLevel(cls, formData.grade_level)
    );
    if (!formData.class_id) return filtered;
    const selected = branchClasses.find(
      (c) => String(c.class_id) === String(formData.class_id)
    );
    if (selected && !filtered.some((c) => c.class_id === selected.class_id)) {
      return [selected, ...filtered];
    }
    return filtered;
  }, [branchClasses, formData.grade_level, formData.class_id]);

  const classCodeOptions = useMemo(() => {
    const keepValue =
      formData.class_id && formData.phase && formData.session
        ? buildLessonPlanClassCodeValue(formData.class_id, formData.phase, formData.session)
        : '';
    // All grade sessions, each stamped with its class_id (View Class Details codes).
    const source =
      gradeSessions.length > 0
        ? gradeSessions
        : classSessions.map((row) => ({ ...row, class_id: formData.class_id }));
    return buildLessonPlanClassCodeOptions(source, {
      todayYmd: manilaToday,
      keepValue,
    });
  }, [
    classSessions,
    gradeSessions,
    formData.class_id,
    formData.phase,
    formData.session,
    manilaToday,
    selectedPlan,
  ]);

  const selectedClassCodeValue = useMemo(() => {
    if (!formData.class_id || !formData.phase || !formData.session) return '';
    return buildLessonPlanClassCodeValue(formData.class_id, formData.phase, formData.session);
  }, [formData.class_id, formData.phase, formData.session]);

  const phaseOptions = useMemo(
    () =>
      buildLessonPlanPhaseOptions(classSessions, {
        todayYmd: manilaToday,
        keepPhase: formData.phase || '',
      }),
    [classSessions, manilaToday, formData.phase]
  );

  const sessionOptions = useMemo(
    () =>
      buildLessonPlanSessionOptions(classSessions, formData.phase, {
        todayYmd: manilaToday,
        keepSessionKey: formData.session || '',
      }),
    [classSessions, formData.phase, formData.session, manilaToday]
  );

  const selectedSessionDateYmd = useMemo(() => {
    const row = findLessonPlanSession(classSessions, formData.session);
    return row?.scheduled_date ? String(row.scheduled_date).slice(0, 10) : '';
  }, [classSessions, formData.session]);

  const selectedSessionDateLabel = useMemo(
    () => (selectedSessionDateYmd ? formatLessonPlanDateDisplay(selectedSessionDateYmd) : ''),
    [selectedSessionDateYmd]
  );

  const selectedClassLabel = useMemo(() => {
    const sessionCode = resolveSelectedSessionClassCode(classSessions, formData.session);
    if (sessionCode) return sessionCode;
    return selectedPlan?.class_label || selectedPlan?.subject || '';
  }, [classSessions, formData.session, selectedPlan]);

  const filterGradeOptions = useMemo(() => {
    const fromMeta = Array.isArray(meta?.grade_levels) ? meta.grade_levels : [];
    const fromPlans = lessonPlans
      .map((p) => String(p.grade_level || '').trim())
      .filter(Boolean);
    const fromMissed = missedPlans
      .map((p) => String(p.grade_level || '').trim())
      .filter(Boolean);
    return [...new Set([...fromMeta, ...fromPlans, ...fromMissed])].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [meta, lessonPlans, missedPlans]);

  const filteredPlans = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return lessonPlans.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (gradeFilter !== 'all') {
        if (
          normalizeGradeLevelKey(p.grade_level) !== normalizeGradeLevelKey(gradeFilter)
        ) {
          return false;
        }
      }
      // Date filter is off when empty.
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
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [lessonPlans, statusFilter, gradeFilter, dateFilter, searchTerm]);

  const filteredMissedPlans = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return missedPlans.filter((p) => {
      if (gradeFilter !== 'all') {
        if (
          normalizeGradeLevelKey(p.grade_level) !== normalizeGradeLevelKey(gradeFilter)
        ) {
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
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [missedPlans, gradeFilter, searchTerm]);

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    gradeFilter !== 'all' ||
    (listTab === 'submissions' && Boolean(dateFilter)) ||
    (listTab === 'submissions' && statusFilter !== 'all') ||
    (listTab === 'missed' &&
      Boolean(missedSince) &&
      Boolean(missedDefaultSince) &&
      missedSince !== missedDefaultSince);

  const submitButtonLabel =
    selectedPlan?.status === 'revision_requested'
      ? 'Resubmit for Verification'
      : 'Submit for Verification';

  const canSubmitForVerification = useMemo(
    () => canEdit && isLessonPlanSubmitReady(formData),
    [canEdit, formData]
  );

  useEffect(() => {
    const tick = () => setManilaToday(getManilaTodayYmd());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchMissed = useCallback(async (sinceValue = '') => {
    setMissedLoading(true);
    try {
      const params = new URLSearchParams({ limit: '500' });
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
  }, []);

  const fetchPlans = useCallback(async () => {
    const [plansRes] = await Promise.all([
      apiRequest('/lesson-plans?limit=100'),
      fetchMissed(),
    ]);
    setLessonPlans(plansRes.data || []);
  }, [fetchMissed]);

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
      try {
        setLoading(true);
        setMissedLoading(true);
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
        if (!cancelled) {
          setLoading(false);
          setMissedLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPlans]);

  // Load sessions for all classes under the selected grade (Class Code = session codes).
  useEffect(() => {
    const grade = formData.grade_level;
    const classesForGrade = branchClasses.filter((cls) =>
      classMatchesGradeLevel(cls, grade)
    );
    if (!grade || !classesForGrade.length) {
      setGradeSessions([]);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setGradeSessionsLoading(true);
      try {
        const results = await Promise.all(
          classesForGrade.map(async (cls) => {
            try {
              const res = await apiRequest(`/classes/${cls.class_id}/sessions`);
              const rows = Array.isArray(res.data) ? res.data : [];
              return rows.map((row) => ({ ...row, class_id: cls.class_id }));
            } catch {
              return [];
            }
          })
        );
        if (!cancelled) {
          setGradeSessions(results.flat());
        }
      } finally {
        if (!cancelled) setGradeSessionsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [formData.grade_level, branchClasses]);

  useEffect(() => {
    const classId = formData.class_id;
    if (!classId) {
      setClassSessions([]);
      return undefined;
    }

    // Prefer already-loaded grade sessions for this class to avoid a second request.
    const fromGrade = gradeSessions.filter(
      (row) => String(row.class_id) === String(classId)
    );
    if (fromGrade.length) {
      setClassSessions(fromGrade);
      setClassSessionsLoading(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setClassSessionsLoading(true);
      try {
        const res = await apiRequest(`/classes/${classId}/sessions`);
        if (!cancelled) {
          setClassSessions(Array.isArray(res.data) ? res.data : []);
        }
      } catch {
        if (!cancelled) setClassSessions([]);
      } finally {
        if (!cancelled) setClassSessionsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [formData.class_id, gradeSessions]);

  // Grade Level only loads Class Code options — do not auto-select Class Code / Phase / Session.
  // Phase + Session fill only after the teacher picks a Class Code (see onChange below).

  useEffect(() => {
    if (!formData.session || !selectedSessionDateYmd) return;
    setFormData((prev) => {
      if (prev.lesson_date === selectedSessionDateYmd) return prev;
      return { ...prev, lesson_date: selectedSessionDateYmd };
    });
  }, [formData.session, selectedSessionDateYmd]);

  const closeFormModal = useCallback(() => {
    setFormOpen(false);
    setError('');
  }, []);

  useEffect(() => {
    if (!formOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') closeFormModal();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [formOpen, closeFormModal]);

  // Awaiting Reflection: scroll to Successes and blink reflection field borders.
  useEffect(() => {
    if (!formOpen || selectedPlan?.status !== 'awaiting_reflection') {
      setReflectionBlink(false);
      return undefined;
    }
    setReflectionBlink(true);
    scrollToTeacherReflection();
    const stopBlink = setTimeout(() => setReflectionBlink(false), 8000);
    return () => clearTimeout(stopBlink);
  }, [formOpen, selectedPlan?.lesson_plan_id, selectedPlan?.status, scrollToTeacherReflection]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleNewPlan = () => {
    setViewPlan(null);
    setSelectedPlan(null);
    setFormData(createEmptyForm());
    setError('');
    setFormOpen(true);
    scrollFormToTop();
  };

  const handleCreateFromMissed = (missed) => {
    if (!missed) return;
    const phaseNum = missed.phase_number != null ? String(missed.phase_number) : '';
    const sessionNum =
      missed.phase_session_number != null ? String(missed.phase_session_number) : '';
    const sessionKey = buildSessionKey(phaseNum, sessionNum);
    setViewPlan(null);
    setSelectedPlan(null);
    setListTab('submissions');
    setFormData({
      ...createEmptyForm(),
      lesson_date: String(missed.scheduled_date || missed.lesson_date || '').slice(0, 10),
      grade_level: missed.grade_level || '',
      class_id: missed.class_id != null ? String(missed.class_id) : '',
      phase: phaseNum,
      session: sessionKey,
      topic: missed.topic || '',
    });
    setError('');
    setFormOpen(true);
    scrollFormToTop();
  };

  const handleSelectPlan = (plan) => {
    setViewPlan(null);
    setSelectedPlan(plan);
    let nextForm = populateFormFromPlan(plan);
    if (plan.class_id && branchClasses.length) {
      const cls = branchClasses.find((c) => String(c.class_id) === String(plan.class_id));
      if (cls?.level_tag) {
        nextForm = { ...nextForm, grade_level: cls.level_tag };
      }
    }
    setFormData(nextForm);
    setError('');
    setFormOpen(true);
    if (plan?.status === 'awaiting_reflection') {
      scrollToTeacherReflection();
    } else {
      scrollFormToTop();
    }
  };

  const handleViewPlan = async (plan) => {
    // Awaiting Reflection: go straight to the edit form so reflection fields are writable.
    if (plan?.status === 'awaiting_reflection') {
      let planToEdit = plan;
      if (plan.lesson_plan_id) {
        try {
          const res = await apiRequest(`/lesson-plans/${plan.lesson_plan_id}`);
          if (res?.data) planToEdit = res.data;
        } catch {
          /* use list-row plan */
        }
      }
      handleSelectPlan(planToEdit);
      return;
    }

    setFormOpen(false);
    setViewPlan(plan);
    if (!plan?.lesson_plan_id) return;
    try {
      const res = await apiRequest(`/lesson-plans/${plan.lesson_plan_id}`);
      if (res?.data) setViewPlan(res.data);
    } catch {
      /* Keep list-row plan if detail fetch fails */
    }
  };

  const closeFormAfterSave = () => {
    setFormOpen(false);
    setSelectedPlan(null);
    setFormData(createEmptyForm());
    setError('');
  };

  const saveLessonPlan = async ({ submit = false } = {}) => {
    try {
      setSaving(true);
      setError('');

      if (submit && !isLessonPlanSubmitReady(formData)) {
        setError(
          'Complete lesson date, grade level, class, phase, session, topic, and all fields in sections 1–6 before submitting.'
        );
        scrollFormToTop();
        return;
      }

      const phaseSessionFields = buildLessonPlanPhaseSessionPayload(formData, classSessions);
      const selectedSessionClassCode =
        resolveSelectedSessionClassCode(classSessions, formData.session) ||
        classCodeOptions.find((o) => o.value === selectedClassCodeValue)?.class_code ||
        '';

      // Reflections are never saved during draft/submit — unlocked after verifier approval (awaiting_reflection).
      const payload = {
        ...formData,
        ...phaseSessionFields,
        class_id: formData.class_id ? Number(formData.class_id) : null,
        // Persist the Class Code shown in the form (session-scoped).
        subject: selectedSessionClassCode || '',
        // Single rich-text Learning Objectives field (legacy objective_2/3 cleared).
        objective_2: '',
        objective_3: '',
        reflection_went_well: '',
        reflection_amazing_moments: '',
        reflection_challenges: '',
        reflection_improvements: '',
      };

      const wasUpdate = Boolean(selectedPlan);

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
        }
      } else {
        await apiRequest('/lesson-plans', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            status: submit ? 'submitted' : 'draft',
          }),
        });
      }
      await fetchPlans();
      closeFormAfterSave();
      await appAlert(
        submit
          ? 'Lesson plan submitted for verification'
          : wasUpdate
            ? 'Lesson plan saved'
            : 'Lesson plan saved as draft'
      );
    } catch (err) {
      setError(err.message || 'Failed to save lesson plan');
      if (submit) scrollFormToTop();
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
      setFormOpen(false);
    } catch (err) {
      setError(err.message || 'Failed to save teacher reflection');
    } finally {
      setSaving(false);
    }
  };

  const sheetFont = { fontFamily: '"Poppins", "Inter", "Segoe UI", sans-serif' };

  const reflectionHint = (() => {
    if (selectedPlan?.status === 'completed') {
      return 'Teacher reflection is complete. This lesson plan is Completed.';
    }
    if (selectedPlan?.status === 'awaiting_reflection') {
      return 'Fill in all Teacher Reflection fields (Successes, Amazing Moments, Challenges, Improvements), then save to mark this plan Completed. No further verifier approval is required.';
    }
    return 'Teacher Reflection unlocks after a verifier approves this plan (status Awaiting Reflection).';
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Lesson Plans</h1>
          <p className="text-sm text-gray-600">
            View your lesson plan submissions for {branchName}
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

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex flex-wrap gap-2" aria-label="Lesson plan tabs">
          {[
            { key: 'submissions', label: 'My Plans', count: lessonPlans.length },
            { key: 'missed', label: 'Missed', count: missedPlans.length },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setListTab(tab.key)}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                listTab === tab.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  listTab === tab.key
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
        <div
          className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${
            listTab === 'missed' ? 'xl:grid-cols-3' : 'xl:grid-cols-4'
          }`}
        >
          <div className="min-w-0 sm:col-span-2 xl:col-span-1">
            <label
              htmlFor="lesson-plan-search-filter"
              className="mb-1 block text-xs font-medium text-gray-700"
            >
              Search
            </label>
            <div className="relative">
              <input
                id="lesson-plan-search-filter"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by topic, class code, or grade level..."
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
          {listTab === 'missed' ? (
            <LessonPlanDateFilter
              id="teacher-lesson-plan-missed-since"
              label="Track from"
              value={missedSince}
              onChange={handleMissedSinceChange}
            />
          ) : (
            <LessonPlanDateFilter
              value={dateFilter}
              onChange={setDateFilter}
            />
          )}
          <div className="min-w-0">
            <label
              htmlFor="lesson-plan-grade-filter"
              className="mb-1 block text-xs font-medium text-gray-700"
            >
              Grade Level
            </label>
            <select
              id="lesson-plan-grade-filter"
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
          {listTab === 'submissions' ? (
            <div className="min-w-0">
              <label
                htmlFor="lesson-plan-status-filter"
                className="mb-1 block text-xs font-medium text-gray-700"
              >
                Status
              </label>
              <select
                id="lesson-plan-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                aria-label="Filter by status"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="awaiting_reflection">Awaiting Reflection</option>
                <option value="revision_requested">Revision Requested</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          ) : null}
        </div>
      </div>

      {listTab === 'missed' ? (
        <LessonPlanMissedTable
          rows={filteredMissedPlans}
          loading={missedLoading}
          showTeacher={false}
          emptyMessage={
            hasActiveFilters
              ? 'No matching missed lesson plans. Try adjusting your search or filters.'
              : 'No missed lesson plans. All overdue sessions have a submitted plan.'
          }
          showingLabel={
            !missedLoading && filteredMissedPlans.length > 0
              ? `Showing ${filteredMissedPlans.length} missed lesson plan${
                  filteredMissedPlans.length === 1 ? '' : 's'
                }${missedSince ? ` (from ${missedSince})` : ''}`
              : ''
          }
          onCreate={handleCreateFromMissed}
        />
      ) : (
        <LessonPlanSubmissionsTable
          plans={filteredPlans}
          loading={loading}
          emptyMessage={
            hasActiveFilters
              ? 'No matching lesson plans. Try adjusting your search or filters.'
              : 'No lesson plans submitted yet.'
          }
          showingLabel={
            !loading && filteredPlans.length > 0
              ? `Showing ${filteredPlans.length} of ${lessonPlans.length} lesson plan${
                  lessonPlans.length === 1 ? '' : 's'
                }`
              : ''
          }
          activePlanId={formOpen ? selectedPlan?.lesson_plan_id : null}
          onView={handleViewPlan}
          onSelect={handleSelectPlan}
        />
      )}

      {formOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black/55 p-3 sm:p-5 lg:p-8"
              onClick={() => {
                if (!saving) closeFormModal();
              }}
              role="presentation"
            >
              <div
                className="relative flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-md bg-[#f3f4f6] shadow-2xl"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={selectedPlan ? 'Edit lesson plan' : 'Create lesson plan'}
              >
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
                  <h2 className="truncate text-base font-semibold text-[#333333] sm:text-lg">
                    {selectedPlan?.status === 'awaiting_reflection'
                      ? "Complete Teacher's Reflection"
                      : selectedPlan
                        ? 'Edit Lesson Plan'
                        : 'Create Lesson Plan'}
                  </h2>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={closeFormModal}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-[28px] font-bold leading-none text-[#d32f2f] hover:bg-red-50 hover:text-red-800 disabled:opacity-50"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>

                <div
                  ref={formScrollRef}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 lg:p-8"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#cbd5e0 #f7fafc',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  {error ? (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </div>
                  ) : null}

                  <div
                    className="mx-auto w-full max-w-[960px] rounded-md border border-[#eeeeee] bg-white px-5 py-6 text-[#111111] shadow-[0_10px_30px_rgba(0,0,0,0.08)] sm:px-10 sm:py-9 lg:px-[42px] lg:py-[34px]"
                    style={sheetFont}
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
                  // Changing grade clears Class Code / Phase / Session — teacher picks Class Code next.
                  setFormData((prev) => ({
                    ...prev,
                    grade_level: gradeLevel,
                    class_id: '',
                    phase: '',
                    session: '',
                    topic: '',
                  }));
                }}
                className={fieldControlCls}
              >
                <option value="">
                  {gradeLevelOptions.length
                    ? 'Select grade level'
                    : 'No classes in your branch yet'}
                </option>
                {gradeLevelOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>

            <div className={`${fieldLabelCls} col-span-full`}>
              <span className="shrink-0">Class Code</span>
              <LessonPlanClassCodeSelect
                options={classCodeOptions}
                value={selectedClassCodeValue}
                disabled={
                  !canEdit || loading || !formData.grade_level || gradeSessionsLoading
                }
                loading={gradeSessionsLoading}
                emptyHint={
                  !formData.grade_level
                    ? 'Select grade level first'
                    : 'No upcoming class codes for this grade'
                }
                placeholder="Select class code"
                onChange={(opt) => {
                  // Class Code is the source of truth — Phase / Session follow it.
                  setFormData((prev) => ({
                    ...prev,
                    class_id: String(opt.class_id || ''),
                    phase: String(opt.phase || ''),
                    session: String(opt.session || ''),
                    lesson_date: opt.scheduled_date || prev.lesson_date,
                    topic: opt.topic || prev.topic,
                  }));
                }}
              />
            </div>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="class_id" />

            <label className={fieldLabelCls}>
              <span className="shrink-0">Phase</span>
              <select
                disabled={!canEdit || !formData.class_id || classSessionsLoading}
                value={formData.phase}
                onChange={(e) => {
                  const phase = e.target.value;
                  const nextSession = buildLessonPlanSessionOptions(classSessions, phase, {
                    todayYmd: manilaToday,
                  })[0];
                  const row = nextSession
                    ? findLessonPlanSession(classSessions, nextSession.key)
                    : null;
                  setFormData((prev) => ({
                    ...prev,
                    phase,
                    session: nextSession?.key || '',
                    lesson_date: row?.scheduled_date
                      ? String(row.scheduled_date).slice(0, 10)
                      : prev.lesson_date,
                    topic: String(row?.topic || '').trim() || prev.topic,
                  }));
                }}
                className={fieldControlCls}
              >
                <option value="">
                  {!formData.class_id
                    ? 'Select class code first'
                    : classSessionsLoading
                      ? 'Loading phases…'
                      : phaseOptions.length
                        ? 'Select phase'
                        : 'No upcoming phases for this class'}
                </option>
                {phaseOptions.map((phaseNum) => (
                  <option key={phaseNum} value={String(phaseNum)}>
                    Phase {phaseNum}
                  </option>
                ))}
              </select>
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="phase" />

            <label className={fieldLabelCls}>
              <span className="shrink-0">Session</span>
              <select
                disabled={!canEdit || !formData.phase || classSessionsLoading}
                value={formData.session}
                onChange={(e) => {
                  const sessionKey = e.target.value;
                  const row = findLessonPlanSession(classSessions, sessionKey);
                  setFormData((prev) => ({
                    ...prev,
                    session: sessionKey,
                    lesson_date: row?.scheduled_date
                      ? String(row.scheduled_date).slice(0, 10)
                      : prev.lesson_date,
                    topic: String(row?.topic || '').trim() || prev.topic,
                  }));
                }}
                className={fieldControlCls}
              >
                <option value="">
                  {!formData.phase
                    ? 'Select class code first'
                    : sessionOptions.length
                      ? 'Select session'
                      : 'No upcoming sessions for this phase'}
                </option>
                {sessionOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                    {opt.scheduled_date_label ? ` (${opt.scheduled_date_label})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="session" />
            {selectedSessionDateLabel ? (
              <p className="col-span-full -mt-1 mb-1 text-[12px] text-[#444444]">
                Lesson date auto-filled from session schedule ({selectedSessionDateLabel}).
              </p>
            ) : null}

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
              <RichTextEditor
                id="lesson-plan-early-learning-goals"
                disabled={!canEdit}
                value={formData.early_learning_goals}
                onChange={(html) => handleInputChange('early_learning_goals', html)}
                placeholder="List early learning goals"
                minHeight="140px"
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="early_learning_goals" />

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              2. Learning Objectives
            </h3>

            <label className={blockLabelCls}>
              Learning Objectives
              <RichTextEditor
                id="lesson-plan-learning-objectives"
                disabled={!canEdit}
                value={formData.objective_1}
                onChange={(html) => handleInputChange('objective_1', html)}
                placeholder="Write learning objectives"
                minHeight="160px"
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="objective_1" />

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              3. Assessment
            </h3>

            <label className={blockLabelCls}>
              Assessment Method
              <RichTextEditor
                id="lesson-plan-assessment-method"
                disabled={!canEdit}
                value={formData.assessment_method}
                onChange={(html) => handleInputChange('assessment_method', html)}
                placeholder="Describe assessment method"
                minHeight="120px"
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="assessment_method" />

            <label className={blockLabelCls}>
              Assessment Criteria
              <RichTextEditor
                id="lesson-plan-assessment-criteria"
                disabled={!canEdit}
                value={formData.assessment_criteria}
                onChange={(html) => handleInputChange('assessment_criteria', html)}
                placeholder="Describe assessment criteria"
                minHeight="120px"
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="assessment_criteria" />

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              4. Materials Needed To Prepare
            </h3>

            <label className={blockLabelCls}>
              Materials Needed
              <RichTextEditor
                id="lesson-plan-materials-needed"
                disabled={!canEdit}
                value={formData.materials_needed}
                onChange={(html) => handleInputChange('materials_needed', html)}
                placeholder="List materials needed to prepare"
                minHeight="120px"
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
                <label className={blockLabelCls}>
                  {title} — Activity &amp; Goal
                  <RichTextEditor
                    id={`lesson-plan-${prefix}-activity`}
                    disabled={!canEdit}
                    value={formData[`${prefix}_activity`]}
                    onChange={(html) => handleInputChange(`${prefix}_activity`, html)}
                    placeholder={`${title} activity and goal`}
                    minHeight="120px"
                  />
                </label>
                <FieldRevisionNotes plan={selectedPlan} fieldKey={`${prefix}_activity`} />
              </Fragment>
            ))}

            <h3 className="col-span-full mb-1 mt-3 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]">
              6. Class-Specific Adjustments
            </h3>

            {selectedClassLabel ? (
              <p className="col-span-full -mt-1 mb-1 text-[13px] text-[#444444]">
                Selected class:{' '}
                <span className="font-semibold text-[#111111]">{selectedClassLabel}</span>
              </p>
            ) : (
              <p className="col-span-full -mt-1 mb-1 text-[13px] text-[#7a4b00]">
                Select a class above to attach this lesson plan to one class.
              </p>
            )}

            <label className={blockLabelCls}>
              Considerations
              <RichTextEditor
                id="lesson-plan-class1-considerations"
                disabled={!canEdit}
                value={formData.class1_considerations}
                onChange={(html) => handleInputChange('class1_considerations', html)}
                placeholder="Class considerations"
                minHeight="100px"
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="class1_considerations" />
            <label className={blockLabelCls}>
              Adjustments
              <RichTextEditor
                id="lesson-plan-class1-adjustments"
                disabled={!canEdit}
                value={formData.class1_adjustments}
                onChange={(html) => handleInputChange('class1_adjustments', html)}
                placeholder="Class adjustments"
                minHeight="100px"
              />
            </label>
            <FieldRevisionNotes plan={selectedPlan} fieldKey="class1_adjustments" />

            <h3
              ref={reflectionSectionRef}
              id="teacher-reflection-section"
              className="col-span-full mb-1 mt-3 scroll-mt-4 border-t-2 border-[#111111] pt-2.5 text-lg font-bold text-[#111111]"
            >
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
              <label key={field} className={blockLabelCls} onFocusCapture={() => setReflectionBlink(false)}>
                {title}
                <RichTextEditor
                  id={`lesson-plan-${field}`}
                  disabled={!canEditReflections}
                  value={formData[field]}
                  onChange={(html) => handleInputChange(field, html)}
                  placeholder={`Write ${title.toLowerCase()}`}
                  minHeight="120px"
                  className={
                    canEditReflections && reflectionBlink
                      ? 'lesson-plan-reflection-blink'
                      : ''
                  }
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
                      <div className="overflow-hidden rounded-lg border border-[#d8d8d8] bg-white px-3 py-2.5">
                        {isLessonPlanRichTextField(field) &&
                        String(selectedPlan[field] || '').trim() ? (
                          <div
                            className={LESSON_PLAN_RICH_TEXT_HTML_CLASS}
                            dangerouslySetInnerHTML={{
                              __html: selectedPlan[field],
                            }}
                          />
                        ) : (
                          <p className="min-h-[2.5rem] whitespace-pre-wrap text-base leading-relaxed text-[#111111]">
                            {(selectedPlan[field] || '').trim() || '—'}
                          </p>
                        )}
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
                ? 'Lesson body is locked after verification. Complete Teacher Reflection below to mark this plan Completed.'
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
                  disabled={saving || !canSubmitForVerification}
                  title={
                    canSubmitForVerification
                      ? undefined
                      : 'Complete all header fields and sections 1–6 to submit for verification'
                  }
                  onClick={() => saveLessonPlan({ submit: true })}
                  className={btnPrimaryCls}
                >
                  {saving ? 'Submitting...' : submitButtonLabel}
                </button>
              </>
            )}
          </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <LessonPlanViewModal
        open={Boolean(viewPlan)}
        plan={viewPlan}
        onClose={() => setViewPlan(null)}
        onEdit={(plan) => handleSelectPlan(plan)}
      />
    </div>
  );
}
