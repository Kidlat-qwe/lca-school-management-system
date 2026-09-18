/**
 * Break a uniform Set to fulfill an OOS Top or Bottom pending line.
 *
 * Rules:
 * - Same merchandise_name + size + compatible gender (Male/Female / Unisex).
 * - Deduct 1 Set.
 * - If the sibling piece (Top↔Bottom) is also still pending for the same student:
 *   mark both issued (no leftover returned).
 * - Else: return +1 to the leftover piece SKU stock (e.g. issue Top → +1 Bottom).
 * - Only used from Pending issue (manual), not first-payment auto-issue.
 */

import {
  PACKAGE_UNIFORM_TYPE_NAMES,
  MERCH_RELEASE_SOURCE,
  effectiveMerchandiseQuantity,
  isCmsMerchandiseTypeShellRow,
  insertMerchandiseReleaseLog,
  packageMerchLineKey,
} from '../merchandiseReleaseLog.js';

const SET_TYPE_ALIASES = ['set', 'complete set'];
const TOP_TYPE_ALIASES = ['top', 'polo', 'shirt', 'blouse', 'logo 1', 'logo 2'];
const BOTTOM_TYPE_ALIASES = ['bottom', 'short', 'pants', 'shorts', 'skirt'];

export function normalizeUniformGender(value) {
  const s = String(value || '')
    .trim()
    .toLowerCase();
  if (!s) return '';
  if (['male', 'men', 'man', 'boys', 'boy'].includes(s)) return 'male';
  if (['female', 'women', 'woman', 'girls', 'girl'].includes(s)) return 'female';
  if (s === 'unisex') return 'unisex';
  return s;
}

export function gendersCompatible(a, b) {
  const ga = normalizeUniformGender(a);
  const gb = normalizeUniformGender(b);
  if (!ga || !gb) return true;
  if (ga === 'unisex' || gb === 'unisex') return true;
  return ga === gb;
}

function pieceTypeAliases(category) {
  const cat = String(category || '').trim();
  if (cat === 'Top') return TOP_TYPE_ALIASES;
  if (cat === 'Bottom') return BOTTOM_TYPE_ALIASES;
  if (cat === 'Set') return SET_TYPE_ALIASES;
  return null;
}

function leftoverCategory(category) {
  if (category === 'Top') return 'Bottom';
  if (category === 'Bottom') return 'Top';
  return null;
}

function stockQty(row) {
  return effectiveMerchandiseQuantity(row);
}

function isUniformPieceLine(line) {
  const name = String(line?.merchandise_name || line?.original_type_name || '').trim();
  const cat = String(line?.category || '').trim();
  return (
    PACKAGE_UNIFORM_TYPE_NAMES.includes(name) &&
    (cat === 'Top' || cat === 'Bottom') &&
    Boolean(String(line?.size || '').trim())
  );
}

/**
 * Find a Set SKU in preloaded branch stock that can break for this piece line.
 * @param {object} line
 * @param {object|null} pieceStock — concrete Top/Bottom row (for gender)
 * @param {Map<number, object[]>} stockByBranch
 * @param {number} branchId
 */
export function findSetStockForPieceLine(line, pieceStock, stockByBranch, branchId) {
  if (!isUniformPieceLine(line) || !branchId) return null;
  const name = String(line.merchandise_name || line.original_type_name || '')
    .trim()
    .toLowerCase();
  const size = String(line.size || '')
    .trim()
    .toLowerCase();
  const preferredGender = pieceStock?.gender || null;
  const candidates = stockByBranch.get(Number(branchId)) || [];

  let best = null;
  let bestQty = -1;
  for (const row of candidates) {
    if (isCmsMerchandiseTypeShellRow(row)) continue;
    if (String(row.merchandise_name || '').trim().toLowerCase() !== name) continue;
    if (String(row.size || '').trim().toLowerCase() !== size) continue;
    const rowType = String(row.type || '')
      .trim()
      .toLowerCase();
    if (!SET_TYPE_ALIASES.includes(rowType)) continue;
    if (!gendersCompatible(preferredGender, row.gender)) continue;
    const qty = stockQty(row);
    if (qty <= 0) continue;
    if (qty > bestQty) {
      bestQty = qty;
      best = row;
    }
  }
  return best;
}

