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
export const PACKAGE_UNIFORM_TYPE_NAMES = ['LCA Uniform', 'LCA PE Uniform'];

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
  if (line?.category === 'Top' || line?.category === 'Bottom') score += 20;
  if (line?.size) score += 5;
  return score;
};

/**
 * True when configured selections already satisfy a package-included merchandise type.
 * Uniforms need both Top and Bottom; other types match by merchandise_name.
 */
export function isPackageMerchTypeCovered(merchName, merchandiseToDeduct) {
  const name = String(merchName || '').trim();
  if (!name || !merchandiseToDeduct?.size) return false;

  if (PACKAGE_UNIFORM_TYPE_NAMES.includes(name)) {
    for (const info of merchandiseToDeduct.values()) {
      if (info.merchandise_name !== name) continue;
      if (info.category === 'Top' || info.category === 'Bottom') return true;
    }
    return false;
  }

  for (const info of merchandiseToDeduct.values()) {
    if (info.merchandise_name === name) return true;
  }
  return false;
}

/**
 * Resolve a branch merchandise row with enough stock for enrollment/validation.
 * Falls back to same name (and size/category when provided) when the configured id is out of stock.
 *
 * @param {import('pg').PoolClient} client
 * @param {{
 *   merchandiseId?: number|null,
 *   merchandiseName?: string|null,
 *   branchId: number,
 *   quantityNeeded?: number,
 *   size?: string|null,
 *   category?: string|null,
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
  }
) {
  const needed = Math.max(1, parseInt(String(quantityNeeded), 10) || 1);

  const rowHasStock = (row) => {
    if (!row) return false;
    if (Number(branchId) !== Number(row.branch_id)) return false;
    if (row.quantity === null || row.quantity === undefined) return true;
    return (parseInt(row.quantity, 10) || 0) >= needed;
  };

  if (merchandiseId) {
    const byId = await client.query(
      `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id, type
       FROM merchandisestbl WHERE merchandise_id = $1`,
      [merchandiseId]
    );
    if (rowHasStock(byId.rows[0])) {
      return byId.rows[0];
    }
  }

  const name = String(merchandiseName || '').trim();
  if (!name || !branchId) return null;

  const isUniformTopBottom =
    PACKAGE_UNIFORM_TYPE_NAMES.includes(name) &&
    category &&
    (category === 'Top' || category === 'Bottom');

  let candidatesRes;
  if (isUniformTopBottom && size) {
    candidatesRes = await client.query(
      `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id, type
       FROM merchandisestbl
       WHERE merchandise_name = $1 AND branch_id = $2 AND size = $3
         AND LOWER(COALESCE(type, '')) = LOWER($4)
       ORDER BY quantity DESC NULLS LAST, merchandise_id ASC`,
      [name, branchId, size, category]
    );
  } else if (size) {
    candidatesRes = await client.query(
      `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id, type
       FROM merchandisestbl
       WHERE merchandise_name = $1 AND branch_id = $2 AND size = $3
       ORDER BY quantity DESC NULLS LAST, merchandise_id ASC`,
      [name, branchId, size]
    );
  } else {
    candidatesRes = await client.query(
      `SELECT merchandise_id, merchandise_name, size, price, quantity, branch_id, type
       FROM merchandisestbl
       WHERE merchandise_name = $1 AND branch_id = $2
       ORDER BY quantity DESC NULLS LAST, merchandise_id ASC`,
      [name, branchId]
    );
  }

  for (const row of candidatesRes.rows) {
    if (rowHasStock(row)) return row;
  }

  return null;
}

/**
 * Collapse duplicate package merchandise lines (placeholder SKUs + configured Top/Bottom).
 * @param {Array<{ merchandise_id: number, quantity?: number, size?: string|null, merchandise_name?: string|null, category?: string|null }>} lines
 */
