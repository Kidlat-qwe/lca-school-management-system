/**
 * Shared DepEd / school header fields for lesson plans.
 * Letterhead layout matches official LCA DepEd format:
 * Republika → DepEd → Region → Schools Division Office → School name.
 * Region / Division come from the branch; School ID stays shared (app constant).
 */

export const LESSON_PLAN_SCHOOL_NAME = 'Little Champions Academy, Inc.';

/** All-caps school line on DepEd letterhead. */
export const LESSON_PLAN_SCHOOL_NAME_LETTERHEAD = 'LITTLE CHAMPIONS ACADEMY INC.';

/** DepEd School ID — same for all LCA branches. */
export const LESSON_PLAN_SCHOOL_ID = '411093';

/** Public path for DepEd seal (from HEIC Convert asset). */
export const LESSON_PLAN_DEPED_SEAL_SRC = '/deped-seal.png';

/** Fallback when branch DepEd meta is missing. */
export const LESSON_PLAN_HEADER_META_FALLBACK = {
  region: 'Region III',
  division: 'Bulacan',
  district: '5th District',
  school_id: LESSON_PLAN_SCHOOL_ID,
  branch_address: '',
};

/**
 * Normalize region for letterhead (e.g. "Region III" → "REGION III").
 * @param {string} region
 */
export function formatLetterheadRegion(region) {
  const raw = String(region || '').trim();
  if (!raw) return 'REGION III';
  const upper = raw.toUpperCase();
  if (upper.startsWith('REGION')) return upper;
  return `REGION ${upper}`;
}

/**
 * Normalize division office line
 * (e.g. "Bulacan" → "SCHOOLS DIVISION OFFICE OF BULACAN").
 * @param {string} division
 */
export function formatLetterheadDivisionOffice(division) {
  const raw = String(division || '').trim();
  if (!raw) return 'SCHOOLS DIVISION OFFICE OF BULACAN';
  const upper = raw.toUpperCase();
  if (upper.includes('SCHOOLS DIVISION')) return upper;
  if (upper.startsWith('DIVISION OF ') || upper.startsWith('DIVISION OFFICE')) {
    return `SCHOOLS DIVISION OFFICE OF ${upper.replace(/^DIVISION (OFFICE )?OF\s+/i, '')}`;
  }
  return `SCHOOLS DIVISION OFFICE OF ${upper}`;
}

/**
 * Normalize API/branch row into header display props.
 * @param {object|null|undefined} branch
 */
export function resolveLessonPlanHeaderMeta(branch) {
  const region =
    (branch?.region || branch?.deped_region || '').trim() ||
    LESSON_PLAN_HEADER_META_FALLBACK.region;
  const division =
    (branch?.division || branch?.deped_division || '').trim() ||
    LESSON_PLAN_HEADER_META_FALLBACK.division;

  return {
    school_name: LESSON_PLAN_SCHOOL_NAME,
    school_name_letterhead: LESSON_PLAN_SCHOOL_NAME_LETTERHEAD,
    school_id: LESSON_PLAN_SCHOOL_ID,
    region,
    division,
    district:
      (branch?.district || branch?.deped_district || '').trim() ||
      LESSON_PLAN_HEADER_META_FALLBACK.district,
    branch_address:
      (branch?.branch_address || branch?.address || '').trim() ||
      LESSON_PLAN_HEADER_META_FALLBACK.branch_address,
    letterhead_region: formatLetterheadRegion(region),
    letterhead_division_office: formatLetterheadDivisionOffice(division),
  };
}

/** @deprecated Use resolveLessonPlanHeaderMeta + LESSON_PLAN_SCHOOL_ID */
export const LESSON_PLAN_HEADER_META = {
  ...LESSON_PLAN_HEADER_META_FALLBACK,
};

/** @deprecated Prefer branch.branch_address from API */
export const LESSON_PLAN_SCHOOL_ADDRESS = LESSON_PLAN_HEADER_META_FALLBACK.branch_address;