/**
 * Find leftover piece SKU (opposite Top/Bottom) to receive +1 after Set break.
 */
export function findLeftoverPieceStock(line, pieceStock, stockByBranch, branchId) {
  const leftoverCat = leftoverCategory(line?.category);
  if (!leftoverCat || !branchId) return null;
  const name = String(line.merchandise_name || line.original_type_name || '')
    .trim()
    .toLowerCase();
  const size = String(line.size || '')
    .trim()
    .toLowerCase();
  const preferredGender = pieceStock?.gender || null;
  const aliases = pieceTypeAliases(leftoverCat);
  const candidates = stockByBranch.get(Number(branchId)) || [];

  let best = null;
  let bestQty = -1;
  for (const row of candidates) {
    if (isCmsMerchandiseTypeShellRow(row)) continue;
    if (String(row.merchandise_name || '').trim().toLowerCase() !== name) continue;
    if (String(row.size || '').trim().toLowerCase() !== size) continue;
    const rowType = String(row.type || '')
      .trim()
      .toLowerCase();
    if (!aliases.includes(rowType)) continue;
    if (!gendersCompatible(preferredGender, row.gender)) continue;
    const qty = stockQty(row);
    // Prefer any matching piece row (even at 0) — we will add stock to it.
    if (qty > bestQty) {
      bestQty = qty;
      best = row;
    } else if (qty === bestQty && best && Number(row.merchandise_id) < Number(best.merchandise_id)) {
      best = row;
    } else if (!best) {
      best = row;
    }
  }
  return best;
}

/**
 * Sibling Top/Bottom still pending for same uniform name + size.
 */
export function findSiblingPendingLine(line, remainingLines) {
  const leftoverCat = leftoverCategory(line?.category);
  if (!leftoverCat || !remainingLines?.length) return null;
  const name = String(line.merchandise_name || line.original_type_name || '')
    .trim()
    .toLowerCase();
  const size = String(line.size || '')
    .trim()
    .toLowerCase();
  const selfKey = packageMerchLineKey(line);

  for (const other of remainingLines) {
    if (packageMerchLineKey(other) === selfKey) continue;
    const action = String(other.action || 'issue').trim().toLowerCase() || 'issue';
    if (action === 'waive') continue;
    if (String(other.category || '').trim() !== leftoverCat) continue;
    const otherName = String(other.merchandise_name || other.original_type_name || '')
      .trim()
      .toLowerCase();
    const otherSize = String(other.size || '')
      .trim()
      .toLowerCase();
    if (otherName === name && otherSize === size) return other;
  }
  return null;
}

/**
 * Build staff-facing confirm copy for Pending issue modal.
 */
