/**
 * Uniform / merchandise attribute helpers — RHET Inventory–aligned labels.
 * Keep in sync with backend PACKAGE_UNIFORM_TYPE_NAMES in merchandiseReleaseLog.js.
 *
 * Canonical (stored) values match RHET:
 * - Categories: School Uniform, PE Uniform, LCA T-Shirt, Backpack, …
 * - Gender: Male | Female | Unisex
 * - Size: XS | S | M | L | XL | 2XL | 3XL | 4XL | 5XL
 * - Type: Polo | Short | Blouse | Skirt | Shirt | Pants
 *
 * Legacy CMS labels (LCA Uniform, Men, Extra Small, …) are still recognized on
 * read and normalized to canonical values on write.
 *
 * Piece labels by category:
 * - School Uniform + Male → Polo + Short
 * - School Uniform + Female → Blouse + Skirt
 * - PE Uniform → Shirt + Pants
 * - LCA T-Shirt → Shirt
 *
 * Enrollment/package matching still uses Top/Bottom roles via getUniformCategory
 * (Polo/Shirt/Blouse → Top, Short/Pants/Skirt → Bottom).
 */

/** RHET-aligned canonical category names (persist these going forward). */
export const UNIFORM_SCHOOL_NAME = 'School Uniform';
export const UNIFORM_PE_NAME = 'PE Uniform';
export const UNIFORM_TSHIRT_NAME = 'LCA T-Shirt';
export const NON_UNIFORM_BACKPACK_NAME = 'Backpack';

/** Legacy names still present in DB / packages — treat as aliases of canonical. */
export const LEGACY_UNIFORM_SCHOOL_NAME = 'LCA Uniform';
export const LEGACY_UNIFORM_PE_NAME = 'LCA PE Uniform';
export const LEGACY_BACKPACK_NAMES = ['LCA Bag', 'Bag'];

export const UNIFORM_TOP_BOTTOM_TYPE_NAMES = [
  UNIFORM_SCHOOL_NAME,
  UNIFORM_PE_NAME,
  LEGACY_UNIFORM_SCHOOL_NAME,
  LEGACY_UNIFORM_PE_NAME,
];

/** RHET-aligned size dropdown options (stored values). */
export const UNIFORM_SIZE_OPTIONS = [
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
  '5XL',
];

/** Optional friendly labels for sizes (UI only — DB stores XS/S/…). */
export const UNIFORM_SIZE_DISPLAY_LABELS = {
  XS: 'XS (Extra Small)',
  S: 'S (Small)',
  M: 'M (Medium)',
  L: 'L (Large)',
  XL: 'XL (Extra Large)',
  '2XL': '2XL',
  '3XL': '3XL',
  '4XL': '4XL',
  '5XL': '5XL',
  'Extra Small': 'XS (Extra Small)',
  Small: 'S (Small)',
  Medium: 'M (Medium)',
  Large: 'L (Large)',
  'Extra Large': 'XL (Extra Large)',
};

/** RHET-aligned gender options (stored values). */
export const UNIFORM_GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Unisex', label: 'Unisex' },
];

const SIZE_TO_CANONICAL = {
  'Extra Small': 'XS',
  Small: 'S',
  Medium: 'M',
  Large: 'L',
  'Extra Large': 'XL',
  '2XL': '2XL',
  '3XL': '3XL',
  '4XL': '4XL',
  '5XL': '5XL',
  XS: 'XS',
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
};

const GENDER_TO_CANONICAL = {
  Men: 'Male',
  Male: 'Male',
  Man: 'Male',
  Boys: 'Male',
  Boy: 'Male',
  Women: 'Female',
  Female: 'Female',
  Woman: 'Female',
  Girls: 'Female',
  Girl: 'Female',
  Unisex: 'Unisex',
};

