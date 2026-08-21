import {
  listPackageItemVariantRows,
  formatPackageItemVariantOptionLabel,
} from '../../utils/packageMerchSwap';
import {
  formatStockCountLabel,
  parseMerchandiseQuantity,
} from '../../utils/merchandiseStock';

/**
 * Per-student item variant picker for package types keyed by itemName/sku
 * (e.g. Tool Kit → gs_toolkit vs nc_kg_toolkit).
 * Swappable freebies (Backpack, Toga, …) use PackageMerchEntitlementPanel instead.
 */
export default function PackageMerchItemVariantPanel({
  students = [],
  typeName,
  merchandise = [],
  selectionsByStudent = {},
  onVariantChange,
  embedded = false,
}) {
  const variants = listPackageItemVariantRows(merchandise, typeName);
  if (!students.length || !typeName || !variants.length) return null;

  const totalStock = variants.reduce((sum, item) => {
    const qty = parseMerchandiseQuantity(item);
    return qty == null ? sum : sum + qty;
  }, 0);
  const stockLabel = formatStockCountLabel(
    variants.some((v) => parseMerchandiseQuantity(v) != null) ? totalStock : null
  );

  return (
    <div
      className={
        embedded
          ? 'p-3 bg-white border border-gray-200 rounded-lg'
          : 'pt-3 mt-3 border-t border-gray-200'
      }
    >
      <p className="text-sm font-medium text-gray-900 mb-1">{typeName}</p>
      {stockLabel ? (
        <p className="text-xs font-medium text-gray-700 mb-2">{stockLabel}</p>
      ) : null}
      <p className="text-xs text-gray-500 mb-3">
        Select which {typeName.toLowerCase()} variant to issue for each student.
      </p>
      <div
        className="space-y-2 max-h-64 overflow-y-auto"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e0 #f7fafc',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {students.map((student) => {
          const studentSelections = selectionsByStudent[student.user_id] || [];
          const current = studentSelections.find(
            (m) =>
              String(m.merchandise_name || '').trim().toLowerCase() ===
              String(typeName).trim().toLowerCase()
          );
          const currentId = current?.merchandise_id
            ? String(current.merchandise_id)
            : '';

          return (
            <div
              key={`${typeName}-${student.user_id}`}
              className="p-2.5 rounded-lg border border-gray-200 bg-gray-50"
            >
              <p className="text-[11px] font-semibold text-gray-800 mb-1.5">
                {student.full_name}
              </p>
              <select
                value={currentId}
                onChange={(e) =>
                  onVariantChange?.(student.user_id, typeName, e.target.value)
                }
                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#F7C844] bg-white"
              >
                <option value="">Select {typeName} item</option>
                {variants.map((item) => (
                  <option key={item.merchandise_id} value={item.merchandise_id}>
                    {formatPackageItemVariantOptionLabel(item)}
                    {parseMerchandiseQuantity(item) != null
                      ? ` (${parseMerchandiseQuantity(item)} in stock)`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
