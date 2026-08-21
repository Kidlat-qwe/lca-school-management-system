/**
 * Package-included merchandise entitlements: issue/keep (default) or swap.
 * UI labels: Keep (`issue`) | Swap. `waive` kept for legacy pending lines only.
 * Used at enroll Configure Merchandise for non-uniform freebies (e.g. Backpack).
 * No DB schema — persisted on enroll payload + invoice MERCH_PENDING JSON.
 */

import { isMerchandiseTypeShellRow } from '../merchandiseRequests/createTypeCategory';
import {
  isUniformStockCategory,
  formatMerchandiseVariantOptionLabel,
} from '../merchandiseStock';

export const PACKAGE_MERCH_ACTION = {
  ISSUE: 'issue',
  WAIVE: 'waive',
  SWAP: 'swap',
};

/**
 * @deprecated No longer used as an allowlist. Keep/Swap is offered for any
 * non-sizing package freebie; swap targets come from branch merchandisestbl.
 * Kept as an empty export so older imports do not break.
 */
export const PACKAGE_MERCH_SWAPABLE_TYPE_NAMES = [];

export function normalizePackageMerchAction(action) {
  const a = String(action || '')
    .trim()
    .toLowerCase();
  if (a === PACKAGE_MERCH_ACTION.WAIVE) return PACKAGE_MERCH_ACTION.WAIVE;
  if (a === PACKAGE_MERCH_ACTION.SWAP) return PACKAGE_MERCH_ACTION.SWAP;
  return PACKAGE_MERCH_ACTION.ISSUE;
}

/**
 * Real stock rows for a package type (excludes category image shells).
 */
export function listPackageItemVariantRows(merchandiseList, typeName) {
  const key = String(typeName || '').trim().toLowerCase();
  if (!key) return [];
  return (merchandiseList || []).filter((item) => {
    if (String(item.merchandise_name || '').trim().toLowerCase() !== key) return false;
    if (isMerchandiseTypeShellRow(item)) return false;
    return true;
  });
}

/**
 * Item-keyed package types (Tool Kit, Moving Up Kit, …) need a per-student variant pick
 * when the branch has more than one stock item for that type.
 * Other freebies use Keep/Swap (`isPackageMerchSwappable`) instead.
 */
export function requiresPackageItemVariantSelection(
  typeName,
  merchandiseList,
  { requiresSizing = false } = {}
) {
  if (!typeName || requiresSizing) return false;
  if (isUniformStockCategory(typeName)) return false;
  const variants = listPackageItemVariantRows(merchandiseList, typeName);
  return variants.length > 1;
}

export function isStudentItemVariantSelectionComplete(
  studentSelections,
  typeName,
  merchandiseList
) {
  const variants = listPackageItemVariantRows(merchandiseList, typeName);
  if (!variants.length) return false;
  const sel = (studentSelections || []).find(
    (m) =>
      String(m.merchandise_name || '').trim().toLowerCase() ===
      String(typeName || '').trim().toLowerCase()
  );
  if (!sel?.merchandise_id) return false;
  return variants.some(
    (v) => Number(v.merchandise_id) === Number(sel.merchandise_id)
  );
}

export function formatPackageItemVariantOptionLabel(item) {
  return formatMerchandiseVariantOptionLabel(item, { includePrice: false });
}

/**
 * Package-included freebies that show Keep / Swap in Configure Items.
 * Not an allowlist of names — any non-sizing type that is not a uniform / Shirt /
 * Learning Kit. Multi-SKU kits are excluded by callers via
 * `requiresPackageItemVariantSelection` (variant picker wins).
 * Swap *targets* are existing branch merchandise rows (`getPackageMerchSwapOptions`).
 */
export function isPackageMerchSwappable(typeName, { requiresSizing } = {}) {
  const name = String(typeName || '').trim();
  if (!name) return false;
  if (typeof requiresSizing === 'boolean' && requiresSizing) return false;
  if (isUniformStockCategory(name)) return false;
  const lower = name.toLowerCase();
  if (lower.includes('learning kit')) return false;
  return true;
}

export function createDefaultPackageMerchEntitlement(typeName) {
  return {
    type_name: String(typeName || '').trim(),
    action: PACKAGE_MERCH_ACTION.ISSUE,
    replacement_merchandise_id: null,
    reason: '',
  };
}

/**
 * In-stock replacement options for a swap (same branch catalog, not the original type).
 * @param {object[]} merchandiseList
 * @param {{ originalTypeName: string, isUniformName?: (name: string) => boolean, isLearningKitName?: (name: string) => boolean }} opts
 */
export function getPackageMerchSwapOptions(
  merchandiseList,
  {
    originalTypeName,
    isUniformName = () => false,
    isLearningKitName = () => false,
  } = {}
) {
  const original = String(originalTypeName || '').trim().toLowerCase();
  const list = Array.isArray(merchandiseList) ? merchandiseList : [];
  const byId = new Map();

  for (const item of list) {
    if (!item?.merchandise_id) continue;
    // Same as Merchandise → View Stocks: hide category+image type shells.
    if (isMerchandiseTypeShellRow(item)) continue;
    const typeName = String(item.merchandise_name || '').trim();
    if (!typeName) continue;
    if (typeName.toLowerCase() === original) continue;
    if (isUniformName(typeName) || isLearningKitName(typeName)) continue;
    const qty =
      item.quantity == null || item.quantity === ''
        ? null
        : parseInt(item.quantity, 10);
    if (qty !== null && (!Number.isFinite(qty) || qty < 0)) continue;

    const id = Number(item.merchandise_id);
    if (!byId.has(id)) {
      byId.set(id, item);
    }
  }

  return Array.from(byId.values()).sort((a, b) => {
    const an = String(a.merchandise_name || '');
    const bn = String(b.merchandise_name || '');
    const byName = an.localeCompare(bn);
    if (byName !== 0) return byName;
    return Number(a.merchandise_id) - Number(b.merchandise_id);
  });
}

