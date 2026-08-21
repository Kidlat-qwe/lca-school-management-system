import { resolvePackageMerchInclusionDisplay } from '../../utils/packageMerchSwap';
import {
  formatStockCountLabel,
  lookupMerchandiseQuantity,
  sumMerchandiseTypeStock,
  formatMerchandiseVariantSubtitle,
  isUniformStockCategory,
} from '../../utils/merchandiseStock';

function merchImage(merchandiseList, name, id) {
  if (id) {
    const byId = (merchandiseList || []).find(
      (m) => String(m.merchandise_id) === String(id)
    );
    if (byId?.image_url) return byId.image_url;
  }
  const byName = (merchandiseList || []).find(
    (m) => m.merchandise_name === name && m.image_url
  );
  return byName?.image_url || null;
}

/**
 * Build order-summary / review lines for package merchandise.
 */
export function buildEnrollSummaryItems({
  includedMerchandiseTypes = [],
  student = null,
  entitlementsByStudent = {},
  merchandiseList = [],
  studentMerchSelections = [],
}) {
  const items = [];
  const seen = new Set();

  (studentMerchSelections || []).forEach((sel) => {
    if (!sel?.merchandise_name) return;
    const piece = sel.category && sel.category !== 'General' ? sel.category : null;
    const key = `${sel.merchandise_name}|${piece || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const stockQty = lookupMerchandiseQuantity(merchandiseList, sel.merchandise_id);
    const merchRow = (merchandiseList || []).find(
      (m) => Number(m.merchandise_id) === Number(sel.merchandise_id)
    );
    const variantDetail =
      merchRow && !isUniformStockCategory(sel.merchandise_name)
        ? formatMerchandiseVariantSubtitle(merchRow)
        : null;
    items.push({
      name: piece ? `${sel.merchandise_name} (${piece})` : sel.merchandise_name,
      detail:
        [piece, sel.size, variantDetail !== 'Select size' ? variantDetail : null]
          .filter(Boolean)
          .join(' • ') || null,
      complete: Boolean(
        sel.merchandise_id &&
          (sel.size || !isUniformStockCategory(sel.merchandise_name))
      ),
      included: true,
      swapped: false,
      replaces: null,
      imageUrl: merchImage(merchandiseList, sel.merchandise_name, sel.merchandise_id),
      stockQty,
      stockLabel: formatStockCountLabel(stockQty),
    });
  });

  includedMerchandiseTypes.forEach((typeName) => {
    if (items.some((i) => i.name === typeName || i.replaces === typeName)) return;
    const display = resolvePackageMerchInclusionDisplay({
      typeName,
      entitlement: student
        ? entitlementsByStudent[student.user_id]?.[typeName]
        : null,
      merchandiseList,
    });
    const stockQty = display.merchandiseId
      ? lookupMerchandiseQuantity(merchandiseList, display.merchandiseId)
      : sumMerchandiseTypeStock(merchandiseList, typeName);
    items.push({
      name: display.name,
      detail: display.swapped ? `Replaces: ${display.originalTypeName}` : null,
      complete: !display.swapped || Boolean(display.merchandiseId),
      included: true,
      swapped: display.swapped,
      replaces: display.swapped ? display.originalTypeName : null,
      imageUrl:
        display.imageUrl || merchImage(merchandiseList, display.name, display.merchandiseId),
      stockQty,
      stockLabel: formatStockCountLabel(stockQty),
    });
  });

  return items;
}

export function formatEnrollPackagePrice(selectedPackage, selectedPromo) {
  const base =
    (selectedPackage?.package_type === 'Installment' ||
      (selectedPackage?.package_type === 'Phase' &&
        selectedPackage?.payment_option === 'Installment')) &&
    selectedPackage?.downpayment_amount != null &&
    parseFloat(selectedPackage.downpayment_amount) > 0
      ? parseFloat(selectedPackage.downpayment_amount)
      : parseFloat(selectedPackage?.package_price || 0);
  const total =
    selectedPromo?.final_price != null ? parseFloat(selectedPromo.final_price) : base;
  return { packagePrice: base, totalPrice: Number.isFinite(total) ? total : base };
}
