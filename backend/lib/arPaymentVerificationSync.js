/**
 * Bidirectional sync between Payment Logs / Cash Deposit approval and cash AR verification.
 *
 * Merchandise cash AR: Verified on issue; Payment Logs approval remains Pending until Finance approves.
 * Merchandise non-cash AR: Unverified until Finance verifies on AR page → linked payment auto-approved.
 * Legacy rows may still have status Paid — non-cash Paid is treated as Unverified; cash Paid as Verified.
 *
 * Package cash AR: Verified on issue (verified_by = Admin); Payment Logs Pending until Finance approves.
 * Package non-cash AR: Submitted until Finance verifies on AR page → Payment Logs auto-approved (unapplied row or on attach).
 */

/** Pool helper `query(text, params)` or transaction client `{ query(text, params) }`. */
const runQuery = (db, text, params) => {
  if (typeof db === 'function') {
    return db(text, params);
  }
  if (db && typeof db.query === 'function') {
    return db.query(text, params);
  }
  throw new Error('Invalid database executor for AR payment verification sync');
};

const normalizePaymentIds = (paymentIds) => {
  if (!Array.isArray(paymentIds)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of paymentIds) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

/**
 * When payment(s) are finance-approved, promote linked cash ARs from Paid → Verified.
 *
 * @param {import('pg').PoolClient | ((text: string, params?: unknown[]) => Promise<import('pg').QueryResult>) | { query: Function }} db
 * @returns {Promise<{ verifiedCount: number, ackReceiptIds: number[] }>}
 */
export async function syncArVerifiedFromPaymentApproval(db, { paymentIds, verifierUserId }) {
  const ids = normalizePaymentIds(paymentIds);
  if (!ids.length || !verifierUserId) {
    return { verifiedCount: 0, ackReceiptIds: [] };
  }

  const result = await runQuery(
    db,
    `UPDATE acknowledgement_receiptstbl ar
     SET status = 'Verified',
         verified_by_user_id = $1,
         verified_at = COALESCE(ar.verified_at, CURRENT_TIMESTAMP)
     WHERE ar.payment_id = ANY($2::int[])
       AND LOWER(TRIM(COALESCE(ar.payment_method, ''))) = 'cash'
       AND ar.ar_type IN ('Merchandise', 'Package')
       AND ar.status = 'Paid'
       AND ar.verified_by_user_id IS NULL
     RETURNING ar.ack_receipt_id`,
    [verifierUserId, ids]
  );

  return {
    verifiedCount: result.rowCount || 0,
    ackReceiptIds: (result.rows || []).map((row) => row.ack_receipt_id),
  };
}

/**
 * When payment approval is revoked, revert cash ARs that were Verified via payment approval
 * back to Paid (Merchandise) so AR page and Payment Logs stay aligned.
 *
 * @param {import('pg').PoolClient | ((text: string, params?: unknown[]) => Promise<import('pg').QueryResult>) | { query: Function }} db
 * @returns {Promise<{ revertedCount: number, ackReceiptIds: number[] }>}
 */
export async function syncArUnverifiedFromPaymentRevoke(db, { paymentIds }) {
  const ids = normalizePaymentIds(paymentIds);
  if (!ids.length) {
    return { revertedCount: 0, ackReceiptIds: [] };
  }

  const result = await runQuery(
    db,
    `UPDATE acknowledgement_receiptstbl ar
     SET status = 'Paid',
         verified_by_user_id = NULL,
         verified_at = NULL
     WHERE ar.payment_id = ANY($1::int[])
       AND LOWER(TRIM(COALESCE(ar.payment_method, ''))) = 'cash'
       AND ar.ar_type IN ('Merchandise', 'Package')
       AND ar.status = 'Verified'
       AND ar.verified_by_user_id IS NOT NULL
     RETURNING ar.ack_receipt_id`,
    [ids]
  );

  return {
    revertedCount: result.rowCount || 0,
    ackReceiptIds: (result.rows || []).map((row) => row.ack_receipt_id),
  };
}
