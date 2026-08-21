import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { appAlert } from '../../utils/appAlert';
import LearningKitRequestFields from './LearningKitRequestFields';
import {
  createEmptyCatalogRequestLine,
  unwrapCatalogPayload,
  describeInventoryCatalogLoad,
  isLcaShirtCategory,
  resolveRequestStockFormMode,
  findCatalogCategoryKind,
  getRequestStockCatalogItemsForCategory,
  getUniformGenderOptions,
  getUniformTypeOptions,
  getUniformSizeOptions,
  formatNonUniformItemLabel,
  buildCatalogRequestPayload,
  findCatalogItemByKey,
  catalogItemSelectKey,
} from '../../utils/merchandiseRequests/catalogOptions';
import {
  getLearningKitRecipe,
  buildKitComponentsFromRecipe,
  validateKitLineComponents,
} from '../../utils/merchandiseRequests/learningKit';
import {
  getRequestStockCategoryOptions,
  isInventoryIntegrationDisabledError,
} from '../../utils/merchandiseRequests/createTypeCategory';

/**
 * Shared Request Stock modal (Branch Admin + Superadmin).
 * Loads RHET catalog on open and POSTs /merchandise-requests/batch.
 * When `branchId` is set, includes `branch_id` in the submit body (Superadmin path).
 */
