/**
 * Merchandise release log — records each stock deduction for operational dashboards.
 *
 * Package enrollment: stock + log happen on first qualifying payment (downpayment or Phase 1),
 * once per (student_id, package_id, class_id). Re-enrollment does not issue again.
 */

export const MERCH_RELEASE_SOURCE = {
  MERCHANDISE_AR: 'merchandise_ar',
  PACKAGE_ENROLL: 'package_enroll',
};

export const MERCH_PENDING_MARKER = 'MERCH_PENDING:';

/** Package uniforms are issued as Top + Bottom; generic placeholder SKUs must not duplicate configured lines. */
export const PACKAGE_UNIFORM_TYPE_NAMES = [
  'School Uniform',
  'PE Uniform',
  'LCA Uniform', // legacy
  'LCA PE Uniform', // legacy
];

let releaseLogTableKnown = false;

/** @param {import('pg').Pool|import('pg').PoolClient|Function} db */
const runQuery = (db, text, params) =>
  typeof db === 'function' ? db(text, params) : db.query(text, params);

export const merchandiseReleaseLogTableExists = async (db) => {
  if (releaseLogTableKnown) return true;
  try {
    const r = await runQuery(
      db,
      `SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'merchandise_release_logtbl'
       LIMIT 1`
    );
    if (r.rows.length > 0) {
      releaseLogTableKnown = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
};

/**
 * @param {import('pg').PoolClient} client
 * @param {{ studentId: number, packageId: number, classId: number }} keys
 */
export async function hasPackageMerchandiseBeenIssued(client, { studentId, packageId, classId }) {
  if (!(await merchandiseReleaseLogTableExists(client))) return false;
  const sid = Number(studentId);
  const pid = Number(packageId);
  const cid = Number(classId);
  if (!sid || !pid || !cid) return false;
  const r = await client.query(
    `SELECT 1
     FROM merchandise_release_logtbl
     WHERE source = $1
       AND student_id = $2
       AND package_id = $3
       AND class_id = $4
     LIMIT 1`,
    [MERCH_RELEASE_SOURCE.PACKAGE_ENROLL, sid, pid, cid]
  );
  return r.rows.length > 0;
}

/**
 * @param {Map<string, { merchandise_id: number, count?: number, size?: string|null, merchandise_name?: string|null, category?: string|null }>} merchandiseToDeduct
 */
const packageMerchLineScore = (line) => {
  let score = 0;
  if (line?.category === 'Top' || line?.category === 'Bottom' || line?.category === 'Set') {
    score += 20;
  }
  if (line?.size) score += 5;
  return score;
};

/**
 * True when configured selections already satisfy a package-included merchandise type.
 * Uniforms need Set, or Top/Bottom pieces; other types match by merchandise_name
 * or waive/swap via original_type_name.
 */
export function isPackageMerchTypeCovered(merchName, merchandiseToDeduct) {
  const name = String(merchName || '').trim();
  if (!name || !merchandiseToDeduct?.size) return false;

  if (PACKAGE_UNIFORM_TYPE_NAMES.includes(name)) {
    let hasTop = false;
    let hasBottom = false;
    let hasSet = false;
    for (const info of merchandiseToDeduct.values()) {
      if (info.merchandise_name !== name) continue;
      if (info.category === 'Set') hasSet = true;
      if (info.category === 'Top') hasTop = true;
      if (info.category === 'Bottom') hasBottom = true;
    }
    return hasSet || hasTop || hasBottom;
  }

  const nameLower = name.toLowerCase();
  for (const info of merchandiseToDeduct.values()) {
    const original = String(info.original_type_name || '').trim().toLowerCase();
    if (original && original === nameLower) return true;
    if (String(info.merchandise_name || '').trim().toLowerCase() === nameLower) {
      return true;
    }
  }
  return false;
}

const MERCHANDISE_RESOLVE_COLUMNS = `merchandise_id, merchandise_name, size, price, quantity, branch_id, type, gender, item_name, sku`;

function isBlankMerchAttr(value) {
  return !String(value ?? '').trim();
}

/** CMS type-shell (category + image only) — not a concrete stock SKU. */
export function isCmsMerchandiseTypeShellRow(row) {
  if (!row) return false;
  const size = String(row.size ?? '').trim();
  const sizeBlank = !size || ['n/a', 'na'].includes(size.toLowerCase());
  const qtyRaw = row.quantity;
  const qty =
    qtyRaw == null || qtyRaw === ''
      ? 0
      : Number.isFinite(Number(qtyRaw))
        ? Number(qtyRaw)
        : 0;
  return (
    isBlankMerchAttr(row.gender) &&
    isBlankMerchAttr(row.type) &&
    sizeBlank &&
    isBlankMerchAttr(row.item_name) &&
    isBlankMerchAttr(row.sku) &&
    qty <= 0
  );
}

/**
 * On-hand units for issuance / pending issue. Null or blank quantity on a concrete
 * SKU is treated as 0 (not unlimited). CMS type shells are always 0.
 */
export function effectiveMerchandiseQuantity(row) {
  if (!row || isCmsMerchandiseTypeShellRow(row)) return 0;
  const raw = row.quantity;
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function merchNamesMatch(a, b) {
  const stripWaived = (value) =>
    String(value || '')
      .trim()
      .replace(/\s*\(waived\)\s*$/i, '')
      .toLowerCase();
  const na = stripWaived(a);
  const nb = stripWaived(b);
  return Boolean(na && nb && na === nb);
}

/**
 * Resolve a branch merchandise row with enough stock for enrollment/validation.
 * Falls back to same name (and size/category when provided) when the configured id is out of stock.
 * `allowZeroStock` returns a concrete SKU even at qty 0 (package backorder / pending issue).
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   merchandiseId?: number|null,
 *   merchandiseName?: string|null,
 *   branchId: number,
 *   quantityNeeded?: number,
 *   size?: string|null,
 *   category?: string|null,
 *   allowZeroStock?: boolean,
 * }} params
 * @returns {Promise<object|null>}
 */
export async function resolveMerchandiseWithAvailableStock(
  client,
  {
    merchandiseId,
    merchandiseName,
    branchId,
    quantityNeeded = 1,
    size = null,
    category = null,
    allowZeroStock = false,
  }
) {
  const needed = Math.max(1, parseInt(String(quantityNeeded), 10) || 1);

  const rowHasStock = (row) => {
    if (!row) return false;
    if (Number(branchId) !== Number(row.branch_id)) return false;
    if (isCmsMerchandiseTypeShellRow(row)) return false;
    return effectiveMerchandiseQuantity(row) >= needed;
  };

  const pickZeroStockRow = (rows, fallback) => {
    if (!allowZeroStock) return null;
    for (const row of rows || []) {
      if (!row || Number(branchId) !== Number(row.branch_id)) continue;
      if (isCmsMerchandiseTypeShellRow(row)) continue;
      return row;
    }
    if (
      fallback &&
      Number(branchId) === Number(fallback.branch_id) &&
      !isCmsMerchandiseTypeShellRow(fallback)
    ) {
      return fallback;
    }
    return null;
  };

  let byIdRow = null;
  if (merchandiseId) {
    const byId = await client.query(
      `SELECT ${MERCHANDISE_RESOLVE_COLUMNS}
       FROM merchandisestbl WHERE merchandise_id = $1`,
      [merchandiseId]
    );
    byIdRow = byId.rows[0] || null;
    if (rowHasStock(byIdRow)) {
      return byIdRow;
    }
  }

  const name = String(merchandiseName || '').trim();
  if (!name || !branchId) {
    return pickZeroStockRow(byIdRow ? [byIdRow] : [], byIdRow);
  }

  const isUniformPiece =
    PACKAGE_UNIFORM_TYPE_NAMES.includes(name) &&
    category &&
    (category === 'Top' || category === 'Bottom' || category === 'Set');

  let candidatesRes;
  if (isUniformPiece && size) {
    const typeAliases =
      category === 'Set'
        ? ['Set', 'Complete Set']
        : category === 'Top'
          ? ['Top', 'Polo', 'Shirt', 'Blouse', 'Logo 1', 'Logo 2']
          : ['Bottom', 'Short', 'Pants', 'Shorts', 'Skirt'];
    candidatesRes = await client.query(
      `SELECT ${MERCHANDISE_RESOLVE_COLUMNS}
       FROM merchandisestbl
       WHERE merchandise_name = $1 AND branch_id = $2 AND size = $3
         AND LOWER(COALESCE(type, '')) = ANY($4::text[])
       ORDER BY quantity DESC NULLS LAST, merchandise_id ASC`,
      [name, branchId, size, typeAliases.map((t) => t.toLowerCase())]
    );
  } else if (size) {
    candidatesRes = await client.query(
      `SELECT ${MERCHANDISE_RESOLVE_COLUMNS}
       FROM merchandisestbl
       WHERE merchandise_name = $1 AND branch_id = $2 AND size = $3
       ORDER BY quantity DESC NULLS LAST, merchandise_id ASC`,
      [name, branchId, size]
    );
  } else {
    candidatesRes = await client.query(
      `SELECT ${MERCHANDISE_RESOLVE_COLUMNS}
       FROM merchandisestbl
       WHERE merchandise_name = $1 AND branch_id = $2
       ORDER BY quantity DESC NULLS LAST, merchandise_id ASC`,
      [name, branchId]
    );
  }

  for (const row of candidatesRes.rows) {
    if (rowHasStock(row)) return row;
  }

  return pickZeroStockRow(candidatesRes.rows, byIdRow);
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ studentId: number, packageId: number, classId: number }} keys
 */
export async function loadIssuedPackageMerchRows(client, { studentId, packageId, classId }) {
  if (!(await merchandiseReleaseLogTableExists(client))) return [];
  const sid = Number(studentId);
  const pid = Number(packageId);
  const cid = Number(classId);
  if (!sid || !pid || !cid) return [];
  const r = await runQuery(
    client,
    `SELECT merchandise_id, merchandise_name, size, category, quantity
     FROM merchandise_release_logtbl
     WHERE source = $1
       AND student_id = $2
       AND package_id = $3
       AND class_id = $4`,
    [MERCH_RELEASE_SOURCE.PACKAGE_ENROLL, sid, pid, cid]
  );
  return r.rows;
}

export function isPackageMerchLineIssued(line, issuedRows) {
  if (!line || !issuedRows?.length) return false;
  const action = String(line.action || 'issue').trim().toLowerCase() || 'issue';
  const lineName = line.original_type_name || line.merchandise_name;
  if (action === 'waive') {
    return issuedRows.some(
      (row) =>
        String(row.category || '') === 'Waived' &&
        merchNamesMatch(lineName, row.merchandise_name)
    );
  }
  const mid = Number(line.merchandise_id);
  const size = String(line.size || '').trim().toLowerCase();
  const cat = String(line.category || '').trim().toLowerCase();
  return issuedRows.some((row) => {
    if (String(row.category || '') === 'Waived') return false;
    if (Number.isFinite(mid) && mid > 0 && Number(row.merchandise_id) === mid) {
      return true;
    }
    const nameOk =
      merchNamesMatch(line.merchandise_name, row.merchandise_name) ||
      merchNamesMatch(line.original_type_name, row.merchandise_name);
    if (!nameOk) return false;
    const rowSize = String(row.size || '').trim().toLowerCase();
    const rowCat = String(row.category || '').trim().toLowerCase();
    const sizeOk = !size || !rowSize || size === rowSize;
    const catOk = !cat || !rowCat || cat === rowCat;
    return sizeOk && catOk;
  });
}

/** Non-waive lines not yet in the release log (physical items still owed). */
export function remainingIssuablePackageMerchLines(lines, issuedRows) {
  return normalizePackageMerchLines(lines).filter((line) => {
    const action = String(line.action || 'issue').trim().toLowerCase() || 'issue';
    if (action === 'waive') return false;
    return !isPackageMerchLineIssued(line, issuedRows);
  });
}

export function packageMerchLineKey(line) {
  const action = String(line?.action || 'issue').trim().toLowerCase() || 'issue';
  const name = String(line?.original_type_name || line?.merchandise_name || '')
    .trim()
    .toLowerCase();
  const cat = String(line?.category || '').trim().toLowerCase();
  const size = String(line?.size || '').trim().toLowerCase();
  const mid = Number(line?.merchandise_id) || '';
  return `${action}|${name}|${cat}|${size}|${mid}`;
}

/**
 * Collapse duplicate package merchandise lines (placeholder SKUs + configured Top/Bottom).
 * @param {Array<{ merchandise_id: number, quantity?: number, size?: string|null, merchandise_name?: string|null, category?: string|null }>} lines
 */
export function normalizePackageMerchLines(lines) {
  if (!lines?.length) return [];

  const byKey = new Map();

  for (const raw of lines) {
    const action = String(raw.action || 'issue').trim().toLowerCase() || 'issue';
    const mid = Number(raw.merchandise_id);
    if (action !== 'waive' && (!Number.isFinite(mid) || mid <= 0)) continue;
    const name = String(raw.merchandise_name || '').trim();
    const originalType = String(raw.original_type_name || '').trim();
    if (!name && !originalType) continue;

    const line = {
      merchandise_id: Number.isFinite(mid) && mid > 0 ? mid : null,
      quantity: Math.max(1, parseInt(String(raw.quantity ?? 1), 10) || 1),
      size: raw.size || null,
      merchandise_name: name || originalType || null,
      category: raw.category || null,
      action,
      original_type_name: originalType || null,
      reason: raw.reason || null,
    };

    const coverageName = originalType || name;
    const isUniform = PACKAGE_UNIFORM_TYPE_NAMES.includes(name);
    let key;
    if (action === 'waive') {
      key = `${coverageName}|waive`;
    } else if (action === 'swap') {
      key = `${coverageName}|swap|${line.merchandise_id}`;
    } else if (
      isUniform &&
      (line.category === 'Top' || line.category === 'Bottom' || line.category === 'Set')
    ) {
      key = `${name}|${line.category}`;
    } else if (isUniform) {
      key = `${name}|placeholder|${line.merchandise_id}|${line.size || ''}`;
    } else {
      key = name;
    }

    const prev = byKey.get(key);
    if (!prev || packageMerchLineScore(line) > packageMerchLineScore(prev)) {
      byKey.set(key, line);
    }
  }

  const hasConfiguredUniform = (name) =>
    byKey.has(`${name}|Set`) ||
    (byKey.has(`${name}|Top`) && byKey.has(`${name}|Bottom`));

  const out = [];
  for (const line of byKey.values()) {
    if (
      PACKAGE_UNIFORM_TYPE_NAMES.includes(line.merchandise_name) &&
      hasConfiguredUniform(line.merchandise_name) &&
      line.category !== 'Top' &&
      line.category !== 'Bottom' &&
      line.category !== 'Set'
    ) {
      continue;
    }
    // Prefer Set over Top/Bottom when both were somehow selected
    if (
      PACKAGE_UNIFORM_TYPE_NAMES.includes(line.merchandise_name) &&
      byKey.has(`${line.merchandise_name}|Set`) &&
      (line.category === 'Top' || line.category === 'Bottom')
    ) {
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Resolve Top/Bottom/Set uniform SKU for package issue (1:1 with configured category + size).
 * Package lines still use category Top/Bottom/Set; stock rows may use Polo/Shirt (upper)
 * or Short/Pants (lower), Set, plus legacy Top/Bottom.
 * @param {import('pg').PoolClient} client
 */
export async function resolvePackageUniformMerchandiseId(
  client,
  { merchandiseName, size, branchId, category }
) {
  const name = String(merchandiseName || '').trim();
  const cat = String(category || '').trim();
  if (!PACKAGE_UNIFORM_TYPE_NAMES.includes(name)) return null;
  if (cat !== 'Top' && cat !== 'Bottom' && cat !== 'Set') return null;
  if (!size || !branchId) return null;

  const typeAliases =
    cat === 'Set'
      ? ['Set', 'Complete Set']
      : cat === 'Top'
        ? ['Top', 'Polo', 'Shirt', 'Blouse', 'Logo 1', 'Logo 2']
        : ['Bottom', 'Short', 'Pants', 'Shorts', 'Skirt'];

  const r = await client.query(
    `SELECT merchandise_id
     FROM merchandisestbl
     WHERE merchandise_name = $1
       AND size = $2
       AND branch_id = $3
       AND LOWER(COALESCE(type, '')) = ANY($4::text[])
     ORDER BY merchandise_id ASC
     LIMIT 1`,
    [name, size, branchId, typeAliases.map((t) => t.toLowerCase())]
  );
  return r.rows[0]?.merchandise_id ?? null;
}

export function linesFromMerchandiseToDeduct(merchandiseToDeduct) {
  if (!merchandiseToDeduct || merchandiseToDeduct.size === 0) return [];
  const lines = [];
  for (const [, info] of merchandiseToDeduct.entries()) {
    const action = String(info.action || 'issue').trim().toLowerCase() || 'issue';
    const mid = Number(info.merchandise_id);
    // Waive may keep the catalog id for audit; still allow mid when waive.
    if (action !== 'waive' && (!Number.isFinite(mid) || mid <= 0)) continue;
    lines.push({
      merchandise_id: Number.isFinite(mid) && mid > 0 ? mid : null,
      quantity: Math.max(1, parseInt(String(info.count ?? 1), 10) || 1),
      size: info.size || null,
      merchandise_name: info.merchandise_name || null,
      category: info.category || null,
      action,
      original_type_name: info.original_type_name || null,
      reason: info.reason || null,
    });
  }
  return normalizePackageMerchLines(lines);
}

export function appendMerchPendingToRemarks(remarks, lines) {
  if (!lines?.length) return remarks || '';
  const payload = JSON.stringify(lines);
  const segment = `${MERCH_PENDING_MARKER}${payload}`;
  const base = remarks || '';
  if (base.includes(MERCH_PENDING_MARKER)) {
    return base.replace(
      new RegExp(`${MERCH_PENDING_MARKER}[^;]*`),
      segment
    );
  }
  return base ? `${base};${segment}` : segment;
}

export function parseMerchPendingFromRemarks(remarks) {
  if (!remarks || !String(remarks).includes(MERCH_PENDING_MARKER)) return [];
  const text = String(remarks);
  const idx = text.indexOf(MERCH_PENDING_MARKER);
  let raw = text.slice(idx + MERCH_PENDING_MARKER.length);
  const semi = raw.indexOf(';');
  if (semi >= 0) raw = raw.slice(0, semi);
  try {
    const parsed = JSON.parse(raw);
    return normalizePackageMerchLines(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{
 *   releaseBatchId: string,
 *   source: string,
 *   merchandiseId: number,
 *   quantity?: number,
 *   branchId: number,
 *   merchandiseName?: string|null,
 *   size?: string|null,
 *   category?: string|null,
 *   studentId?: number|null,
 *   classId?: number|null,
 *   packageId?: number|null,
 *   ackReceiptId?: number|null,
 *   paymentId?: number|null,
 *   createdBy?: number|null,
 *   releasedAt?: string|Date|null,
 * }} entry
 */
export async function insertMerchandiseReleaseLog(client, entry) {
  if (!(await merchandiseReleaseLogTableExists(client))) return;

  const qty = Math.max(1, parseInt(String(entry.quantity ?? 1), 10) || 1);
  const merchId = parseInt(String(entry.merchandiseId), 10);
  const branchId = parseInt(String(entry.branchId), 10);
  if (!Number.isFinite(merchId) || merchId <= 0 || !Number.isFinite(branchId) || branchId <= 0) {
    return;
  }

  const source = entry.source === MERCH_RELEASE_SOURCE.PACKAGE_ENROLL
    ? MERCH_RELEASE_SOURCE.PACKAGE_ENROLL
    : MERCH_RELEASE_SOURCE.MERCHANDISE_AR;

  const releasedAt = entry.releasedAt
    ? entry.releasedAt instanceof Date
      ? entry.releasedAt
      : new Date(String(entry.releasedAt))
    : null;

  await client.query(
    `INSERT INTO merchandise_release_logtbl (
       release_batch_id,
       source,
       merchandise_id,
       quantity,
       branch_id,
       merchandise_name,
       size,
       category,
       student_id,
       class_id,
       package_id,
       ack_receipt_id,
       payment_id,
       created_by,
       released_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15::timestamptz, CURRENT_TIMESTAMP))`,
    [
      String(entry.releaseBatchId || '').slice(0, 80),
      source,
      merchId,
      qty,
      branchId,
      entry.merchandiseName || null,
      entry.size || null,
      entry.category || null,
      entry.studentId != null ? Number(entry.studentId) : null,
      entry.classId != null ? Number(entry.classId) : null,
      entry.packageId != null ? Number(entry.packageId) : null,
      entry.ackReceiptId != null ? Number(entry.ackReceiptId) : null,
      entry.paymentId != null ? Number(entry.paymentId) : null,
      entry.createdBy != null ? Number(entry.createdBy) : null,
      releasedAt,
    ]
  );
}

export function buildMerchandiseArReleaseBatchId(ackReceiptId) {
  return `ar-${ackReceiptId}`;
}

export function buildPackageEnrollReleaseBatchId(classId, studentId) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `enroll-${classId}-${studentId}-${suffix}`.slice(0, 80);
}

export function buildPackagePaymentReleaseBatchId(paymentId) {
  return `pkg-pay-${paymentId}`.slice(0, 80);
}

function manilaNoonFromIssueDate(issueDateYmd) {
  const ymd = String(issueDateYmd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return new Date();
  return new Date(`${ymd}T12:00:00+08:00`);
}

/**
 * Deduct stock and write release log for package included merchandise.
 * Issues in-stock lines only; out-of-stock lines are skipped (backorder) so payment can complete.
 * Already-logged lines are skipped (per-line idempotency).
 *
 * @returns {Promise<{ issued: boolean, reason?: string, quantity?: number, pending_count?: number }>}
 */
export async function issuePackageMerchandiseLines(client, params) {
  const {
    studentId,
    classId,
    packageId,
    branchId,
    lines,
    paymentId = null,
    paymentIssueDate = null,
    createdBy = null,
  } = params;

  const sid = Number(studentId);
  const cid = Number(classId);
  const pid = Number(packageId);
  const bid = Number(branchId);
  if (!sid || !cid || !pid || !bid || !lines?.length) {
    return { issued: false, reason: 'missing_context' };
  }

  const normalizedLines = normalizePackageMerchLines(lines);
  if (!normalizedLines.length) {
    return { issued: false, reason: 'no_lines' };
  }

  const issuedRows = await loadIssuedPackageMerchRows(client, {
    studentId: sid,
    packageId: pid,
    classId: cid,
  });
  const remaining = remainingIssuablePackageMerchLines(normalizedLines, issuedRows);
  const waiveOnly = normalizedLines.filter(
    (line) => String(line.action || '').toLowerCase() === 'waive'
  );

  if (!remaining.length && !(waiveOnly.length > 0 && issuedRows.length === 0)) {
    return {
      issued: false,
      reason: issuedRows.length > 0 ? 'already_issued' : 'no_lines',
      pending_count: 0,
    };
  }

  const releaseBatchId = paymentId
    ? buildPackagePaymentReleaseBatchId(paymentId)
    : buildPackageEnrollReleaseBatchId(cid, sid);
  const releasedAt = manilaNoonFromIssueDate(paymentIssueDate);
  let totalQty = 0;
  let pendingCount = 0;

  for (const line of remaining) {
    const action = String(line.action || 'issue').trim().toLowerCase() || 'issue';
    if (action === 'waive') continue;

    let merchId = Number(line.merchandise_id);
    const qty = Math.max(1, parseInt(String(line.quantity ?? 1), 10) || 1);
    const uniformName = String(line.merchandise_name || '').trim();
    if (
      PACKAGE_UNIFORM_TYPE_NAMES.includes(uniformName) &&
      (line.category === 'Top' || line.category === 'Bottom' || line.category === 'Set') &&
      line.size
    ) {
      const resolvedId = await resolvePackageUniformMerchandiseId(client, {
        merchandiseName: uniformName,
        size: line.size,
        branchId: bid,
        category: line.category,
      });
      if (resolvedId) merchId = Number(resolvedId);
    }

    const resolved = await resolveMerchandiseWithAvailableStock(client, {
      merchandiseId: Number.isFinite(merchId) && merchId > 0 ? merchId : null,
      merchandiseName: line.merchandise_name || line.original_type_name,
      branchId: bid,
      quantityNeeded: qty,
      size: line.size,
      category: line.category,
      allowZeroStock: false,
    });

    if (!resolved) {
      pendingCount += qty;
      continue;
    }
    merchId = Number(resolved.merchandise_id);

    const stockRes = await client.query(
      `SELECT merchandise_id, merchandise_name, size, type, quantity
       FROM merchandisestbl
       WHERE merchandise_id = $1
       FOR UPDATE`,
      [merchId]
    );
    if (stockRes.rows.length === 0) {
      pendingCount += qty;
      continue;
    }
    const row = stockRes.rows[0];
    const available = effectiveMerchandiseQuantity(row);
    if (available < qty) {
      pendingCount += qty;
      continue;
    }
    const newQuantity = Math.max(0, available - qty);
    await client.query(`UPDATE merchandisestbl SET quantity = $1 WHERE merchandise_id = $2`, [
      newQuantity,
      merchId,
    ]);

    await insertMerchandiseReleaseLog(client, {
      releaseBatchId,
      source: MERCH_RELEASE_SOURCE.PACKAGE_ENROLL,
      merchandiseId: merchId,
      quantity: qty,
      branchId: bid,
      merchandiseName: line.merchandise_name || row.merchandise_name,
      size: line.size || row.size,
      category: line.category || null,
      studentId: sid,
      classId: cid,
      packageId: pid,
      paymentId: paymentId != null ? Number(paymentId) : null,
      createdBy,
      releasedAt,
    });
    totalQty += qty;
  }

  if (totalQty > 0) {
    console.log(
      `✅ Package merchandise issued (${totalQty} unit(s), ${pendingCount} pending) for student ${sid} class ${cid} package ${pid} on payment ${paymentId ?? 'n/a'}`
    );
    return { issued: true, quantity: totalQty, pending_count: pendingCount };
  }

  if (pendingCount > 0) {
    return { issued: false, reason: 'backordered', pending_count: pendingCount };
  }

  // All lines waived (or nothing to issue): record a marker release so re-enroll does not re-issue.
  if (waiveOnly.length > 0 && issuedRows.length === 0) {
    const first = waiveOnly[0];
    const markerId = Number(first.merchandise_id);
    if (Number.isFinite(markerId) && markerId > 0) {
      await insertMerchandiseReleaseLog(client, {
        releaseBatchId,
        source: MERCH_RELEASE_SOURCE.PACKAGE_ENROLL,
        merchandiseId: markerId,
        quantity: 1,
        branchId: bid,
        merchandiseName: `${first.original_type_name || first.merchandise_name || 'Merchandise'} (waived)`,
        size: first.size || null,
        category: 'Waived',
        studentId: sid,
        classId: cid,
        packageId: pid,
        paymentId: paymentId != null ? Number(paymentId) : null,
        createdBy,
        releasedAt,
      });
      console.log(
        `✅ Package merchandise all waived for student ${sid} class ${cid} package ${pid} (marker logged, no stock deduct)`
      );
      return { issued: true, reason: 'all_waived', quantity: 0, pending_count: 0 };
    }
  }

  return { issued: false, reason: 'no_lines' };
}

/**
 * Resolve package, class, branch, and pending merchandise lines for a payment invoice.
 */
export async function resolvePackageMerchIssueContext(client, invoice) {
  let packageId = invoice?.package_id != null ? Number(invoice.package_id) : null;
  let classId = null;
  let branchId = invoice?.branch_id != null ? Number(invoice.branch_id) : null;
  const remarks = invoice?.remarks || '';

  if (remarks) {
    const classMatch = String(remarks).match(/CLASS_ID:(\d+)/);
    if (classMatch) classId = parseInt(classMatch[1], 10);
  }

  if (invoice?.installmentinvoiceprofiles_id) {
    const profileRes = await client.query(
      `SELECT package_id, class_id, branch_id, downpayment_invoice_id
       FROM installmentinvoiceprofilestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [invoice.installmentinvoiceprofiles_id]
    );
    const profile = profileRes.rows[0];
    if (profile) {
      if (!packageId && profile.package_id) packageId = Number(profile.package_id);
      if (!classId && profile.class_id) classId = Number(profile.class_id);
      if (!branchId && profile.branch_id) branchId = Number(profile.branch_id);
    }
  }

  let lines = parseMerchPendingFromRemarks(remarks);

  // Phase 1+ auto-generated invoices may not carry MERCH_PENDING; read from linked downpayment invoice.
  if (!lines.length && invoice?.installmentinvoiceprofiles_id) {
    const dpRes = await client.query(
      `SELECT i.remarks
       FROM installmentinvoiceprofilestbl ip
       INNER JOIN invoicestbl i ON i.invoice_id = ip.downpayment_invoice_id
       WHERE ip.installmentinvoiceprofiles_id = $1
         AND ip.downpayment_invoice_id IS NOT NULL`,
      [invoice.installmentinvoiceprofiles_id]
    );
    if (dpRes.rows[0]?.remarks) {
      lines = parseMerchPendingFromRemarks(dpRes.rows[0].remarks);
    }
  }

  return { packageId, classId, branchId, lines };
}

/**
 * Issue package merchandise on first qualifying payment (downpayment or Phase 1).
 * Skips when already issued for same student + package + class (re-enrollment).
 */
export async function tryIssuePackageMerchandiseOnFirstPayment(client, ctx) {
  const { invoice, studentId, paymentId, paymentIssueDate, createdBy } = ctx;
  if (!studentId || !invoice) return { issued: false, reason: 'missing_invoice' };

  const { packageId, classId, branchId, lines } = await resolvePackageMerchIssueContext(client, invoice);
  if (!packageId) return { issued: false, reason: 'no_package' };
  if (!classId) return { issued: false, reason: 'no_class' };
  if (!lines.length) return { issued: false, reason: 'no_pending_lines' };

  return issuePackageMerchandiseLines(client, {
    studentId,
    classId,
    packageId,
    branchId,
    lines,
    paymentId,
    paymentIssueDate,
    createdBy,
  });
}

/**
 * SQL fragment for operational dashboard branch metrics (daily: single date param).
 * @param {number} dateParamIndex - 1-based $N index for summary date
 */
export function merchandiseReleaseDashboardCteDaily(dateParamIndex) {
  return `
            merchandise_release AS (
              SELECT
                mrl.branch_id,
                COUNT(DISTINCT mrl.release_batch_id)::bigint AS merchandise_released_count,
                COALESCE(SUM(mrl.quantity), 0)::numeric AS merchandise_released_quantity
              FROM merchandise_release_logtbl mrl
              WHERE TIMEZONE('Asia/Manila', mrl.released_at)::date = $${dateParamIndex}::date
              GROUP BY mrl.branch_id
            )`;
}

/**
 * @param {number} startParamIndex
 * @param {number} endParamIndex - exclusive month end (first day of next month)
 */
/**
 * Line-level merchandise releases for operational dashboard drill-down modal.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 */
export async function loadMerchandiseReleasedDetails(db, opts) {
  const { branchFilter, dateFrom, dateToExclusive } = opts;
  if (!(await merchandiseReleaseLogTableExists(db))) {
    return { rows: [], summary: { total_quantity: 0, release_event_count: 0, merchandise_ar_quantity: 0, package_enroll_quantity: 0 } };
  }

  const params = [dateFrom, dateToExclusive];
  let branchSql = '';
  if (branchFilter != null) {
    params.push(Number(branchFilter));
    branchSql = ` AND mrl.branch_id = $${params.length}`;
  }

  const result = await runQuery(
    db,
    `SELECT
       mrl.release_log_id,
       mrl.release_batch_id,
       mrl.source,
       mrl.merchandise_id,
       mrl.quantity,
       mrl.branch_id,
       mrl.merchandise_name,
       mrl.size,
       mrl.category,
       mrl.student_id,
       mrl.class_id,
       mrl.package_id,
       mrl.payment_id,
       mrl.ack_receipt_id,
       TO_CHAR(TIMEZONE('Asia/Manila', mrl.released_at), 'YYYY-MM-DD') AS released_date_manila,
       TO_CHAR(TIMEZONE('Asia/Manila', mrl.released_at), 'YYYY-MM-DD HH24:MI') AS released_at_manila,
       u.full_name AS student_name,
       u.email AS student_email,
       COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
       p.package_name,
       c.level_tag AS class_level_tag,
       issuer.full_name AS issued_by_name
     FROM merchandise_release_logtbl mrl
     LEFT JOIN userstbl u ON mrl.student_id = u.user_id
     LEFT JOIN branchestbl b ON mrl.branch_id = b.branch_id
     LEFT JOIN packagestbl p ON mrl.package_id = p.package_id
     LEFT JOIN classestbl c ON mrl.class_id = c.class_id
     LEFT JOIN userstbl issuer ON mrl.created_by = issuer.user_id
     WHERE TIMEZONE('Asia/Manila', mrl.released_at)::date >= $1::date
       AND TIMEZONE('Asia/Manila', mrl.released_at)::date < $2::date
       ${branchSql}
     ORDER BY mrl.released_at DESC, mrl.release_log_id DESC`,
    params
  );

  const rows = (result.rows || []).map((row) => ({
    release_log_id: row.release_log_id,
    release_batch_id: row.release_batch_id,
    source: row.source,
    merchandise_id: row.merchandise_id,
    quantity: parseInt(row.quantity, 10) || 0,
    branch_id: row.branch_id,
    merchandise_name: row.merchandise_name,
    size: row.size,
    category: row.category,
    student_id: row.student_id,
    student_name: row.student_name,
    student_email: row.student_email,
    class_id: row.class_id,
    class_level_tag: row.class_level_tag,
    package_id: row.package_id,
    package_name: row.package_name,
    payment_id: row.payment_id,
    ack_receipt_id: row.ack_receipt_id,
    released_date_manila: row.released_date_manila,
    released_at_manila: row.released_at_manila,
    issued_by_name: row.issued_by_name,
    branch_name: row.branch_name,
  }));

  const batchIds = new Set();
  let totalQty = 0;
  let arQty = 0;
  let pkgQty = 0;
  for (const row of rows) {
    totalQty += row.quantity;
    if (row.source === MERCH_RELEASE_SOURCE.MERCHANDISE_AR) arQty += row.quantity;
    else if (row.source === MERCH_RELEASE_SOURCE.PACKAGE_ENROLL) pkgQty += row.quantity;
    if (row.release_batch_id) batchIds.add(row.release_batch_id);
  }

  return {
    rows,
    summary: {
      total_quantity: totalQty,
      release_event_count: batchIds.size,
      merchandise_ar_quantity: arQty,
      package_enroll_quantity: pkgQty,
      line_count: rows.length,
    },
  };
}

const RECENT_MERCH_RELEASE_LIMIT = 50;

const mapRecentMerchReleaseRow = (row) => {
  const name = row.merchandise_name || `Item #${row.merchandise_id || '—'}`;
  const size = row.size ? ` (${row.size})` : '';
  return {
    release_log_id: parseInt(row.release_log_id, 10),
    release_batch_id: row.release_batch_id,
    source: row.source,
    item_label: `${name}${size}`,
    student_name: row.student_name || null,
    quantity: parseInt(row.quantity, 10) || 0,
    released_date: row.released_date_manila || null,
    reference_label: row.payment_id
      ? `PAY-${row.payment_id}`
      : row.ack_receipt_id
        ? `AR-${row.ack_receipt_id}`
        : null,
  };
};

/**
 * Recent merchandise release lines for operational dashboard mini-log (UI shows 3 rows + scroll).
 * @param {import('pg').Pool|import('pg').PoolClient|Function} db
 * @param {{ branchId?: number|null, summaryDate?: string, monthStart?: string, monthEndExclusive?: string, limit?: number }} options
 */
export async function loadRecentMerchandiseReleasesForOperationalDashboard(db, options = {}) {
  const { branchId = null, summaryDate, monthStart, monthEndExclusive, limit = RECENT_MERCH_RELEASE_LIMIT } =
    options;

  if (!(await merchandiseReleaseLogTableExists(db))) {
    return [];
  }

  const params = [];
  let dateFilterSql = '';

  if (summaryDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(summaryDate))) {
      throw new Error('summaryDate must be YYYY-MM-DD');
    }
    params.push(summaryDate);
    dateFilterSql = `TIMEZONE('Asia/Manila', mrl.released_at)::date = $${params.length}::date`;
  } else if (monthStart && monthEndExclusive) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(String(monthStart)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(monthEndExclusive))
    ) {
      throw new Error('monthStart and monthEndExclusive must be YYYY-MM-DD');
    }
    params.push(monthStart, monthEndExclusive);
    dateFilterSql = `TIMEZONE('Asia/Manila', mrl.released_at)::date >= $1::date AND TIMEZONE('Asia/Manila', mrl.released_at)::date < $2::date`;
  } else {
    throw new Error('Provide summaryDate or monthStart + monthEndExclusive');
  }

  let branchSql = '';
  if (branchId) {
    params.push(branchId);
    branchSql = ` AND mrl.branch_id = $${params.length}`;
  }

  params.push(limit);

  const result = await runQuery(
    db,
    `SELECT
       mrl.release_log_id,
       mrl.release_batch_id,
       mrl.source,
       mrl.merchandise_id,
       mrl.merchandise_name,
       mrl.size,
       mrl.quantity,
       mrl.payment_id,
       mrl.ack_receipt_id,
       TO_CHAR(TIMEZONE('Asia/Manila', mrl.released_at), 'YYYY-MM-DD') AS released_date_manila,
       u.full_name AS student_name
     FROM merchandise_release_logtbl mrl
     LEFT JOIN userstbl u ON mrl.student_id = u.user_id
     WHERE ${dateFilterSql}
       ${branchSql}
     ORDER BY mrl.released_at DESC, mrl.release_log_id DESC
     LIMIT $${params.length}`,
    params
  );

  return (result.rows || []).map(mapRecentMerchReleaseRow);
}

export function merchandiseReleaseDashboardCteMonthly(startParamIndex, endParamIndex) {
  return `
            merchandise_release AS (
              SELECT
                mrl.branch_id,
                COUNT(DISTINCT mrl.release_batch_id)::bigint AS merchandise_released_count,
                COALESCE(SUM(mrl.quantity), 0)::numeric AS merchandise_released_quantity
              FROM merchandise_release_logtbl mrl
              WHERE TIMEZONE('Asia/Manila', mrl.released_at)::date >= $${startParamIndex}::date
                AND TIMEZONE('Asia/Manila', mrl.released_at)::date < $${endParamIndex}::date
              GROUP BY mrl.branch_id
            )`;
}
