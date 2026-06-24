/**
 * Acknowledgement Receipt status helpers — shared by routes and list filters.
 *
 * Returned ARs keep status Unverified (or legacy Submitted/Paid) and are marked
 * with `[Returned]` in prospect_student_notes. Resubmit appends `[Resubmitted]`.
 */

export const AR_STATUS = Object.freeze({
  PENDING: 'Pending',
  UNVERIFIED: 'Unverified',
  SUBMITTED: 'Submitted',
  PAID: 'Paid',
  VERIFIED: 'Verified',
  APPLIED: 'Applied',
  ENROLLED: 'Enrolled',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
});

/** DB status values that mean Finance has not verified yet (excludes legacy Paid — use payment_method). */
export const AR_UNVERIFIED_STATUSES = Object.freeze([
  AR_STATUS.UNVERIFIED,
  AR_STATUS.SUBMITTED,
  AR_STATUS.PENDING,
]);

/** Legacy Paid rows: non-cash → unverified bucket; cash → verified bucket. */
export const AR_LEGACY_PAID_STATUS = AR_STATUS.PAID;

const RETURNED_MARKER = '[Returned]';
const RESUBMITTED_MARKER = '[Resubmitted]';
const RETURNED_MARKER_REVERSE = RETURNED_MARKER.split('').reverse().join('');
const RESUBMITTED_MARKER_REVERSE = RESUBMITTED_MARKER.split('').reverse().join('');

const normalizeStatus = (status) => String(status || '').trim();

const resolveStatusAndNotes = (statusOrReceipt, prospectNotes) => {
  if (typeof statusOrReceipt === 'object' && statusOrReceipt !== null) {
    return {
      status: statusOrReceipt.status,
      notes: statusOrReceipt.prospect_student_notes,
    };
  }
  return { status: statusOrReceipt, notes: prospectNotes };
};

const lastMarkerIsReturned = (notes) => {
  const text = String(notes || '');
  if (!text.includes(RETURNED_MARKER)) return false;
  if (!text.includes(RESUBMITTED_MARKER)) return true;

  const reversed = text.split('').reverse().join('');
  const lastReturnedPos = reversed.indexOf(RETURNED_MARKER_REVERSE);
  const lastResubmittedPos = reversed.indexOf(RESUBMITTED_MARKER_REVERSE);

  if (lastReturnedPos === -1) return false;
  if (lastResubmittedPos === -1) return true;
  return lastReturnedPos < lastResubmittedPos;
};

/**
 * True when Finance returned the AR and the branch has not resubmitted since the latest return.
 * Accepts `(receipt)` or `(status, prospect_student_notes)`.
 */
export function isArReturnedForCorrection(statusOrReceipt, prospectNotes) {
  const { status, notes } = resolveStatusAndNotes(statusOrReceipt, prospectNotes);
  const normalized = normalizeStatus(status);

  if (normalized === AR_STATUS.RETURNED) return true;
  if (normalized === AR_STATUS.REJECTED || normalized === AR_STATUS.CANCELLED) return false;

  return lastMarkerIsReturned(notes);
}

export function isArCashPaymentMethod(paymentMethod) {
  return String(paymentMethod || '').trim().toLowerCase() === 'cash';
}

/**
 * Logical status for filters and UI — Paid is split by payment method.
 * @param {string|{ status?: string, payment_method?: string }} statusOrReceipt
 */
export function resolveArEffectiveStatus(statusOrReceipt) {
  const status =
    typeof statusOrReceipt === 'object' && statusOrReceipt !== null
      ? statusOrReceipt.status
      : statusOrReceipt;
  const paymentMethod =
    typeof statusOrReceipt === 'object' && statusOrReceipt !== null
      ? statusOrReceipt.payment_method
      : null;

  const normalized = normalizeStatus(status);
  if (normalized === AR_STATUS.PAID) {
    return isArCashPaymentMethod(paymentMethod) ? AR_STATUS.VERIFIED : AR_STATUS.UNVERIFIED;
  }
  return normalized;
}

export function isArUnverifiedStatus(statusOrReceipt, paymentMethod) {
  const receipt =
    typeof statusOrReceipt === 'object' && statusOrReceipt !== null
      ? statusOrReceipt
      : { status: statusOrReceipt, payment_method: paymentMethod };
  const effective = resolveArEffectiveStatus(receipt);
  return AR_UNVERIFIED_STATUSES.includes(effective);
}

const paidNonCashUnverifiedSql = (alias) =>
  `(TRIM(COALESCE(${alias}.status, '')) = '${AR_STATUS.PAID}' AND LOWER(TRIM(COALESCE(${alias}.payment_method, ''))) <> 'cash')`;