export function normalizePackageMerchLines(lines) {
  if (!lines?.length) return [];

  const byKey = new Map();

  for (const raw of lines) {
    const mid = Number(raw.merchandise_id);
    if (!Number.isFinite(mid) || mid <= 0) continue;
    const name = String(raw.merchandise_name || '').trim();
    if (!name) continue;

    const line = {
      merchandise_id: mid,
      quantity: Math.max(1, parseInt(String(raw.quantity ?? 1), 10) || 1),
      size: raw.size || null,
      merchandise_name: name,
      category: raw.category || null,
    };

    const isUniform = PACKAGE_UNIFORM_TYPE_NAMES.includes(name);
    let key;
    if (isUniform && (line.category === 'Top' || line.category === 'Bottom')) {
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
    byKey.has(`${name}|Top`) && byKey.has(`${name}|Bottom`);

  const out = [];
  for (const line of byKey.values()) {
    if (
      PACKAGE_UNIFORM_TYPE_NAMES.includes(line.merchandise_name) &&
      hasConfiguredUniform(line.merchandise_name) &&
      line.category !== 'Top' &&
      line.category !== 'Bottom'
    ) {
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * Resolve Top/Bottom uniform SKU for package issue (1:1 with configured category + size).
 * @param {import('pg').PoolClient} client
 */
export async function resolvePackageUniformMerchandiseId(
  client,
  { merchandiseName, size, branchId, category }
) {
  const name = String(merchandiseName || '').trim();
  const cat = String(category || '').trim();
  if (!PACKAGE_UNIFORM_TYPE_NAMES.includes(name)) return null;
  if (cat !== 'Top' && cat !== 'Bottom') return null;
  if (!size || !branchId) return null;

  const r = await client.query(
    `SELECT merchandise_id
     FROM merchandisestbl
     WHERE merchandise_name = $1
       AND size = $2
       AND branch_id = $3
       AND LOWER(COALESCE(type, '')) = LOWER($4)
     ORDER BY merchandise_id ASC
     LIMIT 1`,
    [name, size, branchId, cat]
  );
  return r.rows[0]?.merchandise_id ?? null;
}

export function linesFromMerchandiseToDeduct(merchandiseToDeduct) {
  if (!merchandiseToDeduct || merchandiseToDeduct.size === 0) return [];
  const lines = [];
  for (const [, info] of merchandiseToDeduct.entries()) {
    const mid = Number(info.merchandise_id);
    if (!Number.isFinite(mid) || mid <= 0) continue;
    lines.push({
      merchandise_id: mid,
      quantity: Math.max(1, parseInt(String(info.count ?? 1), 10) || 1),
      size: info.size || null,
      merchandise_name: info.merchandise_name || null,
      category: info.category || null,
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
 * Deduct stock and write release log (package included merchandise, once per student/package/class).
 *
 * @returns {Promise<{ issued: boolean, reason?: string, quantity?: number }>}
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

  if (await hasPackageMerchandiseBeenIssued(client, { studentId: sid, packageId: pid, classId: cid })) {
    return { issued: false, reason: 'already_issued' };
  }

  const releaseBatchId = paymentId
    ? buildPackagePaymentReleaseBatchId(paymentId)
    : buildPackageEnrollReleaseBatchId(cid, sid);
  const releasedAt = manilaNoonFromIssueDate(paymentIssueDate);
  let totalQty = 0;

  for (const line of normalizedLines) {
    let merchId = Number(line.merchandise_id);
    const qty = Math.max(1, parseInt(String(line.quantity ?? 1), 10) || 1);
    if (!Number.isFinite(merchId) || merchId <= 0) continue;

    const uniformName = String(line.merchandise_name || '').trim();
    if (
      PACKAGE_UNIFORM_TYPE_NAMES.includes(uniformName) &&
      (line.category === 'Top' || line.category === 'Bottom') &&
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

    const stockRes = await client.query(
      `SELECT merchandise_id, merchandise_name, size, type, quantity
       FROM merchandisestbl
       WHERE merchandise_id = $1`,
      [merchId]
    );
    if (stockRes.rows.length === 0) continue;
    const row = stockRes.rows[0];
    if (row.quantity !== null && row.quantity !== undefined) {
      const available = parseInt(row.quantity, 10) || 0;
      if (available < qty) {
        throw new Error(
          `Insufficient inventory for ${row.merchandise_name || 'Merchandise'}${row.size ? ` (${row.size})` : ''}. ` +
            `Available: ${available}, Needed: ${qty}`
        );
      }
      const newQuantity = Math.max(0, available - qty);
      await client.query(`UPDATE merchandisestbl SET quantity = $1 WHERE merchandise_id = $2`, [
        newQuantity,
        merchId,
      ]);
    }

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

  if (totalQty <= 0) {
    return { issued: false, reason: 'no_lines' };
  }

  console.log(
    `✅ Package merchandise issued (${totalQty} unit(s)) for student ${sid} class ${cid} package ${pid} on payment ${paymentId ?? 'n/a'}`
  );
  return { issued: true, quantity: totalQty };
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