const CATEGORY_TO_CANONICAL = {
  'LCA Uniform': UNIFORM_SCHOOL_NAME,
  'School Uniform': UNIFORM_SCHOOL_NAME,
  'School Uniform_Replacement': UNIFORM_SCHOOL_NAME,
  'LCA PE Uniform': UNIFORM_PE_NAME,
  'PE Uniform': UNIFORM_PE_NAME,
  'PE Uniform_Replacement': UNIFORM_PE_NAME,
  'LCA T-Shirt': UNIFORM_TSHIRT_NAME,
  'LCA Tshirt': UNIFORM_TSHIRT_NAME,
  // RHET LCA_SHIRT categoryName is "Shirt" (type = Logo 1/2), not LCA T-Shirt
  Shirt: 'Shirt',
  'LCA Shirt': 'Shirt',
  'LCA Bag': NON_UNIFORM_BACKPACK_NAME,
  Bag: NON_UNIFORM_BACKPACK_NAME,
  Backpack: NON_UNIFORM_BACKPACK_NAME,
};

/** School uniform piece options (stored in merchandisestbl.type). */
export const UNIFORM_SCHOOL_PIECE_OPTIONS = [
  { value: 'Polo', label: 'Polo' },
  { value: 'Short', label: 'Short' },
  { value: 'Blouse', label: 'Blouse' },
  { value: 'Skirt', label: 'Skirt' },
];

export const UNIFORM_SCHOOL_MALE_PIECE_OPTIONS = [
  { value: 'Polo', label: 'Polo' },
  { value: 'Short', label: 'Short' },
];

export const UNIFORM_SCHOOL_FEMALE_PIECE_OPTIONS = [
  { value: 'Blouse', label: 'Blouse' },
  { value: 'Skirt', label: 'Skirt' },
];

/** PE uniform piece options. */
export const UNIFORM_PE_PIECE_OPTIONS = [
  { value: 'Shirt', label: 'Shirt' },
  { value: 'Pants', label: 'Pants' },
];

export const UNIFORM_TSHIRT_PIECE_OPTIONS = [{ value: 'Shirt', label: 'Shirt' }];

/** LCA_SHIRT / category "Shirt" — RHET type is Logo 1 / Logo 2 (not PE "Shirt"). */
export const UNIFORM_LCA_SHIRT_PIECE_OPTIONS = [
  { value: 'Logo 1', label: 'Logo 1' },
  { value: 'Logo 2', label: 'Logo 2' },
];

/**
 * All known piece values (new + legacy Top/Bottom) for filters.
 * Prefer getUniformPieceOptions(merchandiseName, gender) in forms.
 */
export const UNIFORM_PIECE_OPTIONS = [
  ...UNIFORM_SCHOOL_PIECE_OPTIONS,
  ...UNIFORM_PE_PIECE_OPTIONS,
  ...UNIFORM_LCA_SHIRT_PIECE_OPTIONS,
  { value: 'Top', label: 'Top' },
  { value: 'Bottom', label: 'Bottom' },
];

/** Normalize merchandise category/type name to RHET-aligned value when known. */
export function normalizeMerchandiseCategoryName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  if (CATEGORY_TO_CANONICAL[raw]) return CATEGORY_TO_CANONICAL[raw];
  return raw;
}

/** Normalize gender to Male | Female | Unisex (or original if unknown). */
export function normalizeMerchandiseGender(gender) {
  if (gender == null || gender === '') return null;
  const key = String(gender).trim();
  return GENDER_TO_CANONICAL[key] || key;
}

/** Normalize size to XS…5XL (or original if unknown). */
export function normalizeMerchandiseSize(size) {
  if (size == null || size === '') return null;
  const key = String(size).trim();
  return SIZE_TO_CANONICAL[key] || key;
}

/** Normalize piece type — never map Polo → Shirt. */
export function normalizeMerchandiseType(type) {
  if (type == null || type === '') return null;
  const key = String(type).trim();
  if (key === 'Top') return 'Polo'; // ambiguous legacy; prefer Polo for school
  if (key === 'Bottom') return 'Short';
  return key;
}

/**
 * Normalize a merchandise form/API payload to RHET-canonical stored values.
 */
