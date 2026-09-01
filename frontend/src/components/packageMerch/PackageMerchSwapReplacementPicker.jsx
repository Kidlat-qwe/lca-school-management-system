import { useEffect, useMemo, useState } from 'react';
import {
  groupPackageMerchSwapOptions,
  formatPackageMerchSwapItemDetailLabel,
  formatPackageMerchSwapOptionLabel,
} from '../../utils/packageMerchSwap';
import { sumMerchandiseTypeStock, formatStockCountLabel } from '../../utils/merchandiseStock';

/**
 * Category accordion + item list for package freebie swap replacement.
 */
export default function PackageMerchSwapReplacementPicker({
  options = [],
  value = null,
  onChange,
  idPrefix = 'swap',
}) {
  const groups = useMemo(() => groupPackageMerchSwapOptions(options), [options]);
  const selectedItem = useMemo(
    () => options.find((item) => Number(item.merchandise_id) === Number(value)) || null,
    [options, value]
  );
  const selectedCategory = selectedItem?.merchandise_name || null;

  const [openCategory, setOpenCategory] = useState(selectedCategory);

  useEffect(() => {
    if (selectedCategory) {
      setOpenCategory(selectedCategory);
    }
  }, [selectedCategory]);

  if (!groups.length) {
    return (
      <p className="text-[11px] text-amber-800">
        No other eligible items available to swap (check branch stock).
      </p>
    );
  }

  const toggleCategory = (categoryName) => {
    setOpenCategory((prev) => (prev === categoryName ? null : categoryName));
  };

  return (
    <div className="space-y-2">
      {selectedItem ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">
            Selected
          </p>
          <p className="text-xs font-medium text-gray-900 mt-0.5">
            {formatPackageMerchSwapOptionLabel(selectedItem)}
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-gray-500">Choose a category, then pick an item.</p>
      )}

      <div
        className="rounded-lg border border-gray-200 bg-gray-50/80 divide-y divide-gray-200 max-h-52 overflow-y-auto"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e0 #f7fafc',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {groups.map((group) => {
          const isOpen = openCategory === group.categoryName;
          const categoryStock = sumMerchandiseTypeStock(group.items, group.categoryName);
          const categoryStockLabel = formatStockCountLabel(categoryStock);
          const hasSelectionInGroup = group.items.some(
            (item) => Number(item.merchandise_id) === Number(value)
          );

          return (
            <div key={`${idPrefix}-${group.categoryName}`}>
              <button
                type="button"
                onClick={() => toggleCategory(group.categoryName)}
                aria-expanded={isOpen}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left transition-colors ${
                  hasSelectionInGroup ? 'bg-blue-50/70' : 'hover:bg-white'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-gray-900 truncate">
                    {group.categoryName}
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {group.itemCount} item{group.itemCount === 1 ? '' : 's'}
                    {categoryStockLabel ? ` · ${categoryStockLabel}` : ''}
                  </p>
                </div>
                <svg
                  className={`h-4 w-4 flex-shrink-0 text-gray-500 transition-transform ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {isOpen ? (
                <div className="bg-white border-t border-gray-100 px-1.5 py-1.5 space-y-0.5">
                  {group.items.map((item) => {
                    const isSelected =
                      Number(item.merchandise_id) === Number(value);
                    return (
                      <button
                        key={item.merchandise_id}
                        type="button"
                        onClick={() => onChange?.(Number(item.merchandise_id))}
                        className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors ${
                          isSelected
                            ? 'bg-blue-100 text-blue-950 ring-1 ring-blue-300 font-semibold'
                            : 'text-gray-800 hover:bg-gray-50'
                        }`}
                      >
                        {formatPackageMerchSwapItemDetailLabel(item)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