const paidCashVerifiedSql = (alias) =>
  `(TRIM(COALESCE(${alias}.status, '')) = '${AR_STATUS.PAID}' AND LOWER(TRIM(COALESCE(${alias}.payment_method, ''))) = 'cash')`;

const AR_ALL_BUCKET_DB_STATUSES = Object.freeze([
  AR_STATUS.VERIFIED,
  AR_STATUS.APPLIED,
  AR_STATUS.UNVERIFIED,
  AR_STATUS.SUBMITTED,
  AR_STATUS.PENDING,
  AR_STATUS.REJECTED,
]);

const FILTER_ALIASES = Object.freeze({
  unverified: AR_UNVERIFIED_STATUSES,
  verified: [AR_STATUS.VERIFIED],
  applied: [AR_STATUS.APPLIED],
  'verified,applied': [AR_STATUS.VERIFIED, AR_STATUS.APPLIED],
  verified_applied: [AR_STATUS.VERIFIED, AR_STATUS.APPLIED],
  rejected: [AR_STATUS.REJECTED],
  enrolled: [AR_STATUS.ENROLLED],
  cancelled: [AR_STATUS.CANCELLED],
  pending: [AR_STATUS.PENDING],
});

/** Superadmin / Admin AR list + Financial Dashboard bucket union (excludes Returned queue). */
export const AR_ADMIN_ALL_BUCKET_FILTER_TOKENS = Object.freeze([
  'Verified,Applied',
  'Unverified',
  'Rejected',
]);

export function expandArAdminAllBucketStatuses() {
  return [...AR_ALL_BUCKET_DB_STATUSES];
}

/**
 * SQL predicate for GET /acknowledgement-receipts status filter (list + count).
 * Handles Paid split by payment method for admin/finance bucket tokens.
 */
export function buildArListStatusFilterSql(alias, statusParam, startParamIndex = 1) {
  const raw = String(statusParam || '').trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return { sql: '', params: [], nextParamIndex: startParamIndex };
  }

  if (lower === 'returned') {
    return buildArReturnedOnlySql(alias, startParamIndex);
  }

  const rawStatuses = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const normalizedToken = raw.replace(/\s/g, '').toLowerCase();
  const isUnverifiedBucket = normalizedToken === 'unverified';
  const isVerifiedBucket =
    normalizedToken === 'verified,applied' || normalizedToken === 'verified_applied';
  const isRejectedBucket = normalizedToken === 'rejected';
  const isAllBucket = lower === 'all';

  let sql = '';
  const params = [];
  let paramIndex = startParamIndex;

  if (isAllBucket) {
    sql += ` AND (${alias}.status = ANY($${paramIndex}::text[]) OR TRIM(COALESCE(${alias}.status, '')) = '${AR_STATUS.PAID}')`;
    params.push(AR_ALL_BUCKET_DB_STATUSES);
    paramIndex += 1;
    return { sql, params, nextParamIndex: paramIndex };
  }

  if (isUnverifiedBucket) {
    sql += ` AND (${alias}.status = ANY($${paramIndex}::text[]) OR ${paidNonCashUnverifiedSql(alias)})`;
    params.push([...AR_UNVERIFIED_STATUSES]);
    paramIndex += 1;
    return { sql, params, nextParamIndex: paramIndex };
  }

  if (isVerifiedBucket) {
    sql += ` AND (${alias}.status = ANY($${paramIndex}::text[]) OR ${paidCashVerifiedSql(alias)})`;
    params.push([AR_STATUS.VERIFIED, AR_STATUS.APPLIED]);
    paramIndex += 1;
    return { sql, params, nextParamIndex: paramIndex };
  }

  if (isRejectedBucket) {
    sql += ` AND ${alias}.status = ANY($${paramIndex}::text[])`;
    params.push([AR_STATUS.REJECTED]);
    paramIndex += 1;
    return { sql, params, nextParamIndex: paramIndex };
  }

  const statuses = expandArStatusFilterValues(rawStatuses);
  if (statuses.length > 0) {
    sql += ` AND ${alias}.status = ANY($${paramIndex}::text[])`;
    params.push(statuses);
    paramIndex += 1;
  }

  return { sql, params, nextParamIndex: paramIndex };
}

/**
 * Expand UI / query filter tokens to concrete DB status values.
 * "Returned" is handled separately via buildArReturnedOnlySql.
 */