export function normalizeMerchandiseAttributes({
  merchandise_name,
  gender,
  size,
  type,
} = {}) {
  return {
    merchandise_name: normalizeMerchandiseCategoryName(merchandise_name) || merchandise_name,
    gender: normalizeMerchandiseGender(gender),
    size: normalizeMerchandiseSize(size),
    type: normalizeMerchandiseType(type),
  };
}

export function isLearningKitMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  return String(merchandiseName).toLowerCase().includes('learning kit');
}

export function isPeUniformMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  const n = String(merchandiseName).trim().toLowerCase();
  if (n === 'pe uniform' || n === 'lca pe uniform') return true;
  return n.includes('pe') && n.includes('uniform');
}

export function isSchoolUniformMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  const n = String(merchandiseName).trim().toLowerCase();
  if (n === 'school uniform' || n === 'lca uniform') return true;
  if (
    isPeUniformMerchandiseName(n) ||
    isTshirtMerchandiseName(n) ||
    isLcaShirtMerchandiseName(n)
  ) {
    return false;
  }
  return n.includes('uniform');
}

export function isTshirtMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  const n = String(merchandiseName).trim().toLowerCase();
  // Do NOT treat plain "Shirt" (LCA_SHIRT) as legacy LCA T-Shirt.
  return (
    n === 'lca t-shirt' ||
    n === 'lca tshirt' ||
    n === 'lca shirt' ||
    n.includes('t-shirt') ||
    n.includes('tshirt')
  );
}

/** RHET LCA_SHIRT category — plain name "Shirt" (not PE Uniform piece type). */
export function isLcaShirtMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  const n = String(merchandiseName).trim().toLowerCase();
  return n === 'shirt' || n === 'lca shirt';
}

/**
 * Gender options for Create Merchandise by category (RHET rules).
 * School Uniform: Male / Female only. PE / T-Shirt: may include Unisex.
 */
export function getUniformGenderOptions(merchandiseName) {
  if (isSchoolUniformMerchandiseName(merchandiseName)) {
    return UNIFORM_GENDER_OPTIONS.filter((o) => o.value !== 'Unisex');
  }
  return UNIFORM_GENDER_OPTIONS;
}

/**
 * Piece dropdown options for the given merchandise name (+ optional gender).
 */
export function getUniformPieceOptions(merchandiseName, gender = null) {
  if (isLcaShirtMerchandiseName(merchandiseName)) {
    return UNIFORM_LCA_SHIRT_PIECE_OPTIONS;
  }
  if (isTshirtMerchandiseName(merchandiseName)) {
    return UNIFORM_TSHIRT_PIECE_OPTIONS;
  }
  if (isPeUniformMerchandiseName(merchandiseName)) {
    return UNIFORM_PE_PIECE_OPTIONS;
  }
  const g = normalizeMerchandiseGender(gender);
  if (g === 'Male') return UNIFORM_SCHOOL_MALE_PIECE_OPTIONS;
  if (g === 'Female') return UNIFORM_SCHOOL_FEMALE_PIECE_OPTIONS;
  // No gender yet — show all school pieces so the dropdown is usable
  return UNIFORM_SCHOOL_PIECE_OPTIONS;
}

/** Human labels for upper/lower badges (Polo/Short or Shirt/Pants). */
export function getUniformPieceLabels(merchandiseName, gender = null) {
  const opts = getUniformPieceOptions(merchandiseName, gender);
  if (opts.length >= 2) {
    return { upper: opts[0]?.label || 'Upper', lower: opts[1]?.label || 'Lower' };
  }
  return { upper: opts[0]?.label || 'Upper', lower: 'Lower' };
}

export function isUpperUniformPiece(type) {
  const t = String(type || '')
    .trim()
    .toLowerCase();
  if (!t) return false;
  return (
    t === 'top' ||
    t === 'polo' ||
    t === 'shirt' ||
    t.includes('blouse') ||
    t.startsWith('logo')
  );
}

export function isLowerUniformPiece(type) {
  const t = String(type || '')
    .trim()
    .toLowerCase();
  if (!t) return false;
  return (
    t === 'bottom' ||
    t === 'short' ||
    t === 'shorts' ||
    t === 'pants' ||
    t.includes('skirt')
  );
}

