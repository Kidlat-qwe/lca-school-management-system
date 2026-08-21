/**
 * Applies a fulfilled merchandise stock request to branch inventory
 * (merchandisestbl). Used by:
 * - Superadmin manual approve (legacy / non-integrated)
 * - RHET Inventory webhook on stock_request.fulfilled
 *
 * Matching rule:
 * 1) Prefer request.merchandise_id when it belongs to the branch AND matches
 *    the request identity (uniform attrs or item_name/sku)
 * 2) Else match existing CMS type by RHET categoryName (Backpack / Shirt),
 *    never by RHET itemName or Logo as merchandise_name
 * 3) Under that type:
 *    - Uniforms (School/PE/Shirt LCA_SHIRT): match gender + type/Logo + size
 *      NEVER credit blank Gender/Type ("Unspecified piece") when identity present
 *    - Non-uniform / Learning Kit: match item_name and/or sku
 * 4) Only create a new row using categoryName as merchandise_name; store
 *    concrete product in item_name (+ sku) for non-uniforms, or gender/type/size
 *    for uniforms
 */

import {
  isUniformLikeCategory,
  localMerchandiseTypeNameCandidates,
  mapGenderToInventory,
  mapSizeToLocal,
  mapTypeToInventory,
  resolveLocalMerchandiseTypeName,
} from './inventoryFieldMapping.js';
import { isBundleStockRequest } from './bundleBom.js';

function isOpsAuditRemarks(remarks) {
  const text = String(remarks || '').trim();
  if (!text) return false;
  return (
    /^Ops\s+(seed|repair)\b/i.test(text) ||
    /(?:^|\|\s*)Ops\s+(seed|repair)\b/i.test(text)
  );
}

function looksLikeLegacyItemIdentityPair(itemName, sku) {
  if (!itemName || !sku) return false;
  if (isOpsAuditRemarks(itemName) || isOpsAuditRemarks(sku)) return false;
  if (itemName.length > 80 || sku.length > 80) return false;
  if (itemName.includes('—') || sku.includes('—')) return false;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(itemName)) return false;
  if (!/^[A-Z0-9][A-Z0-9-]*$/i.test(sku)) return false;
  return true;
}

/**
 * Parse legacy remarks "itemName | sku" (Learning Kit / early non-uniform).
 * Ignores ops audit notes that use " | " as a joiner between free-text lines.
 */