export default function RequestStockModal({
  open,
  onClose,
  branchId,
  branchTypeNames = [],
  requestedByDisplay = '',
  requestDateDisplay = '',
  onSubmitted,
}) {
  const [bulkRequestLines, setBulkRequestLines] = useState([createEmptyCatalogRequestLine()]);
  const [bulkLineErrors, setBulkLineErrors] = useState({});
  const [requestFormData, setRequestFormData] = useState({ request_reason: '' });
  const [requestFormErrors, setRequestFormErrors] = useState({});
  const [inventoryCatalog, setInventoryCatalog] = useState({ categories: [], items: [] });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogWarning, setCatalogWarning] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const merchandiseTypeList = (branchTypeNames || [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  const requestStockCategoryOptions = getRequestStockCategoryOptions(
    inventoryCatalog,
    merchandiseTypeList
  );

  const loadInventoryCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError('');
    setCatalogWarning('');
    const attempt = async () => {
      const response = await apiRequest('/merchandise-requests/inventory/catalog');
      return unwrapCatalogPayload(response);
    };
    try {
      let catalog;
      try {
        catalog = await attempt();
      } catch (firstErr) {
        if (isInventoryIntegrationDisabledError(firstErr)) {
          setInventoryCatalog({ categories: [], items: [] });
          setCatalogError('');
          setCatalogWarning('');
          return;
        }
        const msg = String(firstErr?.message || '').toLowerCase();
        const retryable =
          msg.includes('timeout') ||
          msg.includes('timed out') ||
          msg.includes('temporarily unavailable') ||
          msg.includes('unexpected error') ||
          msg.includes('502') ||
          msg.includes('bad gateway') ||
          msg.includes('could not reach');
        if (!retryable) throw firstErr;
        await new Promise((r) => setTimeout(r, 1200));
        catalog = await attempt();
      }
      setInventoryCatalog(catalog);
      const outcome = describeInventoryCatalogLoad(catalog);
      setCatalogError(outcome.error);
      setCatalogWarning(outcome.warning);
    } catch (err) {
      if (isInventoryIntegrationDisabledError(err)) {
        setInventoryCatalog({ categories: [], items: [] });
        setCatalogError('');
        setCatalogWarning('');
      } else {
        setInventoryCatalog({ categories: [], items: [] });
        setCatalogWarning('');
        setCatalogError(
          err.message ||
            'Could not load RHET Inventory catalog. Request Stock requires a live catalog.'
        );
      }
    } finally {
      setCatalogLoading(false);
    }
  };

  const resetForm = () => {
    setBulkRequestLines([createEmptyCatalogRequestLine()]);
    setBulkLineErrors({});
    setRequestFormData({ request_reason: '' });
    setRequestFormErrors({});
    setCatalogError('');
    setCatalogWarning('');
  };

  useEffect(() => {
    if (!open) return;
    resetForm();
    void loadInventoryCatalog();
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose?.();
  };

  const addBulkRequestLine = () => {
    setBulkRequestLines((prev) => [...prev, createEmptyCatalogRequestLine()]);
  };

  const removeBulkRequestLine = (lineId) => {
    setBulkRequestLines((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((line) => line.id !== lineId);
    });
    setBulkLineErrors((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const handleBulkLineChange = (lineId, field, value) => {
    setBulkRequestLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const updated = { ...line, [field]: value };

        if (field === 'category_name') {
          updated.category_kind =
            findCatalogCategoryKind(inventoryCatalog.categories, value) || '';
          updated.gender = '';
          updated.type = '';
          updated.size = '';
          updated.item_name = '';
          updated.sku = '';
          updated.inventory_id = '';
          updated.catalog_item_key = '';
          updated.components = [];
        }
        if (field === 'gender') {
          updated.type = '';
          updated.size = '';
        }
        if (field === 'type') {
          updated.size = '';
        }
        if (field === 'catalog_item_key') {
          const items = getRequestStockCatalogItemsForCategory(
            inventoryCatalog.items,
            line.category_name
          );
          const selected = findCatalogItemByKey(items, value);
          updated.item_name = selected?.itemName || '';
          updated.sku = selected?.sku || '';
          updated.inventory_id = selected?.inventoryId || '';
          updated.catalog_item_key = selected ? catalogItemSelectKey(selected) : value;
          if (
            resolveRequestStockFormMode({
              categoryName: line.category_name,
              categoryKind: line.category_kind,
            }) === 'kit'
          ) {
            const recipe = getLearningKitRecipe({
              itemName: updated.item_name,
              sku: updated.sku,
              catalogItem: selected,
              catalogCategories: inventoryCatalog.categories,
            });
            updated.catalog_kit_item = selected || null;
            updated.catalog_categories = inventoryCatalog.categories;
            const kitQty = Math.max(1, parseInt(updated.quantity, 10) || 1);
            updated.components = recipe
              ? buildKitComponentsFromRecipe(recipe, kitQty, inventoryCatalog.items)
              : [];
          }
        }
        if (
          field === 'quantity' &&
          resolveRequestStockFormMode({
            categoryName: line.category_name,
            categoryKind: line.category_kind,
          }) === 'kit'
        ) {
          const kitQty = Math.max(1, parseInt(value, 10) || 1);
          updated.components = (updated.components || []).map((c) => ({
            ...c,
            quantity: String(kitQty),
          }));
        }

        return updated;
      })
    );
    setBulkLineErrors((prev) => {
      if (!prev[lineId]) return prev;
      const nextLine = { ...prev[lineId] };
      delete nextLine[field];
      if (field === 'catalog_item_key') {
        delete nextLine.item_name;
        delete nextLine.sku;
      }
      if (field === 'category_name') {
        delete nextLine.gender;
        delete nextLine.type;
        delete nextLine.size;
        delete nextLine.item_name;
      }
      const next = { ...prev };
      if (Object.keys(nextLine).length === 0) delete next[lineId];
      else next[lineId] = nextLine;
      return next;
    });
  };

  const handleKitComponentChange = (lineId, componentId, field, value) => {
    setBulkRequestLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) return line;
        const components = (line.components || []).map((comp) => {
          if (comp.id !== componentId) return comp;
          const updated = { ...comp, [field]: value };
          if (field === 'gender') {
            updated.type = '';
            updated.size = '';
          }
          if (field === 'type') {
            updated.size = '';
          }
          if (field === 'catalog_item_key') {
            const items = getRequestStockCatalogItemsForCategory(
              inventoryCatalog.items,
              comp.category_name
            );
            const selected = findCatalogItemByKey(items, value);
            updated.item_name = selected?.itemName || '';
            updated.sku = selected?.sku || '';
            updated.catalog_item_key = selected ? catalogItemSelectKey(selected) : value;
          }
          return updated;
        });
        return { ...line, components };
      })
    );
  };

  const handleRemoveKitComponent = (lineId, componentId) => {
    setBulkRequestLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              components: (line.components || []).filter((c) => c.id !== componentId),
            }
          : line
      )
    );
  };

  const handleRequestInputChange = (e) => {
    const { name, value } = e.target;
    setRequestFormData((prev) => ({ ...prev, [name]: value }));
    if (requestFormErrors[name]) {
      setRequestFormErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const validateBulkRequestForm = () => {
    const errors = {};
    const lineErrors = {};

    if (!requestFormData.request_reason?.trim()) {
      errors.request_reason = 'Request reason is required';
    } else if (requestFormData.request_reason.trim().length < 5) {
      errors.request_reason = 'Request reason must be at least 5 characters';
    }

    if (catalogError || !inventoryCatalog.categories.length) {
      errors.bulk = catalogError || 'RHET Inventory catalog is required before submitting.';
    } else if (!merchandiseTypeList.length) {
      errors.bulk =
        'No merchandise types on this branch yet. Add a Merchandise Type first, then request stock.';
    } else if (!requestStockCategoryOptions.length) {
      errors.bulk =
        'None of this branch’s merchandise types match the RHET catalog. Add types using exact RHET category names.';
    }

    if (!bulkRequestLines.length) {
      errors.bulk = 'Add at least one item row';
    }

    const branchCategoryNames = new Set(
      requestStockCategoryOptions.map((c) =>
        String(c.categoryName || c.category_name || '')
          .trim()
          .toLowerCase()
      )
    );

    bulkRequestLines.forEach((line, index) => {
      const row = {};
      const categoryName = String(line.category_name || '').trim();

      if (!categoryName) {
        row.category_name = 'Category is required';
      } else if (
        requestStockCategoryOptions.length &&
        !branchCategoryNames.has(categoryName.toLowerCase())
      ) {
        row.category_name = 'Select a category already added for this branch';
      }

      const lineCategoryKind =
        line.category_kind ||
        findCatalogCategoryKind(inventoryCatalog.categories, categoryName);
      const lineFormMode = resolveRequestStockFormMode({
        categoryName,
        categoryKind: lineCategoryKind,
      });

      if (categoryName && lineFormMode === 'kit') {
        const kitErr = validateKitLineComponents({
          ...line,
          catalog_categories: inventoryCatalog.categories,
        });
        if (kitErr) row.item_name = kitErr;
      } else if (categoryName && lineFormMode === 'uniform') {
        const lcaShirt = isLcaShirtCategory(
          categoryName,
          line.category_kind ||
            findCatalogCategoryKind(inventoryCatalog.categories, categoryName)
        );
        if (!(line.gender || '').trim()) row.gender = 'Gender is required';
        if (!(line.type || '').trim()) {
          row.type = lcaShirt ? 'Logo is required' : 'Type is required';
        }
        if (!(line.size || '').trim()) row.size = 'Size is required';
      } else if (categoryName) {
        if (!(line.item_name || '').trim() || !(line.sku || '').trim()) {
          row.item_name = 'Select a catalog item (item name and SKU required)';
        }
      }

      const qty = parseInt(line.quantity, 10);
      if (!line.quantity || Number.isNaN(qty) || qty <= 0) {
        row.quantity = 'Quantity must be greater than 0';
      }

      if (Object.keys(row).length > 0) {
        lineErrors[line.id] = row;
        errors[`line_${index}`] = true;
      }
    });

    setRequestFormErrors(errors);
    setBulkLineErrors(lineErrors);
    return Object.keys(lineErrors).length === 0 && !errors.request_reason && !errors.bulk;
  };

  const checkLineAvailability = async (payload) => {
    const params = new URLSearchParams();
    params.set('categoryName', payload.category_name);
    if (payload.gender) params.set('gender', payload.gender);
    if (payload.type) params.set('type', payload.type);
    if (payload.size) params.set('size', payload.size);
    if (payload.item_name) params.set('itemName', payload.item_name);
    if (payload.sku) params.set('sku', payload.sku);

    const result = await apiRequest(
      `/merchandise-requests/inventory/availability?${params.toString()}`
    );
    const data = result?.data && typeof result.data === 'object' ? result.data : result;
    if (data?.available === false) {
      const reason =
        data.failureReason ||
        data.message ||
        data.status ||
        'Item is not available in RHET Inventory';
      throw new Error(reason);
    }
    return data;
  };

  const handleRequestSubmit = async (e) => {
    e.preventDefault();

    if (!validateBulkRequestForm()) {
      return;
    }

    setSubmitting(true);
    try {
      const sharedReason = requestFormData.request_reason.trim();
      const payloads = bulkRequestLines.map((line) =>
        buildCatalogRequestPayload(line, sharedReason)
      );

      for (let i = 0; i < payloads.length; i += 1) {
        const payload = payloads[i];
        if (
          resolveRequestStockFormMode({
            categoryName: payload.category_name,
            categoryKind: payload.category_kind,
          }) === 'kit'
        ) {
          continue;
        }
        try {
          await checkLineAvailability(payload);
        } catch (availErr) {
          const msg = String(availErr.message || '');
          const status = availErr?.response?.status;
          const skip =
            msg.includes('not configured') ||
            msg.includes('INTEGRATION_DISABLED') ||
            msg.includes('503') ||
            msg.includes('502') ||
            msg.includes('timeout') ||
            msg.includes('timed out') ||
            msg.includes('Could not reach') ||
            msg.includes('Bad Gateway') ||
            msg.includes('unexpected error') ||
            status === 502 ||
            status === 503 ||
            status === 504;
          if (!skip) {
            appAlert(
              `Row ${i + 1} (${payload.category_name}): ${msg || 'Not available in RHET Inventory'}`
            );
            setSubmitting(false);
            return;
          }
        }
      }

      const body = {
        request_reason: sharedReason,
        items: payloads,
      };
      if (branchId) {
        body.branch_id = branchId;
      }

      const response = await apiRequest('/merchandise-requests/batch', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const inventoryIntegrated = Boolean(response?.inventoryIntegrated);
      const createdRows = Array.isArray(response?.data) ? response.data : [];
      const successCount = createdRows.length || payloads.length;

      if (typeof onSubmitted === 'function') {
        await onSubmitted({ response, successCount, inventoryIntegrated });
      }

      onClose?.();
      appAlert(
        `${successCount} stock request${successCount === 1 ? '' : 's'} submitted successfully! ${
          inventoryIntegrated
            ? 'Sent to RHET Central Inventory as one request group. Stock will be added to your branch when inventory marks it delivered.'
            : 'Superadmin will be notified.'
        }`
      );
    } catch (err) {
      appAlert(err.message || 'Failed to submit stock request');
      console.error('Error submitting request:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 backdrop-blur-sm bg-black/5 flex items-center justify-center z-[9999] p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] min-h-0 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg gap-3">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Request Merchandise Stock</h2>
            <p className="text-sm text-gray-500 mt-1">
              Choose a merchandise category already added for this branch, then the exact RHET variant or item. Each row is a separate request.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            aria-label="Close"
            disabled={submitting}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleRequestSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="p-4 sm:p-6 flex flex-col flex-1 min-h-0 overflow-hidden gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-shrink-0">
              <div>
                <label className="label-field">Request Date</label>
                <input type="text" value={requestDateDisplay} className="input-field bg-gray-50 cursor-not-allowed" readOnly />
              </div>
              <div>
                <label className="label-field">Requested By</label>
                <input type="text" value={requestedByDisplay} className="input-field bg-gray-50 cursor-not-allowed" readOnly />
              </div>
            </div>

            {(catalogLoading || catalogError || catalogWarning) && (
              <div
                className={`flex-shrink-0 rounded-lg border px-3 py-2 text-sm flex items-start justify-between gap-3 ${
                  catalogLoading
                    ? 'border-blue-100 bg-blue-50 text-blue-800'
                    : catalogError
                      ? 'border-red-200 bg-red-50 text-red-800'
                      : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <span>
                  {catalogLoading
                    ? 'Loading RHET Inventory catalog…'
                    : catalogError || catalogWarning}
                </span>
                {!catalogLoading && (catalogError || catalogWarning) && (
                  <button
                    type="button"
                    onClick={loadInventoryCatalog}
                    className="underline font-medium flex-shrink-0"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {!catalogLoading && !catalogError && merchandiseTypeList.length === 0 && (
              <div className="flex-shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                No merchandise types on this branch yet. Add a Merchandise Type first, then request stock for it.
              </div>
            )}

            {!catalogLoading &&
              !catalogError &&
              merchandiseTypeList.length > 0 &&
              requestStockCategoryOptions.length === 0 && (
              <div className="flex-shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Branch types exist but none match the live RHET catalog. Re-add types using exact RHET category names.
              </div>
            )}

            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex items-center justify-between gap-3 mb-2 flex-shrink-0">
                <label className="label-field mb-0">Items</label>
                <button
                  type="button"
                  onClick={addBulkRequestLine}
                  disabled={
                    catalogLoading ||
                    !!catalogError ||
                    requestStockCategoryOptions.length === 0
                  }
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-800 bg-[#F7C844] hover:bg-[#f0c033] rounded-lg transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add row
                </button>
              </div>
              {requestFormErrors.bulk && (
                <p className="mb-2 text-sm text-red-600 flex-shrink-0">{requestFormErrors.bulk}</p>
              )}
              <div
                className="rounded-lg border border-gray-200 flex-1 min-h-[140px] max-h-[min(48vh,420px)] overflow-x-auto overflow-y-auto"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 #f7fafc',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '720px' }}>
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                        Category
                      </th>
                      <th className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                        Variant / Item
                      </th>
                      <th
                        className="px-2 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider bg-gray-50"
                        style={{ width: '100px' }}
                      >
                        Qty
                      </th>
                      <th className="px-1 py-2 bg-gray-50" style={{ width: '40px' }}>
                        {' '}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {bulkRequestLines.map((line, rowIndex) => {
                      const lineErr = bulkLineErrors[line.id] || {};
                      const categoryKind =
                        line.category_kind ||
                        findCatalogCategoryKind(
                          inventoryCatalog.categories,
                          line.category_name
                        );
                      const formMode = resolveRequestStockFormMode({
                        categoryName: line.category_name,
                        categoryKind,
                      });
                      const isUniform = formMode === 'uniform';
                      const isLearningKit = formMode === 'kit';
                      const lcaShirt = isLcaShirtCategory(
                        line.category_name,
                        categoryKind
                      );
                      const genderOpts = getUniformGenderOptions(
                        inventoryCatalog.items,
                        line.category_name
                      );
                      const typeOpts = getUniformTypeOptions(
                        inventoryCatalog.items,
                        line.category_name,
                        line.gender
                      );
                      const sizeOpts = getUniformSizeOptions(
                        inventoryCatalog.items,
                        line.category_name,
                        line.gender,
                        line.type
                      );
                      const nonUniformItems = getRequestStockCatalogItemsForCategory(
                        inventoryCatalog.items,
                        line.category_name
                      );
                      const catalogItemKey =
                        line.catalog_item_key ||
                        (line.sku || line.item_name
                          ? `${line.sku}|${line.item_name}|${line.inventory_id || ''}`
                          : '');
                      const categoryOptions = requestStockCategoryOptions;

                      return (
                        <tr key={line.id}>
                          <td className="px-2 py-2 align-top">
                            <select
                              value={line.category_name}
                              onChange={(e) =>
                                handleBulkLineChange(line.id, 'category_name', e.target.value)
                              }
                              className={`input-field text-sm py-1.5 w-full max-w-full min-w-0 ${
                                lineErr.category_name ? 'border-red-500' : ''
                              }`}
                              aria-label={`Category row ${rowIndex + 1}`}
                              disabled={catalogLoading}
                            >
                              <option value="">-- Select branch category --</option>
                              {categoryOptions.map((cat) => (
                                <option
                                  key={cat.categoryId || cat.categoryName}
                                  value={cat.categoryName}
                                >
                                  {cat.categoryName}
                                </option>
                              ))}
                            </select>
                            {lineErr.category_name && (
                              <p className="mt-1 text-[11px] text-red-600">{lineErr.category_name}</p>
                            )}
                            {!lineErr.category_name &&
                              !catalogLoading &&
                              requestStockCategoryOptions.length === 0 && (
                              <p className="mt-1 text-[11px] text-amber-700">
                                No branch categories available for request.
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            {!line.category_name ? (
                              <p className="text-xs text-gray-400 py-2">Select a category first</p>
                            ) : isLearningKit ? (
                              <LearningKitRequestFields
                                line={line}
                                catalogItems={inventoryCatalog.items}
                                catalogCategories={inventoryCatalog.categories}
                                lineError={lineErr}
                                disabled={catalogLoading}
                                onKitSelect={(value) =>
                                  handleBulkLineChange(line.id, 'catalog_item_key', value)
                                }
                                onComponentChange={(componentId, field, value) =>
                                  handleKitComponentChange(line.id, componentId, field, value)
                                }
                                onRemoveComponent={(componentId) =>
                                  handleRemoveKitComponent(line.id, componentId)
                                }
                              />
                            ) : isUniform ? (
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <div>
                                  <select
                                    value={line.gender}
                                    onChange={(e) =>
                                      handleBulkLineChange(line.id, 'gender', e.target.value)
                                    }
                                    className={`input-field text-sm py-1.5 w-full ${
                                      lineErr.gender ? 'border-red-500' : ''
                                    }`}
                                    aria-label={`Gender row ${rowIndex + 1}`}
                                  >
                                    <option value="">Gender</option>
                                    {genderOpts.map((g) => (
                                      <option key={g} value={g}>
                                        {g}
                                      </option>
                                    ))}
                                  </select>
                                  {lineErr.gender && (
                                    <p className="mt-1 text-[11px] text-red-600">{lineErr.gender}</p>
                                  )}
                                  {!genderOpts.length && (
                                    <p className="mt-1 text-[11px] text-amber-700">
                                      No gender options in catalog for this category.
                                    </p>
                                  )}
                                </div>
                                <div>
                                  <select
                                    value={line.type}
                                    onChange={(e) =>
                                      handleBulkLineChange(line.id, 'type', e.target.value)
                                    }
                                    className={`input-field text-sm py-1.5 w-full ${
                                      lineErr.type ? 'border-red-500' : ''
                                    }`}
                                    aria-label={
                                      lcaShirt
                                        ? `Logo row ${rowIndex + 1}`
                                        : `Type row ${rowIndex + 1}`
                                    }
                                  >
                                    <option value="">
                                      {lcaShirt ? 'Logo' : 'Type'}
                                    </option>
                                    {typeOpts.map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>
                                  {lineErr.type && (
                                    <p className="mt-1 text-[11px] text-red-600">{lineErr.type}</p>
                                  )}
                                  {!typeOpts.length && (
                                    <p className="mt-1 text-[11px] text-amber-700">
                                      No {lcaShirt ? 'logo' : 'type'} options in catalog.
                                    </p>
                                  )}
                                </div>
                                <div>
                                  <select
                                    value={line.size}
                                    onChange={(e) =>
                                      handleBulkLineChange(line.id, 'size', e.target.value)
                                    }
                                    className={`input-field text-sm py-1.5 w-full ${
                                      lineErr.size ? 'border-red-500' : ''
                                    }`}
                                    aria-label={`Size row ${rowIndex + 1}`}
                                  >
                                    <option value="">Size</option>
                                    {sizeOpts.map((sz) => (
                                      <option key={sz} value={sz}>
                                        {sz}
                                      </option>
                                    ))}
                                  </select>
                                  {lineErr.size && (
                                    <p className="mt-1 text-[11px] text-red-600">{lineErr.size}</p>
                                  )}
                                  {!sizeOpts.length && (
                                    <p className="mt-1 text-[11px] text-amber-700">
                                      No size options in catalog for this selection.
                                    </p>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <select
                                  value={catalogItemKey}
                                  onChange={(e) =>
                                    handleBulkLineChange(
                                      line.id,
                                      'catalog_item_key',
                                      e.target.value
                                    )
                                  }
                                  className={`input-field text-sm py-1.5 w-full max-w-full min-w-0 ${
                                    lineErr.item_name ? 'border-red-500' : ''
                                  }`}
                                  aria-label={`Item row ${rowIndex + 1}`}
                                >
                                  <option value="">-- Select catalog item --</option>
                                  {nonUniformItems.map((item) => {
                                    const key = catalogItemSelectKey(item);
                                    return (
                                      <option key={key} value={key}>
                                        {formatNonUniformItemLabel(item)}
                                      </option>
                                    );
                                  })}
                                </select>
                                {lineErr.item_name && (
                                  <p className="mt-1 text-[11px] text-red-600">{lineErr.item_name}</p>
                                )}
                                {!nonUniformItems.length && (
                                  <p className="mt-1 text-[11px] text-amber-700">
                                    No catalog items for this category.
                                  </p>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="number"
                              min="1"
                              value={line.quantity}
                              onChange={(e) =>
                                handleBulkLineChange(line.id, 'quantity', e.target.value)
                              }
                              className={`input-field text-sm py-1.5 w-full ${
                                lineErr.quantity ? 'border-red-500' : ''
                              }`}
                              placeholder="0"
                              aria-label={`Quantity row ${rowIndex + 1}`}
                            />
                            {lineErr.quantity && (
                              <p className="mt-1 text-[11px] text-red-600">{lineErr.quantity}</p>
                            )}
                          </td>
                          <td className="px-1 py-2 align-top text-right">
                            <button
                              type="button"
                              onClick={() => removeBulkRequestLine(line.id)}
                              disabled={bulkRequestLines.length <= 1}
                              className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400 rounded transition-colors"
                              title="Remove row"
                              aria-label={`Remove row ${rowIndex + 1}`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex-shrink-0">
              <label htmlFor="request_reason_bulk" className="label-field">
                Reason for Request <span className="text-red-500">*</span>
              </label>
              <textarea
                id="request_reason_bulk"
                name="request_reason"
                value={requestFormData.request_reason}
                onChange={handleRequestInputChange}
                className={`input-field min-h-[72px] resize-y ${
                  requestFormErrors.request_reason ? 'border-red-500' : ''
                }`}
                required
                placeholder="Please explain why you need this stock (min. 5 characters)..."
                rows={3}
              />
              {requestFormErrors.request_reason && (
                <p className="mt-1 text-sm text-red-600">{requestFormErrors.request_reason}</p>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Applied to every item. Categories and items come from RHET Inventory — local
                names like &quot;LCA Bag&quot; are not sent.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 sm:gap-3 p-4 sm:p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              disabled={submitting || catalogLoading || !!catalogError}
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