export function buildSetBreakDescription({
  line,
  setStock,
  leftoverStock = null,
  siblingLine = null,
  studentName = null,
}) {
  const pieceLabel = [line.merchandise_name, line.size, line.category].filter(Boolean).join(' · ');
  const setLabel = [
    setStock?.merchandise_name || line.merchandise_name,
    setStock?.size || line.size,
    setStock?.gender || null,
    'Set',
  ]
    .filter(Boolean)
    .join(' · ');
  const setQty = stockQty(setStock);
  const who = studentName ? ` to ${studentName}` : '';

  if (siblingLine) {
    return (
      `${pieceLabel} is out of stock, but a matching Set is available (${setQty} in stock).\n\n` +
      `Issue Top and Bottom together from 1× ${setLabel}${who}?\n\n` +
      `This will:\n` +
      `• Deduct 1 Set from stock\n` +
      `• Mark both Top and Bottom as issued\n` +
      `• Not return a leftover piece (both halves are used)`
    );
  }

  const leftoverCat = leftoverCategory(line.category);
  const leftoverLabel = leftoverStock
    ? [
        leftoverStock.merchandise_name,
        leftoverStock.size,
        leftoverStock.type || leftoverCat,
        leftoverStock.gender,
      ]
        .filter(Boolean)
        .join(' · ')
    : `${line.merchandise_name} ${line.size} ${leftoverCat}`;

  return (
    `${pieceLabel} is out of stock, but a matching Set is available (${setQty} in stock).\n\n` +
    `Issue from Set${who}?\n\n` +
    `This will:\n` +
    `• Deduct 1 Set from stock\n` +
    `• Mark ${line.category} as issued\n` +
    `• Add 1 to ${leftoverLabel} (leftover ${leftoverCat} from the Set)`
  );
}

/**
 * Sync preview for listPendingPackageMerch rows.
 */
export function previewSetBreakForPendingLine({
  line,
  pieceStock,
  stockByBranch,
  branchId,
  remainingLines,
  studentName = null,
}) {
  if (!isUniformPieceLine(line)) return null;
  if (stockQty(pieceStock) > 0) return null;

  const setStock = findSetStockForPieceLine(line, pieceStock, stockByBranch, branchId);
  if (!setStock) return null;

  const siblingLine = findSiblingPendingLine(line, remainingLines);
  const leftoverStock = siblingLine
    ? null
    : findLeftoverPieceStock(line, pieceStock, stockByBranch, branchId);

  if (!siblingLine && !leftoverStock) {
    return {
      available: false,
      reason:
        'Matching Set found, but no leftover Top/Bottom SKU exists to receive the unused half',
      set_merchandise_id: Number(setStock.merchandise_id),
      set_quantity: stockQty(setStock),
    };
  }

  return {
    available: true,
    set_merchandise_id: Number(setStock.merchandise_id),
    set_quantity: stockQty(setStock),
    set_gender: setStock.gender || null,
    leftover_category: leftoverCategory(line.category),
    leftover_merchandise_id: leftoverStock ? Number(leftoverStock.merchandise_id) : null,
    covers_sibling: Boolean(siblingLine),
    sibling_line_key: siblingLine ? packageMerchLineKey(siblingLine) : null,
    description: buildSetBreakDescription({
      line,
      setStock,
      leftoverStock,
      siblingLine,
      studentName,
    }),
  };
}

/**
 * Execute Set break issue for one (or Top+Bottom sibling) pending line(s).
 * @returns {Promise<{ ok: boolean, reason?: string, issuedLineKeys?: string[], quantity?: number }>}
 */
