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
