/**
 * Package freebie swap upgrade adjustments at enrollment.
 * Only positive price differences are charged; cheaper replacements are free.
 */

function parseMerchandiseCatalogPrice(item) {
  if (!item) return 0;
  const raw = item.price ?? item.merchandise_price;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function resolveOriginalTypePrice(originalTypeName, packageMerchandiseByType) {
  const key = String(originalTypeName || '').trim().toLowerCase();
  if (!key) return 0;
  const entry = packageMerchandiseByType?.get(key);
  return parseMerchandiseCatalogPrice(entry);
}

function formatReplacementDescription(row) {
  if (!row) return 'Replacement item';
  const typeName = String(row.merchandise_name || '').trim() || 'Merchandise';
  const parts = [typeName];
  if (row.size) parts.push(String(row.size));
  if (row.type) parts.push(String(row.type));
  return parts.join(' · ');
}

/**
 * Build type-name → { price, merchandise_name } map from package detail rows.
 * @param {Map<number, object>} packageMerchandiseMap
 */
export function buildPackageMerchPriceByType(packageMerchandiseMap) {
  const byType = new Map();
  for (const meta of packageMerchandiseMap?.values() || []) {
    if (!meta || meta.is_included === false) continue;
    const typeName = String(meta.merchandise_name || '').trim();
    if (!typeName) continue;
    const key = typeName.toLowerCase();
    if (byType.has(key)) continue;
    byType.set(key, {
      merchandise_name: typeName,
      price: meta.price,
    });
  }
  return byType;
}

/**
 * @param {Map<string, object>} merchandiseToDeduct
 * @param {Map<string, object>} packageMerchandiseByType from buildPackageMerchPriceByType
 * @param {(merchandiseId: number) => Promise<object|null>} loadReplacementRow
 */
export async function computePackageMerchSwapInvoiceAdjustments(
  merchandiseToDeduct,
  packageMerchandiseByType,
  loadReplacementRow
) {
  const items = [];
  let totalAdjustment = 0;

  for (const merchInfo of merchandiseToDeduct?.values() || []) {
    if (String(merchInfo.action || '').trim().toLowerCase() !== 'swap') continue;
    if (!merchInfo.merchandise_id) continue;

    const originalTypeName =
      String(merchInfo.original_type_name || merchInfo.merchandise_name || '').trim();
    const originalPrice = resolveOriginalTypePrice(originalTypeName, packageMerchandiseByType);
    const replacementRow = await loadReplacementRow(Number(merchInfo.merchandise_id));
    const replacementPrice = parseMerchandiseCatalogPrice(replacementRow);
    const unitDiff = replacementPrice - originalPrice;
    if (!(unitDiff > 0)) continue;

    const count = Math.max(1, parseInt(merchInfo.count, 10) || 1);
    const lineAmount = unitDiff * count;
    totalAdjustment += lineAmount;
    items.push({
      description: `Merchandise swap adjustment: ${originalTypeName} → ${formatReplacementDescription(replacementRow)}`,
      amount: lineAmount,
      original_type_name: originalTypeName,
      replacement_merchandise_id: Number(merchInfo.merchandise_id),
      unit_adjustment: unitDiff,
      count,
    });
  }

  return { items, totalAdjustment };
}
