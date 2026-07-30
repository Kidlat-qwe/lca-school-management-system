/**
 * Applies a fulfilled merchandise stock request to branch inventory
 * (merchandisestbl). Used by:
 * - Superadmin manual approve (legacy / non-integrated)
 * - RHET Inventory webhook on stock_request.fulfilled
 *
 * Matching rule:
 * 1) Prefer request.merchandise_id when it belongs to the branch
 * 2) Else match existing CMS type by RHET categoryName (Backpack), never by
 *    RHET itemName (lca-backpack) as merchandise_name
 * 3) Under that type:
 *    - Uniforms: match size + gender + type
 *    - Non-uniform / Learning Kit: match item_name and/or sku
 * 4) Only create a new row using categoryName as merchandise_name; store
 *    concrete product in item_name (+ sku)
 */

import {
  isLearningKitCategory,
  isUniformLikeCategory,
  localMerchandiseTypeNameCandidates,
  mapGenderToLocal,
  mapSizeToLocal,
  mapTypeToInventory,
  resolveLocalMerchandiseTypeName,
} from './inventoryFieldMapping.js';

/**
 * Parse legacy remarks "itemName | sku" (Learning Kit / early non-uniform).
 */
export function parseLegacyItemIdentityFromRemarks(remarks) {
  const text = String(remarks || '').trim();
  if (!text || !text.includes('|')) {
    return { itemName: null, sku: null };
  }
  const [left, ...rest] = text.split('|');
  const itemName = String(left || '').trim() || null;
  const sku = String(rest.join('|') || '').trim() || null;
  return { itemName, sku };
}

export function getStockRowItemName(row) {
  const direct = normalizeAttr(row?.item_name);
  if (direct) return direct;
  return parseLegacyItemIdentityFromRemarks(row?.remarks).itemName;
}

export function getStockRowSku(row) {
  const direct = normalizeAttr(row?.sku);
  if (direct) return direct;
  return parseLegacyItemIdentityFromRemarks(row?.remarks).sku;
}

/**
 * True when a branch stock row matches the requested concrete item.
 * Blank (null item_name AND null sku) rows NEVER match when a concrete
 * identity is requested — that is the anonymous Workbooks/Backpack aggregator bug.
 */
export function stockRowMatchesItemIdentity(row, { itemName, sku } = {}) {
  const wantName = normalizeAttr(itemName);
  const wantSku = normalizeAttr(sku);
  if (!wantName && !wantSku) return false;

  const rowName = getStockRowItemName(row);
  const rowSku = getStockRowSku(row);

  // Anonymous / blank aggregator row — never a match when we have identity
  if (!rowName && !rowSku) return false;

  if (wantSku && rowSku && wantSku.toLowerCase() === rowSku.toLowerCase()) {
    return true;
  }
  if (wantName && rowName && wantName.toLowerCase() === rowName.toLowerCase()) {
    return true;
  }
  return false;
}

/** True when stock row has no concrete item identity. */
export function isBlankItemIdentityRow(row) {
  return !getStockRowItemName(row) && !getStockRowSku(row);
}

/**
 * Resolve a unit price when auto-creating a new merchandise row.
 * Prefer existing branch row price (caller should use add-qty path first),
 * then reference merchandise_id, then same item on any branch, else 0.
 */