export async function tryIssueUniformFromSetBreak(client, params) {
  const {
    line,
    remainingLines,
    branchId,
    studentId,
    classId,
    packageId,
    paymentId = null,
    createdBy = null,
    releasedAt = null,
    releaseBatchId,
  } = params;

  if (!isUniformPieceLine(line)) {
    return { ok: false, reason: 'not_uniform_piece' };
  }

  const qty = Math.max(1, parseInt(String(line.quantity ?? 1), 10) || 1);
  if (qty !== 1) {
    return { ok: false, reason: 'set_break_qty_must_be_1' };
  }

  const pieceId = Number(line.merchandise_id);
  let pieceRow = null;
  if (Number.isFinite(pieceId) && pieceId > 0) {
    const pieceRes = await client.query(
      `SELECT merchandise_id, merchandise_name, size, type, gender, quantity, branch_id
       FROM merchandisestbl
       WHERE merchandise_id = $1`,
      [pieceId]
    );
    pieceRow = pieceRes.rows[0] || null;
  }

  const name = String(line.merchandise_name || line.original_type_name || '').trim();
  const size = String(line.size || '').trim();
  const preferredGender = pieceRow?.gender || null;

  const setRes = await client.query(
    `SELECT merchandise_id, merchandise_name, size, type, gender, quantity, branch_id
     FROM merchandisestbl
     WHERE merchandise_name = $1
       AND branch_id = $2
       AND size = $3
       AND LOWER(COALESCE(type, '')) = ANY($4::text[])
     ORDER BY quantity DESC NULLS LAST, merchandise_id ASC
     FOR UPDATE`,
    [name, branchId, size, SET_TYPE_ALIASES]
  );

  const setRow = (setRes.rows || []).find(
    (row) =>
      !isCmsMerchandiseTypeShellRow(row) &&
      gendersCompatible(preferredGender, row.gender) &&
      effectiveMerchandiseQuantity(row) >= 1
  );
  if (!setRow) {
    return { ok: false, reason: 'no_set_stock' };
  }

  const siblingLine = findSiblingPendingLine(line, remainingLines);
  const leftoverCat = leftoverCategory(line.category);

  let leftoverRow = null;
  if (!siblingLine) {
    const leftoverAliases = pieceTypeAliases(leftoverCat);
    const leftoverRes = await client.query(
      `SELECT merchandise_id, merchandise_name, size, type, gender, quantity, branch_id
       FROM merchandisestbl
       WHERE merchandise_name = $1
         AND branch_id = $2
         AND size = $3
         AND LOWER(COALESCE(type, '')) = ANY($4::text[])
       ORDER BY quantity DESC NULLS LAST, merchandise_id ASC
       FOR UPDATE`,
      [name, branchId, size, leftoverAliases]
    );
    leftoverRow = (leftoverRes.rows || []).find(
      (row) =>
        !isCmsMerchandiseTypeShellRow(row) && gendersCompatible(preferredGender, row.gender)
    );
    if (!leftoverRow) {
      return { ok: false, reason: 'no_leftover_piece_sku' };
    }
  }

  const setQty = effectiveMerchandiseQuantity(setRow);
  await client.query(`UPDATE merchandisestbl SET quantity = $1 WHERE merchandise_id = $2`, [
    Math.max(0, setQty - 1),
    setRow.merchandise_id,
  ]);

  const issuedLines = siblingLine ? [line, siblingLine] : [line];
  const issuedLineKeys = [];

  for (const issued of issuedLines) {
    const mid = Number(issued.merchandise_id);
    if (!Number.isFinite(mid) || mid <= 0) {
      return { ok: false, reason: 'missing_piece_merchandise_id' };
    }
    const remarks = siblingLine
      ? `Issued from Set #${setRow.merchandise_id} (Top+Bottom pair).`
      : `Issued from Set #${setRow.merchandise_id}. Leftover ${leftoverCat} +1 to #${leftoverRow.merchandise_id}.`;

    await insertMerchandiseReleaseLog(client, {
      releaseBatchId,
      source: MERCH_RELEASE_SOURCE.PACKAGE_ENROLL,
      merchandiseId: mid,
      quantity: 1,
      branchId,
      merchandiseName: issued.merchandise_name || name,
      size: issued.size || size,
      category: issued.category || null,
      studentId,
      classId,
      packageId,
      paymentId: paymentId != null ? Number(paymentId) : null,
      createdBy,
      releasedAt,
      remarks,
    });
    issuedLineKeys.push(packageMerchLineKey(issued));
  }

  if (leftoverRow) {
    const leftoverQty = effectiveMerchandiseQuantity(leftoverRow);
    await client.query(`UPDATE merchandisestbl SET quantity = $1 WHERE merchandise_id = $2`, [
      leftoverQty + 1,
      leftoverRow.merchandise_id,
    ]);
  }

  return {
    ok: true,
    quantity: issuedLines.length,
    issuedLineKeys,
    set_merchandise_id: Number(setRow.merchandise_id),
    leftover_merchandise_id: leftoverRow ? Number(leftoverRow.merchandise_id) : null,
  };
}
