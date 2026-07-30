/**
 * Learning Kit picker + BOM component collector for Request Stock.
 * Kit BOM categories come from CMS recipes (mirrors RHET category slots).
 */

import {
  getCatalogItemsForCategory,
  getUniformGenderOptions,
  getUniformTypeOptions,
  getUniformSizeOptions,
  formatNonUniformItemLabel,
  catalogItemSelectKey,
} from '../../utils/merchandiseRequests/catalogOptions';
import {
  getLearningKitRecipe,
  createEmptyKitComponent,
} from '../../utils/merchandiseRequests/learningKit';

export default function LearningKitRequestFields({
  line,
  catalogItems = [],
  lineError = {},
  disabled = false,
  onKitSelect,
  onComponentChange,
  onAddComponent,
  onRemoveComponent,
}) {
  const kitItems = getCatalogItemsForCategory(catalogItems, line.category_name);
  const recipe = getLearningKitRecipe({
    itemName: line.item_name,
    sku: line.sku,
  });
  const catalogItemKey =
    line.catalog_item_key ||
    (line.item_name || line.sku
      ? catalogItemSelectKey({
          sku: line.sku,
          itemName: line.item_name,
          inventoryId: line.inventory_id,
        })
      : '');

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500 leading-snug">
        RHET kits are virtual: available count is the minimum across included categories.
        Pick a kit, then choose a concrete item for every BOM category.
      </p>

      <div>
        <select
          value={catalogItemKey}
          onChange={(e) => onKitSelect?.(e.target.value)}
          className={`input-field text-sm py-1.5 w-full ${lineError.item_name ? 'border-red-500' : ''}`}
          disabled={disabled}
          aria-label="Learning Kit catalog item"
        >
          <option value="">-- Select Learning Kit --</option>
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

      {line.item_name && !recipe && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
          Kit recipe not configured in CMS for this kit. Ask an admin to add BOM slots
          (e.g. LCA T-Shirt, Tool Kit, Workbooks).
        </p>
      )}

      {recipe && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-2 space-y-2">
          <p className="text-[11px] font-semibold text-gray-700">
            Components for {recipe.label || line.item_name}
          </p>
          {(line.components || []).map((comp, idx) => {
            const isUniform = String(comp.kind || '').toLowerCase() === 'uniform';
            const genderOpts = getUniformGenderOptions(catalogItems, comp.category_name);
            const typeOpts = getUniformTypeOptions(
              catalogItems,
              comp.category_name,
              comp.gender
            );
            const sizeOpts = getUniformSizeOptions(
              catalogItems,
              comp.category_name,
              comp.gender,
              comp.type
            );
            const otherItems = getCatalogItemsForCategory(catalogItems, comp.category_name);
            const otherKey =
              comp.catalog_item_key ||
              (comp.item_name || comp.sku
                ? catalogItemSelectKey({
                    sku: comp.sku,
                    itemName: comp.item_name,
                  })
                : '');

            return (
              <div
                key={comp.id}
                className="rounded border border-gray-200 bg-white p-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-gray-800">
                    {comp.category_name}
                    <span className="text-gray-400 font-normal">
                      {' '}
                      · {isUniform ? 'uniform' : 'item'}
                    </span>
                  </span>
                  {(line.components || []).filter(
                    (c) =>
                      String(c.category_name).toLowerCase() ===
                      String(comp.category_name).toLowerCase()
                  ).length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveComponent?.(comp.id)}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {isUniform ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    <select
                      value={comp.gender || ''}
                      onChange={(e) =>
                        onComponentChange?.(comp.id, 'gender', e.target.value)
                      }
                      className="input-field text-xs py-1"
                      disabled={disabled}
                    >
                      <option value="">Gender</option>
                      {(genderOpts.length ? genderOpts : ['Male', 'Female', 'Unisex']).map(
                        (g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        )
                      )}
                    </select>
                    <select
                      value={comp.type || ''}
                      onChange={(e) => onComponentChange?.(comp.id, 'type', e.target.value)}
                      className="input-field text-xs py-1"
                      disabled={disabled || !comp.gender}
                    >
                      <option value="">Type</option>
                      {(typeOpts.length
                        ? typeOpts
                        : ['Polo', 'Short', 'Blouse', 'Skirt', 'Shirt', 'Pants']
                      ).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
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
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <select
                    value={otherKey}
                    onChange={(e) =>
                      onComponentChange?.(comp.id, 'catalog_item_key', e.target.value)
                    }
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

          {recipe.slots.map((slot) => (
            <button
              key={`add-${slot.categoryName}`}
              type="button"
              onClick={() =>
                onAddComponent?.(
                  createEmptyKitComponent(slot, Math.max(1, parseInt(line.quantity, 10) || 1))
                )
              }
              className="text-[11px] text-gray-700 hover:underline"
            >
              + Add another {slot.categoryName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
