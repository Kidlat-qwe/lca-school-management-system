/**
 * Bundle / Learning Kit picker + BOM component collector for Request Stock.
 *
 * BOM rendering tiers based on categoryType:
 *  - All SUPPLIES  → no pickers; auto-selected items shown as read-only badges
 *  - All MERCHANDISE → full pickers for every slot (current behavior)
 *  - Mixed         → pickers only for MERCHANDISE slots; SUPPLIES shown as badges
 */

import {
  getRequestStockCatalogItemsForCategory,
  getUniformGenderOptions,
  getUniformTypeOptions,
  getUniformSizeOptions,
  formatNonUniformItemLabel,
  catalogItemSelectKey,
} from '../../utils/merchandiseRequests/catalogOptions';
import {
  getLearningKitRecipe,
} from '../../utils/merchandiseRequests/learningKit';
import {
  getBomKind,
} from '../../utils/merchandiseRequests/bundleBom';

/** Badge shown for an auto-filled SUPPLIES component. */
function SuppliesAutoFillBadge({ comp, catalogItems, disabled, onComponentChange }) {
  const available = getRequestStockCatalogItemsForCategory(catalogItems, comp.category_name);
  const selectedKey =
    comp.catalog_item_key ||
    (comp.item_name || comp.sku
      ? catalogItemSelectKey({ sku: comp.sku, itemName: comp.item_name })
      : '');

  // If only 1 item in category: plain read-only label
  if (available.length <= 1) {
    const label = comp.item_name
      ? `${comp.item_name}${comp.sku ? ' · ' + comp.sku : ''}`
      : available[0]
        ? formatNonUniformItemLabel(available[0])
        : 'Auto-selected';
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className="inline-flex items-center gap-1 bg-teal-50 border border-teal-200 text-teal-800 text-[10px] font-medium px-2 py-0.5 rounded-full">
          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {label}
        </span>
        <span className="text-[10px] text-gray-400">auto-selected</span>
      </div>
    );
  }

  // Multiple items: allow switching but default is auto-selected
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={selectedKey}
        onChange={(e) => onComponentChange?.(comp.id, 'catalog_item_key', e.target.value)}
        className="input-field text-xs py-1 flex-1 min-w-0"
        disabled={disabled}
      >
        <option value="">-- Auto-select {comp.category_name} --</option>
        {available.map((item) => {
          const key = catalogItemSelectKey(item);
          return (
            <option key={key} value={key}>
              {formatNonUniformItemLabel(item)}
            </option>
          );
        })}
      </select>
      {selectedKey && (
        <span className="inline-flex items-center gap-1 bg-teal-50 border border-teal-200 text-teal-700 text-[10px] px-2 py-0.5 rounded-full shrink-0">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          supplies
        </span>
      )}
    </div>
  );
}