export function parseLegacyItemIdentityFromRemarks(remarks) {
  const text = String(remarks || '').trim();
  if (!text || !text.includes('|') || isOpsAuditRemarks(text)) {
    return { itemName: null, sku: null };
  }
  const [left, ...rest] = text.split('|');
  const itemName = String(left || '').trim() || null;
  const sku = String(rest.join('|') || '').trim() || null;
  if (!looksLikeLegacyItemIdentityPair(itemName, sku)) {
    return { itemName: null, sku: null };
  }
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
 * Blank / "Unspecified piece" uniform shell: no gender, no type/Logo, no real size.
 * These must NEVER absorb fulfills when the request has uniform identity.
 */
export function isBlankUniformIdentityRow(row) {
  return (
    !normalizeAttr(row?.gender) &&
    !normalizeAttr(row?.type) &&
    !normalizeSizeAttr(row?.size)
  );
}

/** True when request carries at least one uniform variation attribute. */
export function wantsUniformIdentity(request) {
  return Boolean(
    normalizeAttr(request?.gender) ||
      normalizeAttr(request?.type) ||
      normalizeSizeAttr(request?.size)
  );
}

/**
 * Match stock row to uniform variation (gender + type/Logo + size).
 * Blank shells never match when identity is requested.
 */
export function stockRowMatchesUniformIdentity(row, { gender, type, size } = {}) {
  if (!wantsUniformIdentity({ gender, type, size })) return false;
  if (isBlankUniformIdentityRow(row)) return false;
  return (
    sizeCompatible(size, row?.size) &&
    genderCompatible(gender, row?.gender) &&
    attrsEqual(type, row?.type)
  );
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

/** Size blanks include UI "N/A" / "n/a". */
function normalizeSizeAttr(value) {
  const v = normalizeAttr(value);
  if (!v) return null;
  if (v.toLowerCase() === 'n/a' || v.toLowerCase() === 'na') return null;
  return v;
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
  const req = normalizeSizeAttr(requestSize);
  const row = normalizeSizeAttr(rowSize);
  if (req == null && row == null) return true;
  if (req == null || row == null) return false;
  const a = (mapSizeToLocal(req) || req).toLowerCase();
  const b = (mapSizeToLocal(row) || row).toLowerCase();
  return a === b || req.toLowerCase() === row.toLowerCase();
}

/**
 * Find an existing branch stock row for this request (type + variation / item).
 *
 * Uniforms with gender/type/size:
 * - NEVER fall back to blank Gender/Type ("Unspecified piece") shells
 * - merchandise_id is only trusted when the row matches those attrs
 *
 * Non-uniform / Learning Kit with itemName/sku:
 * - NEVER fall back to “first row under type” or empty shell when identity is present
 * - merchandise_id is only trusted when it matches the same item identity
 */
export async function findExistingMerchandiseStockRow(client, request) {
  const run = typeof client === 'function' ? client : client.query.bind(client);
  const branchId = request.requested_branch_id;

  const nameCandidates = localMerchandiseTypeNameCandidates(request);
  const preferredName =
    resolveLocalMerchandiseTypeName(request) || nameCandidates[0] || null;
  const type = normalizeAttr(request.type);
  const gender = normalizeAttr(request.gender);
  const size = normalizeSizeAttr(request.size);
  const itemName = normalizeAttr(request.inventory_item_name || request.item_name);
  const itemSku = normalizeAttr(
    request.inventory_requested_sku || request.inventory_matched_sku || request.sku
  );
  const isKit = isBundleStockRequest({
    categoryName: request.inventory_category_name || preferredName,
    inventory_components_json: request.inventory_components_json,
    merchandise_name: request.merchandise_name,
  });
  const isUniform =
    isUniformLikeCategory(preferredName) ||
    isUniformLikeCategory(request.inventory_category_name);
  const wantsItemIdentity = Boolean(itemName || itemSku);
  const wantsUniformAttrs = wantsUniformIdentity({ gender, type, size });
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
      if (isItemKeyed) {
        if (!wantsItemIdentity) {
          return row;
        }
        if (stockRowMatchesItemIdentity(row, { itemName, sku: itemSku })) {
          return row;
        }
        // Wrong non-uniform row linked at submit (common with empty shell) — ignore id.
      } else if (isUniform) {
        if (!wantsUniformAttrs) {
          return row;
        }
        // Only trust merchandise_id when Gender + Type/Logo + Size match.
        // Blank "Unspecified piece" shells must never absorb Shirt/uniform fulfills.
        if (stockRowMatchesUniformIdentity(row, { gender, type, size })) {
          return row;
        }
      } else {
        return row;
      }
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
        isBlankUniformIdentityRow(row) &&
        !getStockRowItemName(row) &&
        !getStockRowSku(row) &&
        !normalizeAttr(row.remarks)
    );
    if (emptyShell && rowsRes.rows.length === 1) return emptyShell;
    return null;
  }

  // Uniforms: exact gender + type/Logo + size only
  if (wantsUniformAttrs) {
    const exact = rowsRes.rows.find((row) =>
      stockRowMatchesUniformIdentity(row, { gender, type, size })
    );
    if (exact) return exact;
    // FORBIDDEN: blank Unspecified-piece / first Shirt row fallback
    return null;
  }

  // Legacy uniform request with no attrs — allow single empty shell only
  const emptyUniformShell = rowsRes.rows.find((row) => isBlankUniformIdentityRow(row));
  if (emptyUniformShell && rowsRes.rows.length === 1) return emptyUniformShell;
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
  const isKit = isBundleStockRequest({
    categoryName: categoryForAttrs,
    inventory_components_json: request.inventory_components_json,
    merchandise_name: typeName,
  });
  const isUniform = isUniformLikeCategory(categoryForAttrs);
  const stockItemName = normalizeAttr(request.inventory_item_name || request.item_name);
  const stockSku = normalizeAttr(
    request.inventory_requested_sku || request.inventory_matched_sku || request.sku
  );

  const merchandiseGender = isUniform
    ? normalizeAttr(mapGenderToInventory(request.gender) || request.gender)
    : null;
  // Learning Kit / non-uniform: keep type NULL (CHECK only allows uniform pieces).
  const merchandiseType = isUniform
    ? normalizeAttr(mapTypeToInventory(request.type, categoryForAttrs) || request.type)
    : null;
  const merchandiseSize = isUniform
    ? normalizeSizeAttr(mapSizeToLocal(request.size) || request.size)
    : null;

  // Prefer dedicated columns; keep remarks free for notes (do not force identity into remarks).
  const merchandiseItemName = isUniform ? null : stockItemName;
  const merchandiseSku = isUniform ? null : stockSku;

  if (isUniform && (!merchandiseGender || !merchandiseType || !merchandiseSize)) {
    throw new Error(
      `Cannot apply uniform stock for "${typeName}" without gender, type, and size. ` +
        'Refusing to credit an Unspecified / blank Gender·Type row.'
    );
  }

  if (!isUniform && !isKit && !merchandiseItemName && !merchandiseSku) {
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

  // Hard ban: never credit blank aggregators when identity exists
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
  if (
    rowToUpdate &&
    isUniform &&
    wantsUniformIdentity({
      gender: merchandiseGender,
      type: merchandiseType,
      size: merchandiseSize,
    }) &&
    isBlankUniformIdentityRow(rowToUpdate)
  ) {
    console.warn(
      `[applyMerchandiseRequestStock] Refusing blank uniform shell ${rowToUpdate.merchandise_id} for ` +
        `${typeName} / ${merchandiseGender} / ${merchandiseType} / ${merchandiseSize} — will create identified row`
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
      // Uniform: keep gender/type/size populated (never leave Unspecified piece attrs blank)
      await client.query(
        `UPDATE merchandisestbl
         SET quantity = $1,
             price = COALESCE($2, price),
             gender = COALESCE(NULLIF(TRIM(COALESCE(gender, '')), ''), $4),
             type = COALESCE(NULLIF(TRIM(COALESCE(type, '')), ''), $5),
             size = COALESCE(NULLIF(TRIM(COALESCE(size, '')), ''), $6)
         WHERE merchandise_id = $3`,
        [
          newQuantity,
          price,
          rowToUpdate.merchandise_id,
          merchandiseGender,
          merchandiseType,
          merchandiseSize,
        ]
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
    const msg = String(insertError?.message || '');
    if (isUniform && (msg.includes('check_type') || msg.includes('check_request_type'))) {
      throw new Error(
        `Cannot save uniform type "${merchandiseType}" on branch stock. ` +
          'Apply migration 134_allow_lca_shirt_logo_types.sql (Logo 1 / Logo 2) and ' +
          '137_allow_uniform_set_type.sql (Set), then retry fulfill. ' +
          `Original: ${msg}`
      );
    }
    // Migration 133 not applied yet — fall back to remarks identity (Learning Kit legacy)
    const missingItemCols =
      msg.includes('item_name') || msg.includes('sku');
    if (!missingItemCols) throw insertError;

    if (isUniform && (!merchandiseGender || !merchandiseType || !merchandiseSize)) {
      throw new Error(
        `Refusing legacy insert of blank uniform row for "${typeName}". ` +
          'Gender, type, and size are required.'
      );
    }

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

/**
 * Reverse a previously delivered stock credit (RHET RETURNED after DELIVERED).
 * Subtracts requested_quantity from the matching branch row; quantity floors at 0.
 * Does not delete the stock row.
 *
 * @returns {Promise<{ action: 'reversed'|'noop', merchandiseId: number|null, newQuantity: number|null, qtyRemoved: number }>}
 */
export async function reverseMerchandiseRequestStock(client, request) {
  const qtyToRemove = Number(request.requested_quantity) || 0;
  if (qtyToRemove <= 0) {
    return { action: 'noop', merchandiseId: null, newQuantity: null, qtyRemoved: 0 };
  }

  const typeName = resolveLocalMerchandiseTypeName(request);
  if (!typeName) {
    throw new Error(
      'Cannot reverse stock: missing RHET categoryName / local merchandise type.'
    );
  }

  const categoryForAttrs =
    String(request.inventory_category_name || '').trim() || typeName;
  const isUniform = isUniformLikeCategory(categoryForAttrs);
  const stockItemName = normalizeAttr(request.inventory_item_name || request.item_name);
  const stockSku = normalizeAttr(
    request.inventory_requested_sku || request.inventory_matched_sku || request.sku
  );

  const merchandiseGender = isUniform
    ? normalizeAttr(mapGenderToInventory(request.gender) || request.gender)
    : null;
  const merchandiseType = isUniform
    ? normalizeAttr(mapTypeToInventory(request.type, categoryForAttrs) || request.type)
    : null;
  const merchandiseSize = isUniform
    ? normalizeSizeAttr(mapSizeToLocal(request.size) || request.size)
    : null;

  const requestForMatch = {
    ...request,
    merchandise_name: typeName,
    gender: merchandiseGender,
    type: merchandiseType,
    size: merchandiseSize,
    inventory_item_name: isUniform ? null : stockItemName,
    inventory_requested_sku: isUniform ? null : stockSku,
  };

  const existing = await findExistingMerchandiseStockRow(client, requestForMatch);
  if (!existing?.merchandise_id) {
    console.warn(
      `[reverseMerchandiseRequestStock] No matching stock row for request ${request.request_id} — nothing to reverse`
    );
    return { action: 'noop', merchandiseId: null, newQuantity: null, qtyRemoved: 0 };
  }

  const currentQty = Number(existing.quantity) || 0;
  const remove = Math.min(currentQty, qtyToRemove);
  const newQuantity = Math.max(0, currentQty - remove);

  await client.query(
    `UPDATE merchandisestbl SET quantity = $1 WHERE merchandise_id = $2`,
    [newQuantity, existing.merchandise_id]
  );

  return {
    action: 'reversed',
    merchandiseId: existing.merchandise_id,
    newQuantity,
    qtyRemoved: remove,
  };
}

/**
 * Deduct on-hand qty for Branch Admin Return Stock (row locked FOR UPDATE).
 * Quantity must belong to the admin's branch and be >= requested return qty.
 */
export async function deductMerchandiseStockQuantity(client, {
  merchandiseId,
  branchId,
  quantity,
}) {
  const qty = Number(quantity) || 0;
  if (!merchandiseId || qty <= 0) {
    const err = new Error('Return quantity must be at least 1');
    err.code = 'INVALID_RETURN_QTY';
    err.status = 400;
    throw err;
  }

  const locked = await client.query(
    `SELECT merchandise_id, merchandise_name, quantity, gender, type, size,
            item_name, sku, branch_id, remarks
     FROM merchandisestbl
     WHERE merchandise_id = $1
     FOR UPDATE`,
    [merchandiseId]
  );
  const row = locked.rows[0];
  if (!row) {
    const err = new Error('Merchandise stock row not found');
    err.code = 'MERCHANDISE_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (Number(row.branch_id) !== Number(branchId)) {
    const err = new Error('Stock row does not belong to this branch');
    err.code = 'BRANCH_MISMATCH';
    err.status = 403;
    throw err;
  }

  const current = Number(row.quantity) || 0;
  if (current < qty) {
    const err = new Error(
      `Not enough stock to return (${row.merchandise_name}). Available: ${current}, requested: ${qty}`
    );
    err.code = 'INSUFFICIENT_STOCK';
    err.status = 400;
    throw err;
  }

  const newQuantity = current - qty;
  await client.query(
    'UPDATE merchandisestbl SET quantity = $1 WHERE merchandise_id = $2',
    [newQuantity, merchandiseId]
  );

  return {
    ...row,
    previousQuantity: current,
    newQuantity,
    qtyRemoved: qty,
  };
}

/** Restore qty after a failed Return Stock forward (add back, do not overwrite). */
export async function restoreMerchandiseStockQuantity(client, { merchandiseId, quantity }) {
  const qty = Number(quantity) || 0;
  if (!merchandiseId || qty <= 0) return;
  await client.query(
    'UPDATE merchandisestbl SET quantity = COALESCE(quantity, 0) + $1 WHERE merchandise_id = $2',
    [qty, merchandiseId]
  );
}
