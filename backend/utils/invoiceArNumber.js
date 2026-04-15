/**
 * AR numbers: YY + 4-digit sequence per calendar year (e.g. 260001), shared by
 * invoicestbl.invoice_ar_number and acknowledgement_receiptstbl.ack_receipt_number.
 */

/**
 * Allocate the next AR number for the current calendar year (server local time).
 * Uses ar_number_counter (see migration 090). Must be called within a transaction
 * when used with other inserts so rollback restores consistency.
 *
 * @param {import('pg').PoolClient} client
 * @returns {Promise<string>} e.g. "260001"
 */
export async function allocateNextArStyleNumber(client) {
  const year = new Date().getFullYear();
  const r = await client.query(
    `INSERT INTO ar_number_counter (year, last_value)
     VALUES ($1::smallint, 1)
     ON CONFLICT (year) DO UPDATE
     SET last_value = ar_number_counter.last_value + 1
     RETURNING last_value`,
    [year]
  );
  const seq = r.rows[0].last_value;
  const yy = String(year % 100).padStart(2, '0');
  const suffix = String(seq).padStart(4, '0');
  return `${yy}${suffix}`;
}

/**
 * INSERT into invoicestbl with a generated invoice_ar_number.
 * @param {import('pg').PoolClient} client
 * @param {string} sql - Must list invoice_ar_number as the last column and use $N for the last placeholder.
 * @param {unknown[]} baseParams - Params for $1 .. $(n-1); invoice_ar_number is appended.
 */
export async function insertInvoiceWithArNumber(client, sql, baseParams) {
  const arNum = await allocateNextArStyleNumber(client);
  const result = await client.query(sql, [...baseParams, arNum]);
  return result.rows[0];
}