/**
 * Review (and similar) display for a package freebie, honoring Keep vs Swap.
 * Swap shows the replacement name/image and a "Swapped from {original}" subtitle.
 */
export function resolvePackageMerchInclusionDisplay({
  typeName,
  entitlement,
  merchandiseList = [],
}) {
  const original = String(typeName || '').trim();
  const action = normalizePackageMerchAction(entitlement?.action);

  if (action === PACKAGE_MERCH_ACTION.SWAP) {
    const rid = Number(entitlement?.replacement_merchandise_id);
    const replacement = (merchandiseList || []).find(
      (m) => Number(m.merchandise_id) === rid
    );
    if (replacement) {
      const replacementName =
        String(replacement.merchandise_name || original).trim() || original;
      return {
        name: replacementName,
        originalTypeName: original,
        swapped: true,
        merchandiseId: replacement.merchandise_id,
        imageUrl: replacement.image_url || null,
        subtitle: `Replaces: ${original}`,
      };
    }
  }

  return {
    name: original,
    originalTypeName: original,
    swapped: false,
    merchandiseId: null,
    imageUrl: null,
    subtitle: 'Included',
  };
}

export function formatPackageMerchSwapOptionLabel(item) {
  if (!item) return '';
  const name = item.merchandise_name || 'Merchandise';
  const sku = item.sku || item.item_name || null;
  const size = item.size ? String(item.size) : null;
  const parts = [name];
  if (sku) parts.push(sku);
  if (size) parts.push(`Size ${size}`);
  const qty =
    item.quantity == null || item.quantity === ''
      ? null
      : parseInt(item.quantity, 10);
  if (qty !== null && Number.isFinite(qty)) {
    parts.push(`(${qty} in stock)`);
  }
  return parts.join(' · ');
}

/**
 * Build one enroll / MERCH_PENDING line for a package freebie entitlement.
 */
export function buildPackageMerchEntitlementLine({
  typeName,
  entitlement,
  defaultMerchandiseId,
  defaultSize = null,
  replacementItem = null,
}) {
  const action = normalizePackageMerchAction(entitlement?.action);
  const reason = String(entitlement?.reason || '').trim() || null;
  const original = String(typeName || '').trim();

  if (action === PACKAGE_MERCH_ACTION.WAIVE) {
    return {
      merchandise_id: Number(defaultMerchandiseId) || null,
      size: defaultSize || null,
      merchandise_name: original,
      category: null,
      action: PACKAGE_MERCH_ACTION.WAIVE,
      original_type_name: original,
      reason: reason || 'Student already owns this package item',
    };
  }

  if (action === PACKAGE_MERCH_ACTION.SWAP && replacementItem?.merchandise_id) {
    return {
      merchandise_id: Number(replacementItem.merchandise_id),
      size: replacementItem.size || null,
      merchandise_name: replacementItem.merchandise_name || original,
      category: null,
      action: PACKAGE_MERCH_ACTION.SWAP,
      original_type_name: original,
      reason: reason || `Swapped package ${original} for replacement item`,
    };
  }

  return {
    merchandise_id: Number(defaultMerchandiseId) || null,
    size: defaultSize || null,
    merchandise_name: original,
    category: null,
    action: PACKAGE_MERCH_ACTION.ISSUE,
    original_type_name: original,
    reason: null,
  };
}

/**
 * Validate per-student entitlements for swappable package types before enroll.
 * @returns {string|null} error message or null if ok
 */
export function validatePackageMerchEntitlements({
  students,
  swappableTypeNames,
  entitlementsByStudent,
  merchandiseList,
}) {
  const types = Array.isArray(swappableTypeNames) ? swappableTypeNames : [];
  const studentsList = Array.isArray(students) ? students : [];

  for (const student of studentsList) {
    const sid = student?.user_id;
    const byType = entitlementsByStudent?.[sid] || {};
    for (const typeName of types) {
      const ent = byType[typeName] || createDefaultPackageMerchEntitlement(typeName);
      const action = normalizePackageMerchAction(ent.action);
      if (action === PACKAGE_MERCH_ACTION.SWAP) {
        const rid = Number(ent.replacement_merchandise_id);
        if (!Number.isFinite(rid) || rid <= 0) {
          return `Please choose a replacement item for ${typeName} (${student.full_name || 'student'}).`;
        }
        const found = (merchandiseList || []).find(
          (m) => Number(m.merchandise_id) === rid
        );
        if (!found) {
          return `Replacement for ${typeName} is not available for ${student.full_name || 'student'}.`;
        }
        const qty =
          found.quantity == null || found.quantity === ''
            ? null
            : parseInt(found.quantity, 10);
        if (qty !== null && (!Number.isFinite(qty) || qty <= 0)) {
          return `Replacement for ${typeName} is out of stock for ${student.full_name || 'student'}.`;
        }
      }
    }
  }
  return null;
}
