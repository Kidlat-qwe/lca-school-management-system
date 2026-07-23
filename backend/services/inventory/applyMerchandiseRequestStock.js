/**
 * Applies a fulfilled merchandise stock request to branch inventory
 * (merchandisestbl). Used by:
 * - Superadmin manual approve (legacy / non-integrated)
 * - RHET Inventory webhook on stock_request.fulfilled
 *
 * Matching rule:
 * 1) Prefer request.merchandise_id when it belongs to the branch
 * 2) Else match existing CMS type by RHET categoryName (Backpack), never by
 *    RHET itemName (lca-backpack)
 * 3) Under that type, match stock row by size + gender + type (uniforms)
 * 4) Only create a new row using categoryName as merchandise_name
 */

import {
  isUniformLikeCategory,
  localMerchandiseTypeNameCandidates,
  mapGenderToLocal,
  mapSizeToLocal,
  mapTypeToInventory,
  resolveLocalMerchandiseTypeName,
} from './inventoryFieldMapping.js';

/**
 * Resolve a unit price when auto-creating a new merchandise row.
 * Prefer existing branch row price (caller should use add-qty path first),
 * then reference merchandise_id, then same item on any branch, else 0.
 */
async function resolvePrice(client, request, typeName) {
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
     WHERE LOWER(TRIM(merchandise_name)) = LOWER(TRIM($1))
       AND (size = $2 OR (size IS NULL AND $2 IS NULL))
       AND (gender = $3 OR (gender IS NULL AND $3 IS NULL))
       AND (type = $4 OR (type IS NULL AND $4 IS NULL))
       AND price IS NOT NULL
     ORDER BY merchandise_id DESC
     LIMIT 1`,
    [typeName, request.size || null, request.gender || null, request.type || null]
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

function normalizeAttr(value) {
  const v = value == null || value === '' ? null : String(value).trim();
  return v || null;
}

function attrsEqual(a, b) {
  const left = normalizeAttr(a);
  const right = normalizeAttr(b);
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return left.toLowerCase() === right.toLowerCase();
}

function genderCompatible(requestGender, rowGender) {
  const req = normalizeAttr(requestGender);
  const row = normalizeAttr(rowGender);
  if (req == null && row == null) return true;
  if (req == null || row == null) return false;
  const male = new Set(['male', 'men', 'boys']);
  const female = new Set(['female', 'women', 'girls']);
  const a = req.toLowerCase();
  const b = row.toLowerCase();
  if (a === b) return true;
  if (male.has(a) && male.has(b)) return true;
  if (female.has(a) && female.has(b)) return true;
  return false;
}

function sizeCompatible(requestSize, rowSize) {
  const req = normalizeAttr(requestSize);
  const row = normalizeAttr(rowSize);
  if (req == null && row == null) return true;
  if (req == null || row == null) return false;
  const a = (mapSizeToLocal(req) || req).toLowerCase();
  const b = (mapSizeToLocal(row) || row).toLowerCase();
  return a === b || req.toLowerCase() === row.toLowerCase();
}

/**
 * Find an existing branch stock row for this request (type + variation).
 */
export async function findExistingMerchandiseStockRow(client, request) {
  const run = typeof client === 'function' ? client : client.query.bind(client);
  const branchId = request.requested_branch_id;

  if (request.merchandise_id) {
    const byId = await run(
      `SELECT merchandise_id, merchandise_name, quantity, price, size, gender, type
       FROM merchandisestbl
       WHERE merchandise_id = $1
         AND branch_id = $2`,
      [request.merchandise_id, branchId]
    );
    if (byId.rows[0]) return byId.rows[0];
  }

  const nameCandidates = localMerchandiseTypeNameCandidates(request);
  if (nameCandidates.length === 0) return null;

  const preferredName = resolveLocalMerchandiseTypeName(request) || nameCandidates[0];
  const type = normalizeAttr(request.type);

  const rowsRes = await run(
    `SELECT merchandise_id, merchandise_name, quantity, price, size, gender, type
     FROM merchandisestbl
     WHERE branch_id = $1
       AND LOWER(TRIM(merchandise_name)) = ANY($2::text[])
     ORDER BY
       CASE WHEN LOWER(TRIM(merchandise_name)) = LOWER(TRIM($3)) THEN 0 ELSE 1 END,
       merchandise_id DESC`,
    [
      branchId,
      nameCandidates.map((n) => String(n).trim().toLowerCase()),
      preferredName,
    ]
  );

  const exact = rowsRes.rows.find(
    (row) =>
      sizeCompatible(request.size, row.size) &&
      genderCompatible(request.gender, row.gender) &&
      attrsEqual(type, row.type)
  );
  if (exact) return exact;

  const categoryHint =
    resolveLocalMerchandiseTypeName(request) ||
    String(request.inventory_category_name || '').trim();
  const size = normalizeAttr(request.size);
  const gender = normalizeAttr(request.gender);

  if (categoryHint && !isUniformLikeCategory(categoryHint) && !size && !gender && !type) {
    if (rowsRes.rows.length === 1) return rowsRes.rows[0];
    const preferred = rowsRes.rows.find(
      (r) => String(r.merchandise_name || '').trim().toLowerCase() === preferredName.toLowerCase()
    );
    if (preferred) return preferred;
  }

  return null;
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
  const qtyToAdd = Number(request.requested_quantity) || 0;

  if (qtyToAdd <= 0) {
    throw new Error('Requested quantity must be greater than 0');
  }

  const typeName = resolveLocalMerchandiseTypeName(request);
  if (!typeName) {
    throw new Error(
      'Cannot apply stock: missing RHET categoryName / local merchandise type. Refusing to create a type from itemName.'
    );
  }

  const categoryForAttrs =
    String(request.inventory_category_name || '').trim() || typeName;
  const merchandiseGender = isUniformLikeCategory(categoryForAttrs)
    ? normalizeAttr(mapGenderToLocal(request.gender) || request.gender)
    : null;
  const merchandiseType = isUniformLikeCategory(categoryForAttrs)
    ? normalizeAttr(mapTypeToInventory(request.type, categoryForAttrs) || request.type)
    : null;
  const merchandiseSize = isUniformLikeCategory(categoryForAttrs)
    ? normalizeAttr(mapSizeToLocal(request.size) || request.size)
    : null;

  const requestForMatch = {
    ...request,
    merchandise_name: typeName,
    gender: merchandiseGender,
    type: merchandiseType,
    size: merchandiseSize,
  };

  const existing = await findExistingMerchandiseStockRow(client, requestForMatch);

  if (existing) {
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
      merchandiseName: existing.merchandise_name,
    };
  }

  const finalPrice =
    options.price != null && !Number.isNaN(Number(options.price))
      ? parseFloat(options.price)
      : await resolvePrice(client, requestForMatch, typeName);
  const imageUrl = await resolveImageUrl(client, request);

  const inserted = await client.query(
    `INSERT INTO merchandisestbl (merchandise_name, size, quantity, price, branch_id, image_url, gender, type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING merchandise_id, quantity, merchandise_name`,
    [
      typeName,
      merchandiseSize,
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
    merchandiseName: inserted.rows[0].merchandise_name,
  };
}
