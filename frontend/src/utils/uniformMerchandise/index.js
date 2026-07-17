/**
 * Uniform types that use separate upper/lower stock rows (type column on merchandisestbl).
 * Keep in sync with backend PACKAGE_UNIFORM_TYPE_NAMES in merchandiseReleaseLog.js.
 *
 * Piece labels by merchandise:
 * - School uniform (LCA Uniform, etc.): Polo + Short
 * - PE uniform (LCA PE Uniform, etc.): Shirt + Pants
 *
 * Enrollment/package matching still uses Top/Bottom roles via getUniformCategory
 * (Polo/Shirt → Top, Short/Pants → Bottom).
 *
 * Same-size “full set” = two rows / two selections with the same size.
 */
export const UNIFORM_SCHOOL_NAME = 'LCA Uniform';
export const UNIFORM_PE_NAME = 'LCA PE Uniform';
export const UNIFORM_TOP_BOTTOM_TYPE_NAMES = [UNIFORM_SCHOOL_NAME, UNIFORM_PE_NAME];

/** Uniform size dropdown options (Add Stock / merchandise forms). */
export const UNIFORM_SIZE_OPTIONS = [
  'Extra Small',
  'Small',
  'Medium',
  'Large',
  'Extra Large',
  '2XL',
  '3XL',
  '4XL',
];

/** School uniform piece options (stored in merchandisestbl.type). */
export const UNIFORM_SCHOOL_PIECE_OPTIONS = [
  { value: 'Polo', label: 'Polo' },
  { value: 'Short', label: 'Short' },
];

/** PE uniform piece options (stored in merchandisestbl.type). */
export const UNIFORM_PE_PIECE_OPTIONS = [
  { value: 'Shirt', label: 'Shirt' },
  { value: 'Pants', label: 'Pants' },
];

/**
 * All known piece values (new + legacy Top/Bottom) for filters.
 * Prefer getUniformPieceOptions(merchandiseName) in forms.
 */
export const UNIFORM_PIECE_OPTIONS = [
  ...UNIFORM_SCHOOL_PIECE_OPTIONS,
  ...UNIFORM_PE_PIECE_OPTIONS,
  { value: 'Top', label: 'Top' },
  { value: 'Bottom', label: 'Bottom' },
];

export function isPeUniformMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  return String(merchandiseName).toLowerCase().includes('pe');
}

/** Piece dropdown options for the given merchandise name. */
export function getUniformPieceOptions(merchandiseName) {
  if (isPeUniformMerchandiseName(merchandiseName)) {
    return UNIFORM_PE_PIECE_OPTIONS;
  }
  return UNIFORM_SCHOOL_PIECE_OPTIONS;
}

/** Human labels for upper/lower badges (Polo/Short or Shirt/Pants). */
export function getUniformPieceLabels(merchandiseName) {
  const opts = getUniformPieceOptions(merchandiseName);
  return {
    upper: opts[0]?.label || 'Upper',
    lower: opts[1]?.label || 'Lower',
  };
}

export function isUpperUniformPiece(type) {
  const t = String(type || '')
    .trim()
    .toLowerCase();
  if (!t) return false;
  return t === 'top' || t === 'polo' || t === 'shirt' || t.includes('blouse');
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
  return UNIFORM_TOP_BOTTOM_TYPE_NAMES.includes(String(merchandiseName).trim());
}

/**
 * True when this merchandise name should use size + gender + piece fields.
 * Includes canonical names and any name containing "uniform".
 */
export function isUniformMerchandiseName(merchandiseName) {
  if (!merchandiseName) return false;
  if (isUniformTopBottomType(merchandiseName)) return true;
  return String(merchandiseName).toLowerCase().includes('uniform');
}

/** Alias: uniforms require Size, Gender, and Piece (type) on the Merchandise form. */
export function requiresUniformPieceFields(merchandiseName) {
  return isUniformMerchandiseName(merchandiseName);
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
 * Always includes Unisex. Returns null when student gender is unknown (show all stock).
 * @param {string|null|undefined} studentGender
 * @returns {string[]|null}
 */
export function merchandiseGendersForStudent(studentGender) {
  const g = String(studentGender || '')
    .trim()
    .toLowerCase();
  if (g === 'male' || g === 'men' || g === 'man' || g === 'boy' || g === 'boys') {
    return ['Men', 'Boys', 'Unisex'];
  }
  if (g === 'female' || g === 'women' || g === 'woman' || g === 'girl' || g === 'girls') {
    return ['Women', 'Girls', 'Unisex'];
  }
  return null;
}

/**
 * Display label for merchandise gender on size options.
 * @param {string|null|undefined} gender
 * @returns {string}
 */
export function formatMerchandiseGenderLabel(gender) {
  const g = String(gender || '').trim();
  if (!g) return 'Unisex';
  const lower = g.toLowerCase();
  if (lower === 'men' || lower === 'male' || lower === 'man') return 'Men';
  if (lower === 'women' || lower === 'female' || lower === 'woman') return 'Women';
  if (lower === 'boys' || lower === 'boy') return 'Boys';
  if (lower === 'girls' || lower === 'girl') return 'Girls';
  if (lower === 'unisex') return 'Unisex';
  return g;
}

/**
 * True when stock row gender is allowed for the student (Unisex + matching Men/Women/Boys/Girls).
 * Null/empty merchandise gender is treated as Unisex (legacy rows).
 * @param {string|null|undefined} itemGender
 * @param {string|null|undefined} studentGender
 */
export function isMerchandiseGenderMatchForStudent(itemGender, studentGender) {
  const allowed = merchandiseGendersForStudent(studentGender);
  if (!allowed) return true;
  const raw = String(itemGender || '').trim();
  if (!raw) return true;
  if (raw.toLowerCase() === 'unisex') return true;
  return allowed.some((a) => a.toLowerCase() === raw.toLowerCase());
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
