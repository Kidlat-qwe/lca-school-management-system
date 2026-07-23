/**
 * Applies a fulfilled merchandise stock request to branch inventory
 * (merchandisestbl). Used by:
 * - Superadmin manual approve (legacy / non-integrated)
 * - RHET Inventory webhook on stock_request.fulfilled
 *
 * Matching rule (same as Superadmin approve):
 * branch_id + merchandise_name + size + gender + type
 */

/**
 * Resolve a unit price when auto-creating a new merchandise row.
 * Prefer existing branch row price (caller should use add-qty path first),
 * then reference merchandise_id, then same item on any branch, else 0.
 */
async function resolvePrice(client, request) {
  if (request.merchandise_id) {
    const ref = await client.query(
      'SELECT price FROM merchandisestbl WHERE merchandise_id = $1',
      [request.merchandise_id]
    );
    if (ref.rows[0]?.price != null) {
      return parseFloat(ref.rows[0].price);
    }
  }

  const sameItem = await client.query(
    `SELECT price
     FROM merchandisestbl
     WHERE merchandise_name = $1
       AND (size = $2 OR (size IS NULL AND $2 IS NULL))
       AND (gender = $3 OR (gender IS NULL AND $3 IS NULL))
       AND (type = $4 OR (type IS NULL AND $4 IS NULL))
       AND price IS NOT NULL
     ORDER BY merchandise_id DESC
     LIMIT 1`,
    [request.merchandise_name, request.size || null, request.gender || null, request.type || null]
  );

  if (sameItem.rows[0]?.price != null) {
    return parseFloat(sameItem.rows[0].price);
  }

  return 0;
}

async function resolveImageUrl(client, request) {
  if (!request.merchandise_id) return null;
  const ref = await client.query(
    'SELECT image_url FROM merchandisestbl WHERE merchandise_id = $1',
    [request.merchandise_id]
  );
  return ref.rows[0]?.image_url || null;
}

/**
 * Add requested quantity to branch stock (create row if missing).
 *
 * @param {object} client - pg client inside a transaction
 * @param {object} request - merchandiserequestlogtbl row
 * @param {{ price?: number|null }} [options]
 * @returns {Promise<{ action: 'updated'|'created', merchandiseId: number|null, newQuantity: number }>}
 */
export async function applyMerchandiseRequestStock(client, request, options = {}) {
  const merchandiseGender = request.gender || null;
  const merchandiseType = request.type || null;
  const qtyToAdd = Number(request.requested_quantity) || 0;

  if (qtyToAdd <= 0) {
    throw new Error('Requested quantity must be greater than 0');
  }

  const merchandiseCheck = await client.query(
    `SELECT merchandise_id, quantity, price
     FROM merchandisestbl
     WHERE branch_id = $1
       AND merchandise_name = $2
       AND (size = $3 OR (size IS NULL AND $3 IS NULL))
       AND (gender = $4 OR (gender IS NULL AND $4 IS NULL))
       AND (type = $5 OR (type IS NULL AND $5 IS NULL))`,
    [
      request.requested_branch_id,
      request.merchandise_name,
      request.size || null,
      merchandiseGender,
      merchandiseType,
    ]
  );

  if (merchandiseCheck.rows.length > 0) {
    const existing = merchandiseCheck.rows[0];
    const newQuantity = (existing.quantity || 0) + qtyToAdd;
    const price =
      options.price != null && !Number.isNaN(Number(options.price))
        ? parseFloat(options.price)
        : existing.price;

    await client.query(
      'UPDATE merchandisestbl SET quantity = $1, price = COALESCE($2, price) WHERE merchandise_id = $3',
      [newQuantity, price, existing.merchandise_id]
    );

    return {
      action: 'updated',
      merchandiseId: existing.merchandise_id,
      newQuantity,
    };
  }

  const finalPrice =
    options.price != null && !Number.isNaN(Number(options.price))
      ? parseFloat(options.price)
      : await resolvePrice(client, request);
  const imageUrl = await resolveImageUrl(client, request);

  const inserted = await client.query(
    `INSERT INTO merchandisestbl (merchandise_name, size, quantity, price, branch_id, image_url, gender, type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING merchandise_id, quantity`,
    [
      request.merchandise_name,
      request.size || null,
      qtyToAdd,
      finalPrice,
      request.requested_branch_id,
      imageUrl,
      merchandiseGender,
      merchandiseType,
    ]
  );

  return {
    action: 'created',
    merchandiseId: inserted.rows[0].merchandise_id,
    newQuantity: inserted.rows[0].quantity,
  };
}