async function resolvePrice(client, request, typeName, itemName, sku) {
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
       AND (
         ($5::text IS NULL AND $6::text IS NULL)
         OR LOWER(TRIM(COALESCE(item_name, ''))) = LOWER(TRIM(COALESCE($5::text, '')))
         OR LOWER(TRIM(COALESCE(sku, ''))) = LOWER(TRIM(COALESCE($6::text, '')))
       )
       AND price IS NOT NULL
     ORDER BY merchandise_id DESC
     LIMIT 1`,
    [
      typeName,
      request.size || null,
      request.gender || null,
      request.type || null,
      itemName || null,
      sku || null,
    ]
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
 * Find an existing branch stock row for this request (type + variation / item).
 *
 * Non-uniform / Learning Kit with itemName/sku:
 * - NEVER fall back to “first row under type” or empty shell when identity is present
 *   (that caused every Workbooks/Backpack request to credit the same blank row).
 * - merchandise_id is only trusted when it matches the same item identity.
 */
export async function findExistingMerchandiseStockRow(client, request) {
  const run = typeof client === 'function' ? client : client.query.bind(client);
  const branchId = request.requested_branch_id;

  const nameCandidates = localMerchandiseTypeNameCandidates(request);
  const preferredName =
    resolveLocalMerchandiseTypeName(request) || nameCandidates[0] || null;
  const type = normalizeAttr(request.type);
  const itemName = normalizeAttr(request.inventory_item_name || request.item_name);
  const itemSku = normalizeAttr(
    request.inventory_requested_sku || request.inventory_matched_sku || request.sku
  );
  const isKit =
    isLearningKitCategory(preferredName) ||
    isLearningKitCategory(request.inventory_category_name) ||
    isLearningKitCategory(request.merchandise_name);
  const isUniform =
    isUniformLikeCategory(preferredName) ||
    isUniformLikeCategory(request.inventory_category_name);
  const wantsItemIdentity = Boolean(itemName || itemSku);
  const isItemKeyed = isKit || !isUniform;

  if (request.merchandise_id) {
    let byId;
    try {
      byId = await run(
        `SELECT merchandise_id, merchandise_name, quantity, price, size, gender, type, remarks, item_name, sku
         FROM merchandisestbl
         WHERE merchandise_id = $1
           AND branch_id = $2`,
        [request.merchandise_id, branchId]
      );
    } catch (selectError) {
      if (
        !String(selectError?.message || '').includes('item_name') &&
        !String(selectError?.message || '').includes('sku')
      ) {
        throw selectError;
      }
      byId = await run(
        `SELECT merchandise_id, merchandise_name, quantity, price, size, gender, type, remarks
         FROM merchandisestbl
         WHERE merchandise_id = $1
           AND branch_id = $2`,
        [request.merchandise_id, branchId]
      );
    }
    const row = byId.rows[0];
    if (row) {
      if (!isItemKeyed || !wantsItemIdentity) {
        return row;
      }
      // Only trust merchandise_id when it is the same concrete item (or legacy empty shell
      // is NOT accepted here — identity present ⇒ must match item_name/sku).
      if (stockRowMatchesItemIdentity(row, { itemName, sku: itemSku })) {
        return row;
      }
      // Wrong non-uniform row linked at submit (common with empty shell) — ignore id.
    }
  }

  if (nameCandidates.length === 0) return null;

  let rowsRes;
  try {
    rowsRes = await run(
      `SELECT merchandise_id, merchandise_name, quantity, price, size, gender, type, remarks, item_name, sku
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
  } catch (selectError) {
    if (
      !String(selectError?.message || '').includes('item_name') &&
      !String(selectError?.message || '').includes('sku')
    ) {
      throw selectError;
    }
    rowsRes = await run(
      `SELECT merchandise_id, merchandise_name, quantity, price, size, gender, type, remarks
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
  }

  // Non-uniform + Learning Kit: match concrete item_name / sku only
  if (isItemKeyed) {
    if (wantsItemIdentity) {
      const byIdentity = rowsRes.rows.find((row) =>
        stockRowMatchesItemIdentity(row, { itemName, sku: itemSku })
      );
      if (byIdentity) return byIdentity;
      // FORBIDDEN: empty-shell / first-row fallback when item identity is present
      return null;
    }

    // Legacy request with no itemName/sku — allow single empty shell only
    const emptyShell = rowsRes.rows.find(
      (row) =>
        !normalizeAttr(row.type) &&
        !normalizeAttr(row.size) &&
        !normalizeAttr(row.gender) &&
        !getStockRowItemName(row) &&
        !getStockRowSku(row) &&
        !normalizeAttr(row.remarks)
    );
    if (emptyShell && rowsRes.rows.length === 1) return emptyShell;
    return null;
  }

  const exact = rowsRes.rows.find(
    (row) =>
      sizeCompatible(request.size, row.size) &&
      genderCompatible(request.gender, row.gender) &&
      attrsEqual(type, row.type)
  );
  if (exact) return exact;

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
  const isKit = isLearningKitCategory(categoryForAttrs) || isLearningKitCategory(typeName);
  const isUniform = isUniformLikeCategory(categoryForAttrs);
  const stockItemName = normalizeAttr(request.inventory_item_name || request.item_name);
  const stockSku = normalizeAttr(
    request.inventory_requested_sku || request.inventory_matched_sku || request.sku
  );

  const merchandiseGender = isUniform
    ? normalizeAttr(mapGenderToLocal(request.gender) || request.gender)
    : null;
  // Learning Kit / non-uniform: keep type NULL (CHECK only allows uniform pieces).
  const merchandiseType = isUniform
    ? normalizeAttr(mapTypeToInventory(request.type, categoryForAttrs) || request.type)
    : null;
  const merchandiseSize = isUniform
    ? normalizeAttr(mapSizeToLocal(request.size) || request.size)
    : null;

  // Prefer dedicated columns; keep remarks free for notes (do not force identity into remarks).
  const merchandiseItemName = isUniform ? null : stockItemName;
  const merchandiseSku = isUniform ? null : stockSku;

  if (!isUniform && !merchandiseItemName && !merchandiseSku) {
    throw new Error(
      `Cannot apply non-uniform stock for "${typeName}" without itemName/sku. ` +
        'Refusing to credit an anonymous stock row.'
    );
  }

  const requestForMatch = {
    ...request,
    merchandise_name: typeName,
    gender: merchandiseGender,
    type: merchandiseType,
    size: merchandiseSize,
    inventory_item_name: merchandiseItemName,
    inventory_requested_sku: merchandiseSku,
  };

  const existing = await findExistingMerchandiseStockRow(client, requestForMatch);

  // Hard ban: never credit a blank non-uniform aggregator when identity exists
  let rowToUpdate = existing;
  if (
    rowToUpdate &&
    !isUniform &&
    (merchandiseItemName || merchandiseSku) &&
    isBlankItemIdentityRow(rowToUpdate)
  ) {
    console.warn(
      `[applyMerchandiseRequestStock] Refusing blank stock row ${rowToUpdate.merchandise_id} for ` +
        `${typeName} / ${merchandiseItemName || ''} / ${merchandiseSku || ''} — will create identified row`
    );
    rowToUpdate = null;
  }

  if (rowToUpdate) {
    const newQuantity = (rowToUpdate.quantity || 0) + qtyToAdd;
    const price =
      options.price != null && !Number.isNaN(Number(options.price))
        ? parseFloat(options.price)
        : rowToUpdate.price;

    if (!isUniform) {
      try {
        await client.query(
          `UPDATE merchandisestbl
           SET quantity = $1,
               price = COALESCE($2, price),
               item_name = COALESCE(NULLIF(TRIM(COALESCE(item_name, '')), ''), $3),
               sku = COALESCE(NULLIF(TRIM(COALESCE(sku, '')), ''), $4)
           WHERE merchandise_id = $5`,
          [newQuantity, price, merchandiseItemName, merchandiseSku, rowToUpdate.merchandise_id]
        );
      } catch (updateError) {
        if (
          !String(updateError?.message || '').includes('item_name') &&
          !String(updateError?.message || '').includes('sku')
        ) {
          throw updateError;
        }
        const legacyRemarks =
          [merchandiseItemName, merchandiseSku].filter(Boolean).join(' | ') || null;
        await client.query(
          `UPDATE merchandisestbl
           SET quantity = $1,
               price = COALESCE($2, price),
               remarks = COALESCE(NULLIF(TRIM(COALESCE(remarks, '')), ''), $3)
           WHERE merchandise_id = $4`,
          [newQuantity, price, legacyRemarks, rowToUpdate.merchandise_id]
        );
      }
    } else {
      await client.query(
        'UPDATE merchandisestbl SET quantity = $1, price = COALESCE($2, price) WHERE merchandise_id = $3',
        [newQuantity, price, rowToUpdate.merchandise_id]
      );
    }

    return {
      action: 'updated',
      merchandiseId: rowToUpdate.merchandise_id,
      newQuantity,
      merchandiseName: rowToUpdate.merchandise_name,
    };
  }

  const finalPrice =
    options.price != null && !Number.isNaN(Number(options.price))
      ? parseFloat(options.price)
      : await resolvePrice(
          client,
          requestForMatch,
          typeName,
          merchandiseItemName,
          merchandiseSku
        );
  const imageUrl = await resolveImageUrl(client, request);

  try {
    const inserted = await client.query(
      `INSERT INTO merchandisestbl
         (merchandise_name, size, quantity, price, branch_id, image_url, gender, type, remarks, item_name, sku)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        null,
        merchandiseItemName,
        merchandiseSku,
      ]
    );

    return {
      action: 'created',
      merchandiseId: inserted.rows[0].merchandise_id,
      newQuantity: inserted.rows[0].quantity,
      merchandiseName: inserted.rows[0].merchandise_name,
    };
  } catch (insertError) {
    // Migration 133 not applied yet — fall back to remarks identity (Learning Kit legacy)
    const missingItemCols =
      String(insertError?.message || '').includes('item_name') ||
      String(insertError?.message || '').includes('sku');
    if (!missingItemCols) throw insertError;

    const legacyRemarks =
      !isUniform && (merchandiseItemName || merchandiseSku)
        ? [merchandiseItemName, merchandiseSku].filter(Boolean).join(' | ')
        : null;

    const inserted = await client.query(
      `INSERT INTO merchandisestbl
         (merchandise_name, size, quantity, price, branch_id, image_url, gender, type, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        legacyRemarks,
      ]
    );

    return {
      action: 'created',
      merchandiseId: inserted.rows[0].merchandise_id,
      newQuantity: inserted.rows[0].quantity,
      merchandiseName: inserted.rows[0].merchandise_name,
    };
  }
}
