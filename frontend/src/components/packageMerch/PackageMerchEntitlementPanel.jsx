import {
  PACKAGE_MERCH_ACTION,
  normalizePackageMerchAction,
  createDefaultPackageMerchEntitlement,
  getPackageMerchSwapOptions,
} from '../../utils/packageMerchSwap';
import { isLearningKitMerchandiseName } from '../../utils/uniformMerchandise';
import {
  parseMerchandiseQuantity,
  formatStockCountLabel,
  sumMerchandiseTypeStock,
} from '../../utils/merchandiseStock';
import PackageMerchSwapReplacementPicker from './PackageMerchSwapReplacementPicker';

function itemImage(item) {
  return item?.image_url || null;
}

function firstCatalogImage(merchandise, typeName) {
  const match = (merchandise || []).find(
    (m) => m.merchandise_name === typeName && m.image_url
  );
  return match?.image_url || null;
}

/**
 * Per-student Keep / Swap cards for package-included freebies.
 * `embedded` drops the top divider when the panel sits under Configure items.
 */
export default function PackageMerchEntitlementPanel({
  students = [],
  typeNames = [],
  merchandise = [],
  entitlementsByStudent = {},
  onChange,
  embedded = false,
}) {
  if (!students.length || !typeNames.length) return null;

  const setEntitlement = (studentId, typeName, patch) => {
    const prevStudent = entitlementsByStudent[studentId] || {};
    const prev =
      prevStudent[typeName] || createDefaultPackageMerchEntitlement(typeName);
    onChange?.({
      ...entitlementsByStudent,
      [studentId]: {
        ...prevStudent,
        [typeName]: {
          ...prev,
          type_name: typeName,
          ...patch,
        },
      },
    });
  };

  return (
    <div className={embedded ? '' : 'pt-3 mt-3 border-t border-gray-200'}>
      <div className="space-y-4">
        {typeNames.map((typeName) => {
          const options = getPackageMerchSwapOptions(merchandise, {
            originalTypeName: typeName,
            isLearningKitName: isLearningKitMerchandiseName,
          });
          const keepImage = firstCatalogImage(merchandise, typeName);
          const keepStock = sumMerchandiseTypeStock(merchandise, typeName);
          const keepStockLabel = formatStockCountLabel(keepStock);

          return (
            <div
              key={`entitlement-${typeName}`}
              className="p-4 bg-white rounded-xl border border-gray-200"
            >
              <p className="text-sm font-semibold text-gray-900 mb-1">
                {typeName}
                {keepStock != null ? ` (${keepStock})` : ''}
              </p>
              {keepStockLabel ? (
                <p className={`text-xs font-medium mb-1 ${keepStock === 0 ? 'text-amber-700' : 'text-gray-700'}`}>
                  {keepStockLabel}
                </p>
              ) : null}
              <p className="text-xs text-gray-500 mb-3">
                Keep the included {typeName.toLowerCase()}, or swap it for another item
                (including uniform SKUs). Same package price. Zero-stock replacements are
                issued after restock.
              </p>
              <div
                className="space-y-3 max-h-80 overflow-y-auto"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 #f7fafc',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {students.map((student) => {
                  const ent =
                    entitlementsByStudent[student.user_id]?.[typeName] ||
                    createDefaultPackageMerchEntitlement(typeName);
                  const rawAction = normalizePackageMerchAction(ent.action);
                  const action =
                    rawAction === PACKAGE_MERCH_ACTION.SWAP
                      ? PACKAGE_MERCH_ACTION.SWAP
                      : PACKAGE_MERCH_ACTION.ISSUE;
                  const replacement = options.find(
                    (item) =>
                      Number(item.merchandise_id) ===
                      Number(ent.replacement_merchandise_id)
                  );
                  const replacementStockLabel = formatStockCountLabel(
                    parseMerchandiseQuantity(replacement)
                  );

                  return (
                    <div key={`${typeName}-${student.user_id}`} className="space-y-2">
                      <p className="text-xs font-semibold text-gray-700">{student.full_name}</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setEntitlement(student.user_id, typeName, {
                              action: PACKAGE_MERCH_ACTION.ISSUE,
                              replacement_merchandise_id: null,
                              reason: '',
                            })
                          }
                          className={`text-left rounded-xl border-2 p-3 transition-colors ${
                            action === PACKAGE_MERCH_ACTION.ISSUE
                              ? 'border-[#F7C844] bg-amber-50/70'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200">
                              {keepImage ? (
                                <img src={keepImage} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-gray-400">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900">
                                Keep included {typeName.toLowerCase()}
                                {keepStock != null ? ` (${keepStock})` : ''}
                              </p>
                              <p className="text-[11px] text-gray-500 mt-0.5">
                                Keep the {typeName.toLowerCase()} that comes with this package.
                              </p>
                              {keepStockLabel ? (
                                <p className={`text-[11px] font-semibold mt-1 ${keepStock === 0 ? 'text-amber-700' : 'text-gray-800'}`}>
                                  {keepStockLabel}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEntitlement(student.user_id, typeName, {
                              action: PACKAGE_MERCH_ACTION.SWAP,
                              replacement_merchandise_id: ent.replacement_merchandise_id,
                              reason: ent.reason,
                            })
                          }
                          className={`text-left rounded-xl border-2 p-3 transition-colors ${
                            action === PACKAGE_MERCH_ACTION.SWAP
                              ? 'border-blue-500 bg-blue-50/70'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100 ring-1 ring-gray-200">
                              {itemImage(replacement) ? (
                                <img
                                  src={replacement.image_url}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center text-gray-400">
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900">Swap for another item</p>
                              <p className="text-[11px] text-gray-500 mt-0.5">
                                Choose a different eligible item of the same package price.
                              </p>
                              {replacementStockLabel ? (
                                <p className="text-[11px] font-semibold text-gray-800 mt-1">
                                  {replacementStockLabel}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      </div>
                      {action === PACKAGE_MERCH_ACTION.SWAP ? (
                        <div className="space-y-1.5 pl-0.5">
                          <label className="block text-[11px] font-medium text-gray-600">
                            Replacement item
                          </label>
                          <PackageMerchSwapReplacementPicker
                            idPrefix={`${typeName}-${student.user_id}`}
                            options={options}
                            value={ent.replacement_merchandise_id}
                            onChange={(merchandiseId) =>
                              setEntitlement(student.user_id, typeName, {
                                action: PACKAGE_MERCH_ACTION.SWAP,
                                replacement_merchandise_id: merchandiseId,
                              })
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
