import { query } from '../config/database.js';

let pairedAckColumnKnownTrue = false;

/** True when `paired_ack_receipt_id` exists (dual-row package AR pairs). */
export async function ackReceiptHasPairedAckReceiptIdColumn(runQuery = query) {
  if (pairedAckColumnKnownTrue) return true;
  try {
    const r = await runQuery(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'acknowledgement_receiptstbl'
         AND column_name = 'paired_ack_receipt_id'
       LIMIT 1`
    );
    if (r.rows.length > 0) {
      pairedAckColumnKnownTrue = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Same hide rule as GET /acknowledgement-receipts list (exclude leader row when a pair row points at it). */
export const AR_LIST_EXCLUDE_PAIRED_LEADER_SQL = `
              AND NOT EXISTS (
                SELECT 1 FROM acknowledgement_receiptstbl ar_parent
                WHERE ar_parent.paired_ack_receipt_id = ar.ack_receipt_id
              )`;

/** Same line total as list `filterTotalLineAmount` when pairs are enabled (follower row + paired row amounts). */
export const AR_LIST_LINE_AMOUNT_SUM_SQL = `(COALESCE(ar.payment_amount, 0) + COALESCE(ar.tip_amount, 0) + COALESCE((
                 SELECT COALESCE(pay.payment_amount, 0) + COALESCE(pay.tip_amount, 0)
                 FROM acknowledgement_receiptstbl pay
                 WHERE pay.ack_receipt_id = ar.paired_ack_receipt_id
               ), 0))`;

/**
 * Resolve all acknowledgement receipt IDs in a Downpayment + Phase 1 pair.
 * Returns the given id alone when no pair exists.
 *
 * @param {number|string} ackReceiptId
 * @param {typeof query} [runQuery]
 * @returns {Promise<number[]>}
 */
export async function resolvePairedAckReceiptIds(ackReceiptId, runQuery = query) {
  const id = Number(ackReceiptId);
  if (!Number.isFinite(id) || id <= 0) return [];

  const hasPairedCol = await ackReceiptHasPairedAckReceiptIdColumn(runQuery);
  if (!hasPairedCol) return [id];

  const rowRes = await runQuery(
    `SELECT ack_receipt_id, paired_ack_receipt_id
     FROM acknowledgement_receiptstbl
     WHERE ack_receipt_id = $1`,
    [id]
  );
  if (rowRes.rows.length === 0) return [id];

  const row = rowRes.rows[0];
  const ids = new Set([Number(row.ack_receipt_id)]);
  if (row.paired_ack_receipt_id != null) {
    ids.add(Number(row.paired_ack_receipt_id));
  } else {
    const parentRes = await runQuery(
      `SELECT ack_receipt_id
       FROM acknowledgement_receiptstbl
       WHERE paired_ack_receipt_id = $1
       LIMIT 1`,
      [id]
    );
    if (parentRes.rows[0]?.ack_receipt_id != null) {
      ids.add(Number(parentRes.rows[0].ack_receipt_id));
    }
  }
  return [...ids];
}

/** payment_amount + tip_amount for one acknowledgement receipt row. */
export function ackReceiptRowLineAmount(row) {
  return Number(row?.payment_amount || 0) + Number(row?.tip_amount || 0);
}

/**
 * Combined line total for SMS/email payment confirmation.
 * When the row is a Downpayment + Phase 1 leader or follower, sums both AR line amounts.
 *
 * @param {object} row — ack row with optional paired_* / parent_* join columns
 */
export function getAckReceiptCombinedLineTotal(row) {
  const self = ackReceiptRowLineAmount(row);
  if (row?.paired_ack_receipt_id != null) {
    return self + Number(row.paired_payment_amount || 0) + Number(row.paired_tip_amount || 0);
  }
  if (row?.parent_ack_receipt_id != null) {
    return self + Number(row.parent_payment_amount || 0) + Number(row.parent_tip_amount || 0);
  }
  return self;
}

/**
 * Resolve Downpayment + Phase 1 dual-row AR context for attach/enrollment.
 * Accepts either the downpayment leader or the Phase 1 follower row.
 *
 * @param {object} ackRow
 * @param {typeof query} [runQuery]
 * @returns {Promise<{ isDownpaymentPlusPhase1: boolean, leaderAck: object|null, phase1Ack: object|null }>}
 */
export async function resolveDownpaymentPhase1AckPair(ackRow, runQuery = query) {
  if (!ackRow) {
    return { isDownpaymentPlusPhase1: false, leaderAck: null, phase1Ack: null };
  }

  let leaderAck = ackRow;
  let phase1Ack = null;

  if (ackRow.paired_ack_receipt_id != null) {
    const phaseRes = await runQuery(
      `SELECT * FROM acknowledgement_receiptstbl WHERE ack_receipt_id = $1`,
      [ackRow.paired_ack_receipt_id]
    );
    phase1Ack = phaseRes.rows[0] || null;
  } else {
    const parentRes = await runQuery(
      `SELECT * FROM acknowledgement_receiptstbl
       WHERE paired_ack_receipt_id = $1
       LIMIT 1`,
      [ackRow.ack_receipt_id]
    );
    if (parentRes.rows[0]) {
      leaderAck = parentRes.rows[0];
      phase1Ack = ackRow;
    }
  }

  const isDownpaymentPlusPhase1 =
    String(leaderAck?.installment_option || '').trim().toLowerCase() === 'downpayment_plus_phase1' ||
    (leaderAck?.paired_ack_receipt_id != null && phase1Ack != null);

  return {
    isDownpaymentPlusPhase1,
    leaderAck: leaderAck || null,
    phase1Ack: phase1Ack || null,
  };
}