export function expandArStatusFilterValues(rawValues) {
  const input = Array.isArray(rawValues) ? rawValues : [rawValues];
  const expanded = new Set();

  for (const raw of input) {
    const key = String(raw || '').trim();
    if (!key) continue;

    const lower = key.toLowerCase();
    if (lower === 'returned') continue;

    if (lower === 'all') {
      expandArAdminAllBucketStatuses().forEach((status) => expanded.add(status));
      continue;
    }

    const alias = FILTER_ALIASES[lower];
    if (alias) {
      alias.forEach((status) => expanded.add(status));
      continue;
    }

    if (key.includes(',')) {
      expandArStatusFilterValues(key.split(',').map((part) => part.trim()).filter(Boolean)).forEach(
        (status) => expanded.add(status)
      );
      continue;
    }

    expanded.add(key);
  }

  return Array.from(expanded);
}

const buildReturnedPredicateSql = (alias) => `(
  TRIM(COALESCE(${alias}.status, '')) = '${AR_STATUS.RETURNED}'
  OR (
    COALESCE(${alias}.prospect_student_notes, '') LIKE '%${RETURNED_MARKER}%'
    AND (
      COALESCE(${alias}.prospect_student_notes, '') NOT LIKE '%${RESUBMITTED_MARKER}%'
      OR POSITION(
        '${RETURNED_MARKER_REVERSE}' IN REVERSE(COALESCE(${alias}.prospect_student_notes, ''))
      ) < POSITION(
        '${RESUBMITTED_MARKER_REVERSE}' IN REVERSE(COALESCE(${alias}.prospect_student_notes, ''))
      )
    )
  )
)`;

/**
 * @param {string} alias - SQL table alias (e.g. "ar")
 * @param {number} startParamIndex - next $n index (unused; kept for call-site compatibility)
 */
export function buildArReturnedOnlySql(alias, startParamIndex = 1) {
  return {
    sql: ` AND ${buildReturnedPredicateSql(alias)}`,
    params: [],
    nextParamIndex: startParamIndex,
  };
}

/**
 * Exclude rows that are currently returned for branch correction.
 */
export function buildArExcludeReturnedSql(alias, startParamIndex = 1) {
  return {
    sql: ` AND NOT ${buildReturnedPredicateSql(alias)}`,
    params: [],
    nextParamIndex: startParamIndex,
  };
}

/** Status filter tokens — Superadmin / Admin AR list + Financial Dashboard (matches frontend AR_STATUS_FILTER). */
export const AR_LIST_STATUS_FILTER = Object.freeze({
  ALL: 'all',
  VERIFIED_APPLIED: 'Verified,Applied',
  UNVERIFIED: 'Unverified',
  REJECTED: 'Rejected',
});

const shouldExcludeRejectedForAdminBucket = (statusFilterToken) => {
  const lower = String(statusFilterToken || '').trim().toLowerCase();
  return (
    lower === AR_LIST_STATUS_FILTER.UNVERIFIED.toLowerCase()
    || lower === 'verified,applied'
    || lower === 'verified_applied'
  );
};

/**
 * SQL scope for Superadmin / Admin AR status buckets (All, Verified+Applied, Unverified, Rejected).
 * Always excludes the Returned-for-correction queue; Rejected rows excluded only on Verified/Unverified buckets.
 */
export function buildArAdminStatusFilterSql(alias, statusFilterToken, startParamIndex = 1) {
  const raw = String(statusFilterToken || '').trim();
  const lower = raw.toLowerCase();

  if (lower === 'returned') {
    return buildArReturnedOnlySql(alias, startParamIndex);
  }

  let sql = '';
  const params = [];
  let paramIndex = startParamIndex;

  const excludeReturned = buildArExcludeReturnedSql(alias, paramIndex);
  sql += excludeReturned.sql;
  paramIndex = excludeReturned.nextParamIndex;

  const bucketToken = !raw || lower === 'all' ? AR_LIST_STATUS_FILTER.ALL : raw;
  const bucketLower = bucketToken.toLowerCase();
  const statusClause = buildArListStatusFilterSql(alias, bucketToken, paramIndex);
  sql += statusClause.sql;
  params.push(...statusClause.params);
  paramIndex = statusClause.nextParamIndex;

  if (shouldExcludeRejectedForAdminBucket(raw)) {
    const rejectedStatuses = expandArStatusFilterValues([AR_STATUS.REJECTED]);
    if (rejectedStatuses.length > 0) {
      sql += ` AND (${alias}.status IS NULL OR NOT (${alias}.status = ANY($${paramIndex}::text[])))`;
      params.push(rejectedStatuses);
      paramIndex += 1;
    }
  }

  return { sql, params, nextParamIndex: paramIndex };
}

/** @deprecated Use buildArAdminStatusFilterSql — kept for Finance list filters. */
export function buildArMainTabStatusFilterSql(alias, statusFilterToken, startParamIndex = 1) {
  return buildArAdminStatusFilterSql(alias, statusFilterToken, startParamIndex);
}
