/**
 * Package merch backorder / pending issue (no schema change).
 * Obligations live on invoice remarks MERCH_PENDING JSON; issued units are
 * merchandise_release_logtbl rows. Remaining lines are the fulfill queue.
 */

import {
  issuePackageMerchandiseLines,
  loadIssuedPackageMerchRows,
  packageMerchLineKey,
  parseMerchPendingFromRemarks,
  remainingIssuablePackageMerchLines,
  resolvePackageMerchIssueContext,
  PACKAGE_UNIFORM_TYPE_NAMES,
} from '../merchandiseReleaseLog.js';

const PAID_INVOICE_STATUSES = new Set(['paid', 'partially paid']);

/**
 * Pending issue feature go-live (Manila). Older MERCH_PENDING enrollments used the
 * previous stock-required flow and must not appear on this tab.
 */
export const PACKAGE_MERCH_PENDING_ISSUE_CUTOFF_YMD = '2026-08-21';

function toManilaYmd(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function isOnOrAfterPendingIssueCutoff(enrolledAt, invoiceIssueDate) {
  const ymd = toManilaYmd(enrolledAt) || toManilaYmd(invoiceIssueDate);
  if (!ymd) return false;
  return ymd >= PACKAGE_MERCH_PENDING_ISSUE_CUTOFF_YMD;
}

function parseClassIdFromRemarks(remarks) {
  const match = String(remarks || '').match(/CLASS_ID:(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function invoiceLooksPaid(row) {
  const status = String(row.status || '').trim().toLowerCase();
  if (PAID_INVOICE_STATUSES.has(status)) return true;
  return Number(row.payment_count || 0) > 0;
}

function runQuery(db, text, params) {
  return typeof db === 'function' ? db(text, params) : db.query(text, params);
}

function stockQty(row) {
  if (!row || row.quantity == null || row.quantity === undefined) return null;
  const n = parseInt(row.quantity, 10);
  return Number.isFinite(n) ? n : null;
}

function uniformTypeAliases(category) {
  const cat = String(category || '').trim();
  if (cat === 'Set') return ['set', 'complete set'];
  if (cat === 'Top') return ['top', 'polo', 'shirt', 'blouse', 'logo 1', 'logo 2'];
  if (cat === 'Bottom') return ['bottom', 'short', 'pants', 'shorts', 'skirt'];
  return null;
}

/**
 * Match a pending line to a concrete branch stock row (by id, then name/size/type).
 */
function resolveStockRowForLine(line, branchId, stockById, stockByBranch) {
  const mid = Number(line.merchandise_id);
  if (Number.isFinite(mid) && mid > 0) {
    const byId = stockById.get(mid);
    if (byId && Number(byId.branch_id) === Number(branchId)) return byId;
  }

  const name = String(line.merchandise_name || line.original_type_name || '')
    .trim()
    .toLowerCase();
  if (!name || !branchId) return null;

  const candidates = stockByBranch.get(Number(branchId)) || [];
  const size = String(line.size || '').trim().toLowerCase();
  const aliases = uniformTypeAliases(line.category);
  const isUniform =
    PACKAGE_UNIFORM_TYPE_NAMES.map((n) => n.toLowerCase()).includes(name) && aliases;

  let best = null;
  let bestQty = -1;
  for (const row of candidates) {
    if (String(row.merchandise_name || '').trim().toLowerCase() !== name) continue;
    if (size) {
      const rowSize = String(row.size || '').trim().toLowerCase();
      if (rowSize && rowSize !== size) continue;
    }
    if (isUniform) {
      const rowType = String(row.type || '').trim().toLowerCase();
      if (!aliases.includes(rowType)) continue;
    }
    const qty = stockQty(row);
    const score = qty == null ? 999999 : qty;
    if (score > bestQty) {
      bestQty = score;
      best = row;
    }
  }
  return best;
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient|Function} db
 * @param {{ branchId?: number|null }} opts
 */
export async function listPendingPackageMerch(db, { branchId } = {}) {
  const params = [];
  let branchSql = '';
  if (branchId != null && Number.isFinite(Number(branchId))) {
    params.push(Number(branchId));
    branchSql = ` AND i.branch_id = $${params.length}`;
  }

  const result = await runQuery(
    db,
    `SELECT
       i.invoice_id,
       i.branch_id,
       i.package_id,
       i.status,
       i.remarks,
       i.issue_date,
       i.installmentinvoiceprofiles_id,
       ist.student_id,
       u.full_name AS student_name,
       p.package_name,
       b.branch_name,
       c.class_id,
       c.class_name,
       (
         SELECT cs.enrolled_at
         FROM classstudentstbl cs
         WHERE cs.student_id = ist.student_id
           AND cs.class_id = c.class_id
           AND cs.removed_at IS NULL
         ORDER BY cs.enrolled_at DESC NULLS LAST, cs.classstudent_id DESC
         LIMIT 1
       ) AS enrolled_at,
       (
         SELECT COUNT(*)::int
         FROM paymenttbl pay
         WHERE pay.invoice_id = i.invoice_id
           AND pay.student_id = ist.student_id
           AND COALESCE(pay.status, '') NOT IN ('Returned', 'Rejected')
           AND COALESCE(pay.approval_status, '') NOT IN ('Returned', 'Rejected')
       ) AS payment_count
     FROM invoicestbl i
     INNER JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
     INNER JOIN userstbl u ON u.user_id = ist.student_id
     LEFT JOIN packagestbl p ON p.package_id = i.package_id
     LEFT JOIN branchestbl b ON b.branch_id = i.branch_id
     LEFT JOIN classestbl c ON c.class_id = COALESCE(
       NULLIF(substring(i.remarks from 'CLASS_ID:([0-9]+)'), '')::int,
       (
         SELECT ip.class_id
         FROM installmentinvoiceprofilestbl ip
         WHERE ip.installmentinvoiceprofiles_id = i.installmentinvoiceprofiles_id
         LIMIT 1
       )
     )
     WHERE i.remarks ILIKE '%MERCH_PENDING:%'
       ${branchSql}
     ORDER BY i.issue_date DESC NULLS LAST, i.invoice_id DESC
     LIMIT 800`,
    params
  );

  const parsedRows = [];
  const branchIds = new Set();
  for (const row of result.rows) {
    const lines = parseMerchPendingFromRemarks(row.remarks);
    if (!lines.length) continue;
    parsedRows.push({ row, lines });
    if (row.branch_id) branchIds.add(Number(row.branch_id));
  }

  const stockById = new Map();
  const stockByBranch = new Map();
  if (branchIds.size > 0) {
    const stockRes = await runQuery(
      db,
      `SELECT merchandise_id, merchandise_name, size, type, quantity, sku, item_name, branch_id
       FROM merchandisestbl
       WHERE branch_id = ANY($1::int[])`,
      [Array.from(branchIds)]
    );
    for (const stock of stockRes.rows) {
      stockById.set(Number(stock.merchandise_id), stock);
      const bid = Number(stock.branch_id);
      if (!stockByBranch.has(bid)) stockByBranch.set(bid, []);
      stockByBranch.get(bid).push(stock);
    }
  }

  const seen = new Set();
  const items = [];

  for (const { row, lines } of parsedRows) {
    const classId = Number(row.class_id) || parseClassIdFromRemarks(row.remarks);
    const packageId = Number(row.package_id);
    const studentId = Number(row.student_id);
    const bid = Number(row.branch_id);
    if (!classId || !packageId || !studentId) continue;

    // Hide enrollments from before Pending issue cutoff (2026-08-21).
    if (!isOnOrAfterPendingIssueCutoff(row.enrolled_at, row.issue_date)) {
      continue;
    }

    const issuedRows = await loadIssuedPackageMerchRows(db, {
      studentId,
      packageId,
      classId,
    });
    // Still-owed lines only (includes enrollments that had 0 stock and were never issued).
    const remaining = remainingIssuablePackageMerchLines(lines, issuedRows);
    const hasFirstPayment = invoiceLooksPaid(row) || issuedRows.length > 0;

    for (const line of remaining) {
      const lineKey = packageMerchLineKey(line);
      const dedupeKey = `${studentId}|${classId}|${packageId}|${lineKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const stock = resolveStockRowForLine(line, bid, stockById, stockByBranch);
      // Skip orphan/placeholder package lines with no concrete stock row at this branch.
      // Pending issue is only for real OOS (or restocked) SKUs staff can fulfill.
      if (!stock) continue;

      const available = stockQty(stock);
      const needed = Math.max(1, parseInt(String(line.quantity ?? 1), 10) || 1);
      const qtyOnHand = available === null ? 0 : available;
      const hasStockNow = qtyOnHand >= needed;
      const canIssueNow = hasFirstPayment && hasStockNow;

      let blockReason = null;
      if (!hasFirstPayment) {
        blockReason = 'Waiting for first package payment';
      } else if (!hasStockNow) {
        blockReason = 'Out of stock — issue after restock';
      }

      items.push({
        invoice_id: Number(row.invoice_id),
        student_id: studentId,
        student_name: row.student_name,
        class_id: classId,
        class_name: row.class_name || null,
        package_id: packageId,
        package_name: row.package_name || null,
        branch_id: bid || null,
        branch_name: row.branch_name || null,
        invoice_issue_date: row.issue_date || null,
        enrolled_at: row.enrolled_at || null,
        invoice_status: row.status || null,
        has_first_payment: hasFirstPayment,
        line_key: lineKey,
        merchandise_id: stock?.merchandise_id || line.merchandise_id,
        merchandise_name: line.merchandise_name,
        original_type_name: line.original_type_name || null,
        size: line.size || null,
        category: line.category || null,
        action: line.action || 'issue',
        quantity: needed,
        available_quantity: qtyOnHand,
        sku: stock?.sku || null,
        item_name: stock?.item_name || null,
        can_issue: canIssueNow,
        block_reason: blockReason,
      });
    }
  }

  // Page 1 row 1 = latest enrolled student still owed merch that is out of stock.
  // Then other OOS by newest enrolled_at; in-stock "ready to issue" after that.
  items.sort((a, b) => {
    const aOos = Number(a.available_quantity) <= 0 ? 1 : 0;
    const bOos = Number(b.available_quantity) <= 0 ? 1 : 0;
    if (aOos !== bOos) return bOos - aOos;

    const aEnrolled = toSortTs(a.enrolled_at || a.invoice_issue_date);
    const bEnrolled = toSortTs(b.enrolled_at || b.invoice_issue_date);
    if (aEnrolled !== bEnrolled) return bEnrolled - aEnrolled;

    return Number(b.invoice_id) - Number(a.invoice_id);
  });

  return items;
}

function toSortTs(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Issue one remaining line (or all in-stock remaining lines) after first payment.
 * @param {import('pg').PoolClient} client
 */
export async function issuePendingPackageMerchLine(client, params) {
  const {
    invoiceId,
    studentId,
    createdBy = null,
    lineKey = null,
    merchandiseId = null,
    size = null,
    category = null,
  } = params;

  const invoiceRes = await client.query(
    `SELECT invoice_id, branch_id, package_id, status, remarks, issue_date,
            installmentinvoiceprofiles_id
     FROM invoicestbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  const invoice = invoiceRes.rows[0];
  if (!invoice) {
    return { ok: false, status: 404, message: 'Invoice not found' };
  }

  const ctx = await resolvePackageMerchIssueContext(client, invoice);
  const classId = ctx.classId;
  const packageId = ctx.packageId;
  const branchId = ctx.branchId;
  if (!classId || !packageId || !branchId) {
    return { ok: false, status: 400, message: 'Invoice is missing class, package, or branch' };
  }

  const issuedRows = await loadIssuedPackageMerchRows(client, {
    studentId,
    packageId,
    classId,
  });
  let remaining = remainingIssuablePackageMerchLines(ctx.lines, issuedRows);
  if (!remaining.length) {
    return { ok: false, status: 400, message: 'No pending package merchandise to issue' };
  }

  if (lineKey) {
    remaining = remaining.filter((line) => packageMerchLineKey(line) === lineKey);
  } else if (merchandiseId) {
    remaining = remaining.filter((line) => {
      const midOk = Number(line.merchandise_id) === Number(merchandiseId);
      const sizeOk = size == null || String(line.size || '') === String(size);
      const catOk = category == null || String(line.category || '') === String(category);
      return midOk && sizeOk && catOk;
    });
  }

  if (!remaining.length) {
    return {
      ok: false,
      status: 400,
      message: 'That pending line was not found (it may already be issued)',
    };
  }

  const payRes = await client.query(
    `SELECT COUNT(*)::int AS payment_count
     FROM paymenttbl
     WHERE invoice_id = $1
       AND student_id = $2
       AND COALESCE(status, '') NOT IN ('Returned', 'Rejected')
       AND COALESCE(approval_status, '') NOT IN ('Returned', 'Rejected')`,
    [invoiceId, studentId]
  );
  const hasFirstPayment =
    invoiceLooksPaid({
      status: invoice.status,
      payment_count: payRes.rows[0]?.payment_count,
    }) || issuedRows.length > 0;

  if (!hasFirstPayment) {
    return {
      ok: false,
      status: 400,
      message: 'Record the first package payment before issuing merchandise',
    };
  }

  const result = await issuePackageMerchandiseLines(client, {
    studentId,
    classId,
    packageId,
    branchId,
    lines: remaining,
    paymentId: null,
    paymentIssueDate: invoice.issue_date,
    createdBy,
  });

  if (result.reason === 'backordered' || (result.pending_count > 0 && !result.issued)) {
    return {
      ok: false,
      status: 400,
      message: 'Still out of stock. Request stock, then Issue when quantity is available.',
      result,
    };
  }

  if (!result.issued && result.reason === 'already_issued') {
    return { ok: false, status: 400, message: 'This merchandise was already issued', result };
  }

  return { ok: true, result };
}
