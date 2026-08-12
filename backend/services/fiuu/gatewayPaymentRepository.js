import { query, getClient } from '../../config/database.js';

export async function insertGatewayPayment(row) {
  const result = await query(
    `INSERT INTO gateway_paymentstbl (
       gateway, orderid, target_type, target_id, student_id, branch_id, invoice_id,
       amount, currency, description_sent, status, metadata, raw_request, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13)
     RETURNING *`,
    [
      row.gateway || 'FIUU',
      row.orderid,
      row.target_type,
      row.target_id,
      row.student_id ?? null,
      row.branch_id ?? null,
      row.invoice_id ?? null,
      row.amount,
      row.currency || 'PHP',
      row.description_sent ?? null,
      JSON.stringify(row.metadata || {}),
      JSON.stringify(row.raw_request || {}),
      row.created_by ?? null,
    ]
  );
  return result.rows[0];
}

export async function findGatewayPaymentByOrderId(orderid, { forUpdate = false } = {}) {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const result = await query(
    `SELECT * FROM gateway_paymentstbl WHERE orderid = $1${lock}`,
    [String(orderid).trim()]
  );
  return result.rows[0] || null;
}

export async function updateGatewayPaymentStatus(gatewayPaymentId, patch) {
  const fields = [];
  const values = [];
  let i = 1;

  const allowed = [
    'status',
    'fiuu_tran_id',
    'fiuu_channel',
    'raw_webhook',
    'payment_id',
    'paid_at',
  ];

  for (const key of allowed) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = $${i++}`);
      if (key === 'raw_webhook') {
        values.push(JSON.stringify(patch[key]));
      } else {
        values.push(patch[key]);
      }
    }
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(gatewayPaymentId);

  const result = await query(
    `UPDATE gateway_paymentstbl SET ${fields.join(', ')} WHERE gateway_payment_id = $${i} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function withGatewayTransaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