export default function LearningKitRequestFields({
  line,
  catalogItems = [],
  catalogCategories = [],
  lineError = {},
  disabled = false,
  onKitSelect,
  onComponentChange,
  onRemoveComponent,
}) {
  const kitItems = getRequestStockCatalogItemsForCategory(catalogItems, line.category_name);
  const catalogItemKey =
    line.catalog_item_key ||
    (line.item_name || line.sku
      ? catalogItemSelectKey({
          sku: line.sku,
          itemName: line.item_name,
          inventoryId: line.inventory_id,
        })
      : '');
  const selectedKitItem =
    line.catalog_kit_item ||
    kitItems.find((item) => catalogItemSelectKey(item) === catalogItemKey) ||
    null;
  const recipe = getLearningKitRecipe({
    itemName: line.item_name,
    sku: line.sku,
    catalogItem: selectedKitItem,
    catalogCategories,
  });

  const bomKind = selectedKitItem ? getBomKind(selectedKitItem, catalogCategories) : 'unknown';
  const isAllSupplies = bomKind === 'supplies';
  const isMixed = bomKind === 'mixed';

  // Description text adapts to BOM kind
  const descriptionText = isAllSupplies
    ? 'All components are school supplies — automatically selected from RHET catalog. Just pick the kit and quantity.'
    : isMixed
      ? 'Pick concrete items for merchandise slots. Supplies slots are auto-selected from catalog.'
      : 'RHET kits are virtual: available count is the minimum across included categories. Pick a kit, then choose a concrete item for every BOM category.';

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500 leading-snug">{descriptionText}</p>

      {/* Kit picker */}
      <div>
        <select
          value={catalogItemKey}
          onChange={(e) => onKitSelect?.(e.target.value)}
          className={`input-field text-sm py-1.5 w-full ${lineError.item_name ? 'border-red-500' : ''}`}
          disabled={disabled}
          aria-label="Bundle kit catalog item"
        >
          <option value="">-- Select kit --</option>
          {kitItems.map((item) => {
            const key = `${item.sku}|${item.itemName}|${item.inventoryId}`;
            return (
              <option key={key} value={key}>
                {formatNonUniformItemLabel(item)}
              </option>
            );
          })}
        </select>
        {lineError.item_name && (
          <p className="mt-1 text-[11px] text-red-600">{lineError.item_name}</p>
        )}
      </div>

      {/* No recipe yet */}
      {line.item_name && !recipe && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          Kit recipe not found. Reload the catalog or ask an admin to add BOM slots.
        </p>
      )}

      {/* All SUPPLIES — just show a summary badge, no component pickers */}
      {recipe && isAllSupplies && (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-teal-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[11px] font-semibold text-teal-800">
              Components auto-selected — supplies bundle
            </span>
          </div>
          <p className="text-[10px] text-teal-700 leading-snug">
            All BOM categories are school supplies. RHET resolves exact items automatically.
          </p>
          <div className="pt-1 space-y-1">
            {(line.components || []).map((comp) => (
              <div key={comp.id} className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-medium text-teal-900 w-24 shrink-0">
                  {comp.category_name}
                </span>
                <SuppliesAutoFillBadge
                  comp={comp}
                  catalogItems={catalogItems}
                  disabled={disabled}
                  onComponentChange={onComponentChange}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Has MERCHANDISE or MIXED slots — render component pickers */}
      {recipe && !isAllSupplies && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2 space-y-2">
          <p className="text-[11px] font-semibold text-gray-700">
            Components for {recipe.label || line.item_name}
          </p>

          {(line.components || []).map((comp, idx) => {
            const kind = String(comp.kind || '').toLowerCase();
            const isUniformComp = kind === 'uniform';
            const isSuppliesComp = kind === 'supplies';

            const genderOpts = getUniformGenderOptions(catalogItems, comp.category_name);
            const typeOpts = getUniformTypeOptions(catalogItems, comp.category_name, comp.gender);
            const sizeOpts = getUniformSizeOptions(catalogItems, comp.category_name, comp.gender, comp.type);
            const otherItems = getRequestStockCatalogItemsForCategory(catalogItems, comp.category_name);
            const otherKey =
              comp.catalog_item_key ||
              (comp.item_name || comp.sku
                ? catalogItemSelectKey({ sku: comp.sku, itemName: comp.item_name })
                : '');

            const duplicatesInLine = (line.components || []).filter(
              (c) =>
                String(c.category_name).toLowerCase() ===
                String(comp.category_name).toLowerCase()
            ).length;

            return (
              <div
                key={comp.id}
                className={`rounded border p-2 space-y-1.5 ${
                  isSuppliesComp
                    ? 'border-teal-100 bg-teal-50'
                    : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-gray-800 flex items-center gap-1.5">
                    {comp.category_name}
                    <span
                      className={`text-[10px] font-normal px-1.5 py-0.5 rounded-full ${
                        isSuppliesComp
                          ? 'bg-teal-100 text-teal-700'
                          : isUniformComp
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {isSuppliesComp ? 'supplies' : isUniformComp ? 'uniform' : 'item'}
                    </span>
                  </span>
                  {duplicatesInLine > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveComponent?.(comp.id)}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {/* SUPPLIES — auto-fill badge or multi-item picker */}
                {isSuppliesComp && (
                  <SuppliesAutoFillBadge
                    comp={comp}
                    catalogItems={catalogItems}
                    disabled={disabled}
                    onComponentChange={onComponentChange}
                  />
                )}

                {/* UNIFORM — gender + type + size */}
                {isUniformComp && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    <select
                      value={comp.gender || ''}
                      onChange={(e) => onComponentChange?.(comp.id, 'gender', e.target.value)}
                      className="input-field text-xs py-1"
                      disabled={disabled}
                    >
                      <option value="">Gender</option>
                      {(genderOpts.length ? genderOpts : ['Male', 'Female', 'Unisex']).map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                    <select
                      value={comp.type || ''}
                      onChange={(e) => onComponentChange?.(comp.id, 'type', e.target.value)}
                      className="input-field text-xs py-1"
                      disabled={disabled || !comp.gender}
                    >
                      <option value="">Type / Logo</option>
                      {(typeOpts.length
                        ? typeOpts
                        : ['Polo', 'Short', 'Blouse', 'Skirt', 'Shirt', 'Pants']
                      ).map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <select
                      value={comp.size || ''}
                      onChange={(e) => onComponentChange?.(comp.id, 'size', e.target.value)}
                      className="input-field text-xs py-1"
                      disabled={disabled || !comp.type}
                    >
                      <option value="">Size</option>
                      {(sizeOpts.length
                        ? sizeOpts
                        : ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL']
                      ).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* MERCHANDISE item picker */}
                {!isSuppliesComp && !isUniformComp && (
                  <select
                    value={otherKey}
                    onChange={(e) => onComponentChange?.(comp.id, 'catalog_item_key', e.target.value)}
                    className="input-field text-xs py-1 w-full"
                    disabled={disabled}
                  >
                    <option value="">-- Select {comp.category_name} item --</option>
                    {otherItems.map((item) => {
                      const key = catalogItemSelectKey(item);
                      return (
                        <option key={`${comp.id}-${key}`} value={key}>
                          {formatNonUniformItemLabel(item)}
                        </option>
                      );
                    })}
                  </select>
                )}

                <p className="text-[10px] text-gray-400">Component #{idx + 1}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