export function isUniformTopBottomType(merchandiseName) {
  if (!merchandiseName) return false;
  const name = String(merchandiseName).trim();
  if (UNIFORM_TOP_BOTTOM_TYPE_NAMES.includes(name)) return true;
  return isSchoolUniformMerchandiseName(name) || isPeUniformMerchandiseName(name);
}

/**
 * True when this merchandise name should use size + gender + piece fields.
 * Includes canonical names, legacy names, LCA T-Shirt, and any name containing "uniform".
 */
export function isUniformMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  if (isLearningKitMerchandiseName(merchandiseName)) return false;
  if (isLcaShirtMerchandiseName(merchandiseName)) return true;
  if (isTshirtMerchandiseName(merchandiseName)) return true;
  if (isUniformTopBottomType(merchandiseName)) return true;
  return String(merchandiseName).toLowerCase().includes('uniform');
}

/** Alias: uniforms require Size, Gender, and Piece (type) on the Merchandise form. */
export function requiresUniformPieceFields(merchandiseName) {
  return isUniformMerchandiseName(merchandiseName);
}

/** Display label for a size option (canonical or legacy). */
export function formatUniformSizeDisplayLabel(size) {
  const key = String(size || '').trim();
  return UNIFORM_SIZE_DISPLAY_LABELS[key] || key;
}

/**
 * Count upper vs lower stock rows for a merchandise type (stock list badge).
 * `top`/`bottom` keys kept for backward compatibility (= upper/lower).
 * @param {object[]} stocks
 * @returns {{ top: number, bottom: number, upper: number, lower: number, unspecified: number }}
 */
export function countUniformPiecesByType(stocks) {
  const result = { top: 0, bottom: 0, upper: 0, lower: 0, unspecified: 0 };
  if (!Array.isArray(stocks)) return result;
  for (const item of stocks) {
    if (isUpperUniformPiece(item?.type)) {
      result.top += 1;
      result.upper += 1;
    } else if (isLowerUniformPiece(item?.type)) {
      result.bottom += 1;
      result.lower += 1;
    } else {
      const hasPiece = Boolean(String(item?.type || '').trim());
      const qty =
        item?.quantity == null || item?.quantity === ''
          ? 0
          : parseInt(item.quantity, 10) || 0;
      // Ignore empty legacy shells (qty 0, no gender/type) — they are not "Unspecified" stock
      if (!hasPiece && qty <= 0) continue;
      result.unspecified += 1;
    }
  }
  return result;
}

/**
 * Resolve Top and Bottom stock rows that share the same size (enroll same-size helper).
 * Uses findUniformStockByNameSizeCategory with optional student gender preference.
 *
 * @param {object[]} merchandiseList
 * @param {string} merchandiseName
 * @param {string} size
 * @param {(item: object) => string} getCategory
 * @param {string|null} [preferredGender]
 * @returns {{ top: object|null, bottom: object|null }}
 */
export function findMatchingTopBottomBySize(
  merchandiseList,
  merchandiseName,
  size,
  getCategory,
  preferredGender = null
) {
  return {
    top: findUniformStockByNameSizeCategory(
      merchandiseList,
      merchandiseName,
      size,
      'Top',
      getCategory,
      preferredGender
    ),
    bottom: findUniformStockByNameSizeCategory(
      merchandiseList,
      merchandiseName,
      size,
      'Bottom',
      getCategory,
      preferredGender
    ),
  };
}

/**
 * Sizes that exist for both Top and Bottom (after student gender filter).
 * Used by “Use same size for Top & Bottom” enroll control.
 *
 * @param {object[]} itemsForType
 * @param {string|null|undefined} studentGender
 * @param {(item: object) => string} getCategory
 * @returns {string[]}
 */
export function getSharedUniformSizesForTopBottom(itemsForType, studentGender, getCategory) {
  return getUniformSizePairAvailability(itemsForType, studentGender, getCategory)
    .filter((row) => row.canPair)
    .map((row) => row.size);
}

/**
 * Per-size Top/Bottom availability for enroll same-size UX.
 * Sizes present on only one piece are listed so staff see stock that exists
 * but cannot be applied as a pair until the other piece is stocked.
 *
 * @param {object[]} itemsForType
 * @param {string|null|undefined} studentGender
 * @param {(item: object) => string} getCategory
 * @returns {{ size: string, hasTop: boolean, hasBottom: boolean, canPair: boolean, topItem: object|null, bottomItem: object|null, gender: string|null }[]}
 */
export function getUniformSizePairAvailability(itemsForType, studentGender, getCategory) {
  if (!Array.isArray(itemsForType) || typeof getCategory !== 'function') return [];
  const tops = filterMerchandiseByStudentGender(
    itemsForType.filter((item) => getCategory(item) === 'Top'),
    studentGender
  );
  const bottoms = filterMerchandiseByStudentGender(
    itemsForType.filter((item) => getCategory(item) === 'Bottom'),
    studentGender
  );
  const topSizes = new Set(tops.map((item) => item.size).filter(Boolean));
  const bottomSizes = new Set(bottoms.map((item) => item.size).filter(Boolean));
  const allSizes = Array.from(new Set([...topSizes, ...bottomSizes])).sort((a, b) => {
    const order = UNIFORM_SIZE_OPTIONS;
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return String(a).localeCompare(String(b));
  });
  return allSizes.map((size) => {
    const topItem = tops.find((item) => item.size === size) || null;
    const bottomItem = bottoms.find((item) => item.size === size) || null;
    const hasTop = Boolean(topItem);
    const hasBottom = Boolean(bottomItem);
    return {
      size,
      hasTop,
      hasBottom,
      canPair: hasTop && hasBottom,
      topItem,
      bottomItem,
      gender: topItem?.gender || bottomItem?.gender || null,
    };
  });
}

/**
 * Student gender (Male/Female) → merchandise genders that may be shown.
 * Includes RHET-canonical Male/Female and legacy Men/Women/Boys/Girls.
 * Always includes Unisex. Returns null when student gender is unknown (show all stock).
 * @param {string|null|undefined} studentGender
 * @returns {string[]|null}
 */
export function merchandiseGendersForStudent(studentGender) {
  const g = String(studentGender || '')
    .trim()
    .toLowerCase();
  if (g === 'male' || g === 'men' || g === 'man' || g === 'boy' || g === 'boys') {
    return ['Male', 'Men', 'Boys', 'Unisex'];
  }
  if (g === 'female' || g === 'women' || g === 'woman' || g === 'girl' || g === 'girls') {
    return ['Female', 'Women', 'Girls', 'Unisex'];
  }
  return null;
}

/**
 * Display label for merchandise gender on size options (RHET-aligned).
 * @param {string|null|undefined} gender
 * @returns {string}
 */
export function formatMerchandiseGenderLabel(gender) {
  const canonical = normalizeMerchandiseGender(gender);
  if (!canonical) return 'Unisex';
  return canonical;
}

/**
 * True when stock row gender is allowed for the student.
 * Null/empty merchandise gender is treated as Unisex (legacy rows).
 * @param {string|null|undefined} itemGender
 * @param {string|null|undefined} studentGender
 */
export function isMerchandiseGenderMatchForStudent(itemGender, studentGender) {
  const allowed = merchandiseGendersForStudent(studentGender);
  if (!allowed) return true;
  const raw = String(itemGender || '').trim();
  if (!raw) return true;
  const itemCanon = normalizeMerchandiseGender(raw) || raw;
  if (String(itemCanon).toLowerCase() === 'unisex') return true;
  return allowed.some((a) => {
    const aCanon = normalizeMerchandiseGender(a) || a;
    return String(aCanon).toLowerCase() === String(itemCanon).toLowerCase();
  });
}

/**
 * @param {object[]} items
 * @param {string|null|undefined} studentGender
 * @returns {object[]}
 */
export function filterMerchandiseByStudentGender(items, studentGender) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => isMerchandiseGenderMatchForStudent(item?.gender, studentGender));
}

/**
 * Size dropdown label: "Medium · Men (12)"
 * @param {object} item
 * @param {number|null|undefined} availableQty
 */
export function formatUniformSizeOptionLabel(item, availableQty = null) {
  const size = item?.size || 'Size';
  const genderLabel = formatMerchandiseGenderLabel(item?.gender);
  if (availableQty == null || Number.isNaN(Number(availableQty))) {
    return `${size} · ${genderLabel}`;
  }
  return `${size} · ${genderLabel} (${Number(availableQty)})`;
}

/**
 * Same-size Top+Bottom dropdown label — mirrors separate size options with gender + stocks.
 * e.g. "Medium · Men (Top 995 / Bottom 978)" or incomplete messages when !canPair.
 *
 * @param {{ size?: string, canPair?: boolean, hasTop?: boolean, hasBottom?: boolean, gender?: string|null, topItem?: object|null, bottomItem?: object|null }} row
 * @param {number|null|undefined} topAvailableQty
 * @param {number|null|undefined} bottomAvailableQty
 */
export function formatUniformSameSizePairOptionLabel(
  row,
  topAvailableQty = null,
  bottomAvailableQty = null
) {
  const size = row?.size || 'Size';
  if (!row?.canPair) {
    if (row?.hasTop && !row?.hasBottom) return `${size} (Top only — no Bottom stock)`;
    if (!row?.hasTop && row?.hasBottom) return `${size} (Bottom only — no Top stock)`;
    return `${size} (incomplete)`;
  }
  const genderLabel = formatMerchandiseGenderLabel(
    row.gender ?? row.topItem?.gender ?? row.bottomItem?.gender
  );
  const topOk = topAvailableQty != null && !Number.isNaN(Number(topAvailableQty));
  const botOk = bottomAvailableQty != null && !Number.isNaN(Number(bottomAvailableQty));
  if (topOk && botOk) {
    return `${size} · ${genderLabel} (Top ${Number(topAvailableQty)} / Bottom ${Number(bottomAvailableQty)})`;
  }
  if (topOk) return `${size} · ${genderLabel} (${Number(topAvailableQty)})`;
  if (botOk) return `${size} · ${genderLabel} (${Number(bottomAvailableQty)})`;
  return `${size} · ${genderLabel}`;
}

/**
 * Resolve the correct stock row for a sized uniform (Top vs Bottom).
 * Prefer gender match (+ Unisex) when preferredGender (student gender) is provided.
 *
 * @param {Array} merchandiseList — branch merchandise catalog
 * @param {string} merchandiseName
 * @param {string} size
 * @param {string|null} category — 'Top' | 'Bottom' | null
 * @param {(item: object) => string} getCategory — e.g. component getUniformCategory
 * @param {string|null} [preferredGender] — student gender (Male/Female)
 */
export function findUniformStockByNameSizeCategory(
  merchandiseList,
  merchandiseName,
  size,
  category,
  getCategory,
  preferredGender = null
) {
  if (!merchandiseName || !size || !Array.isArray(merchandiseList)) return null;

  let candidates;
  if (isUniformTopBottomType(merchandiseName) && category && category !== 'General') {
    candidates = merchandiseList.filter(
      (item) =>
        item.merchandise_name === merchandiseName &&
        item.size === size &&
        getCategory(item) === category
    );
  } else {
    candidates = merchandiseList.filter(
      (item) => item.merchandise_name === merchandiseName && item.size === size
    );
  }

  if (candidates.length === 0) return null;

  if (preferredGender) {
    const gendered = filterMerchandiseByStudentGender(candidates, preferredGender);
    if (gendered.length > 0) {
      // Prefer exact Men/Women/Boys/Girls over Unisex when both exist
      const exact = gendered.find((item) => {
        const g = String(item.gender || '')
          .trim()
          .toLowerCase();
        return g && g !== 'unisex';
      });
      return exact || gendered[0];
    }
  }

  return candidates[0];
}
