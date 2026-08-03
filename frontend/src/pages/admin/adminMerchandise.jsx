import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../../config/api';
import MerchandiseImageUpload from '../../components/MerchandiseImageUploadS3';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateManila, formatDateTimeManila } from '../../utils/dateUtils';
import { appAlert, appConfirm } from '../../utils/appAlert';
import {
  UNIFORM_SIZE_OPTIONS,
  getUniformPieceOptions,
  getUniformPieceLabels,
  getUniformGenderOptions as getMerchandiseFormGenderOptions,
  isUniformMerchandiseName,
  requiresUniformPieceFields,
  countUniformPiecesByType,
  normalizeMerchandiseAttributes,
  formatUniformSizeDisplayLabel,
} from '../../utils/uniformMerchandise';
import MerchandiseReleaseLogsPanel from '../../components/merchandise/MerchandiseReleaseLogsPanel';
import RhetCategorySelect from '../../components/merchandise/RhetCategorySelect';
import LearningKitRequestFields from '../../components/merchandise/LearningKitRequestFields';
import TrackRequestProgressModal from '../../components/merchandise/TrackRequestProgressModal';
import RequestActionsMenu from '../../components/merchandise/RequestActionsMenu';
import MerchandiseRequestStatusModules from '../../components/merchandise/MerchandiseRequestStatusModules';
import FixedTablePagination, {
  TablePaginationSummary,
} from '../../components/table/FixedTablePagination';
import { getMerchandiseRequestApprovedBy } from '../../utils/merchandiseRequests/approvedBy';
import {
  DEFAULT_REQUEST_STATUS_MODULE,
  filterRequestsByStatusModule,
  getRequestStatusModuleMeta,
  paginateRequestList,
  REQUEST_STATUS_MODULE_PAGE_SIZE,
} from '../../utils/merchandiseRequests/requestStatusModules';
import { buildMerchandiseRequestActionItems } from '../../utils/merchandiseRequests/requestActionMenu';
import {
  createEmptyCatalogRequestLine,
  unwrapCatalogPayload,
  isUniformLikeCategory,
  isLcaShirtCategory,
  resolveRequestStockFormMode,
  findCatalogCategoryKind,
  getCatalogItemsForCategory,
  getUniformGenderOptions,
  getUniformTypeOptions,
  getUniformSizeOptions,
  formatNonUniformItemLabel,
  buildCatalogRequestPayload,
  findCatalogItemByKey,
  catalogItemSelectKey,
} from '../../utils/merchandiseRequests/catalogOptions';
import {
  isLearningKitMerchandiseName,
  getLearningKitRecipe,
  buildKitComponentsFromRecipe,
  validateKitLineComponents,
} from '../../utils/merchandiseRequests/learningKit';
import {
  getCreateMerchandiseCategoryOptions,
  getRequestStockCategoryOptions,
  applyCreateTypeCategoryDefaults,
  isInventoryIntegrationDisabledError,
  isMerchandiseTypeShellRow,
} from '../../utils/merchandiseRequests/createTypeCategory';
import { useMerchandiseLiveRefresh } from '../../hooks/useMerchandiseLiveRefresh';
import {
  isItemNamedStockCategory,
  isUniformStockCategory,
  formatMerchandiseStockItemName,
  formatMerchandiseStockSku,
  getMerchandiseStockItemName,
  getMerchandiseStockSku,
} from '../../utils/merchandiseStock';

const createEmptyBulkLine = createEmptyCatalogRequestLine;

const AdminMerchandise = () => {
  const location = useLocation();
  const { userInfo } = useAuth();
  // Get admin's branch_id from userInfo
  const adminBranchId = userInfo?.branch_id || userInfo?.branchId;
  // Removed branches state - admin only sees their branch
  const [merchandise, setMerchandise] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Admin always uses their branch
  const selectedBranchId = adminBranchId;
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');
  const [viewingStocksFor, setViewingStocksFor] = useState(null); // merchandise_name
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isRequestingSpecificStock, setIsRequestingSpecificStock] = useState(false);
  const [modalStep, setModalStep] = useState('form'); // Removed branch-selection - admin only sees their branch
  // Removed selectedBranch - admin only sees their branch
  const [editingMerchandise, setEditingMerchandise] = useState(null);
  const [formData, setFormData] = useState({
    merchandise_name: '',
    size: '',
    quantity: '',
    price: '',
    branch_id: '',
    gender: '',
    type: '',
    image_url: '',
    remarks: '',
    item_name: '',
    sku: '',
  });
  const [requestFormData, setRequestFormData] = useState({
    request_reason: '',
  });
  const [bulkRequestLines, setBulkRequestLines] = useState([createEmptyBulkLine()]);
  const [bulkLineErrors, setBulkLineErrors] = useState({});
  const [inventoryCatalog, setInventoryCatalog] = useState({ categories: [], items: [] });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [inventoryIntegrationEnabled, setInventoryIntegrationEnabled] = useState(true);
  const [editingMerchandiseType, setEditingMerchandiseType] = useState(null); // For editing merchandise type (not individual stock)
  const [formErrors, setFormErrors] = useState({});
  const [requestFormErrors, setRequestFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [requiresSizing, setRequiresSizing] = useState(false); // Toggle for uniform/sizing
  /** Stocks list filters (uniforms): gender, piece type, size */
  const [stockFilters, setStockFilters] = useState({ gender: '', type: '', size: '' });
  const [openMenuId, setOpenMenuId] = useState(null); // Track which merchandise type's menu is open
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' | 'requests' | 'logs'
  const [requestStatusModule, setRequestStatusModule] = useState(DEFAULT_REQUEST_STATUS_MODULE);
  /** Page number per status module so switching tabs keeps each module's page. */
  const [requestModulePageByStatus, setRequestModulePageByStatus] = useState({});
  const [trackingRequest, setTrackingRequest] = useState(null);

  const requestedByDisplay =
    (userInfo?.nickname && String(userInfo.nickname).trim()) ||
    userInfo?.full_name ||
    userInfo?.fullName ||
    userInfo?.email ||
    'Admin';
  const requestDateDisplay = formatDateManila(new Date());
  const merchandiseTypeList = (() => {
    // Lightweight unique names for excluding already-added RHET categories from create-type dropdown
    const names = new Set();
    (merchandise || []).forEach((item) => {
      if (item?.branch_id === adminBranchId && item?.merchandise_name) {
        names.add(String(item.merchandise_name).trim());
      }
    });
    return [...names];
  })();
  const createTypeCategoryOptions = getCreateMerchandiseCategoryOptions(inventoryCatalog, {
    excludeLearningKit: true,
    excludeNames: merchandiseTypeList,
  });
  /** Request Stock: only categories already added as types on this branch. */
  const requestStockCategoryOptions = getRequestStockCategoryOptions(
    inventoryCatalog,
    merchandiseTypeList
  );
  const isCreateTypeMode =
    !editingMerchandise && !editingMerchandiseType && !viewingStocksFor;

  const applyRhetCategoryToCreateForm = (categoryName) => {
    const defaults = applyCreateTypeCategoryDefaults(categoryName, {
      categories: inventoryCatalog.categories,
    });
    setFormData((prev) => ({
      ...prev,
      merchandise_name: defaults.merchandise_name,
      gender: '',
      type: '',
      size: '',
    }));
    setRequiresSizing(false);
    if (formErrors.merchandise_name) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next.merchandise_name;
        return next;
      });
    }
  };

  // Fetch branch name if not in userInfo
  useEffect(() => {
    const fetchBranchName = async () => {
      if (!userInfo?.branch_name && adminBranchId) {
        try {
          const response = await apiRequest(`/branches/${adminBranchId}`);
          if (response && response.data && response.data.branch_name) {
            setSelectedBranchName(response.data.branch_name);
          }
        } catch (err) {
          console.error('Error fetching branch name:', err);
        }
      } else if (userInfo?.branch_name) {
        setSelectedBranchName(userInfo.branch_name);
      }
    };

    fetchBranchName();
  }, [userInfo, adminBranchId]);

  useEffect(() => {
    // Don't fetch branches for admin - they only see their branch
    if (adminBranchId) {
      fetchMerchandiseByBranch(adminBranchId);
      fetchMerchandiseRequests();
    }
  }, [adminBranchId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('notificationTab') || params.get('tab');
    if (tab === 'requests') setActiveTab('requests');
    if (tab === 'logs') setActiveTab('logs');
  }, [location.search]);

  // Auto-set branch_id from adminBranchId when available
  useEffect(() => {
    if (adminBranchId && isModalOpen && !editingMerchandise && !editingMerchandiseType) {
      setFormData(prev => ({
        ...prev,
        branch_id: adminBranchId.toString(),
      }));
    }
  }, [adminBranchId, isModalOpen, editingMerchandise, editingMerchandiseType]);

  // Removed fetchBranches - admin only sees their branch

  const fetchMerchandiseByBranch = async (branchId, { silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      // Fetch merchandise filtered by branch_id from backend
      const response = await apiRequest(`/merchandise?branch_id=${branchId}&limit=100`);
      setMerchandise(response.data || []);
      if (!silent) setError('');
    } catch (err) {
      if (!silent) setError(err.message || 'Failed to fetch merchandise');
      console.error('Error fetching merchandise:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchMerchandiseRequests = async () => {
    try {
      const response = await apiRequest('/merchandise-requests?limit=100');
      const next = response.data || [];
      setRequests(next);
      setTrackingRequest((prev) => {
        if (!prev?.request_id) return prev;
        const updated = next.find(
          (r) => String(r.request_id) === String(prev.request_id)
        );
        return updated || prev;
      });
    } catch (err) {
      console.error('Error fetching merchandise requests:', err);
    }
  };

  // Auto-refresh when RHET ships / delivers — no manual page reload required
  useMerchandiseLiveRefresh({
    enabled: Boolean(adminBranchId),
    requests,
    onRefresh: async () => {
      await fetchMerchandiseRequests();
      if (adminBranchId) {
        await fetchMerchandiseByBranch(adminBranchId, { silent: true });
      }
    },
  });

  // Keep each status module on a valid page after list changes (live refresh / cancel)
  useEffect(() => {
    setRequestModulePageByStatus((prev) => {
      const current = prev[requestStatusModule] || 1;
      const filtered = filterRequestsByStatusModule(requests, requestStatusModule);
      const paged = paginateRequestList(
        filtered,
        current,
        REQUEST_STATUS_MODULE_PAGE_SIZE
      );
      if (paged.page === current) return prev;
      return { ...prev, [requestStatusModule]: paged.page };
    });
  }, [requests, requestStatusModule]);

  // Removed handleViewMerch and handleBackToBranches - admin only sees their branch

  const handleViewStocks = (merchandiseName) => {
    setOpenMenuId(null);
    setStockFilters({ gender: '', type: '', size: '' });
    setViewingStocksFor(merchandiseName);
  };

  const handleBackToMerchandise = () => {
    setViewingStocksFor(null);
    setStockFilters({ gender: '', type: '', size: '' });
  };

  const handleDelete = async (merchandiseId) => {
    // Verify merchandise belongs to admin's branch
    const item = merchandise.find(m => m.merchandise_id === merchandiseId);
    if (item && item.branch_id !== adminBranchId) {
      appAlert('You can only delete merchandise from your branch.');
      return;
    }
    
    if (
      !(await appConfirm({
        title: 'Delete merchandise',
        message: 'Are you sure you want to delete this merchandise?',
        destructive: true,
        confirmLabel: 'Delete',
      }))
    ) {
      return;
    }

    try {
      await apiRequest(`/merchandise/${merchandiseId}`, {
        method: 'DELETE',
      });
      if (adminBranchId) {
        fetchMerchandiseByBranch(adminBranchId);
      }
    } catch (err) {
      appAlert(err.message || 'Failed to delete merchandise');
    }
  };

  const handleDeleteMerchandiseType = async (merchandiseName) => {
    if (
      !(await appConfirm({
        title: 'Delete all items',
        message: `Are you sure you want to delete all items of "${merchandiseName}"? This action cannot be undone.`,
        destructive: true,
        confirmLabel: 'Delete all',
      }))
    ) {
      return;
    }

    try {
      setOpenMenuId(null);
      // Get all merchandise items of this type for the current branch
      const itemsToDelete = merchandise.filter(
        item => item.branch_id === adminBranchId && 
                 item.merchandise_name === merchandiseName
      );

      // Delete all items
      for (const item of itemsToDelete) {
        await apiRequest(`/merchandise/${item.merchandise_id}`, {
          method: 'DELETE',
        });
      }

      // Refresh the merchandise list
      if (adminBranchId) {
        await fetchMerchandiseByBranch(adminBranchId);
      }
    } catch (err) {
      appAlert(err.message || 'Failed to delete merchandise type');
    }
  };

  const openCreateModal = () => {
    setEditingMerchandise(null);
    setError('');

    // If we're in stocks view, pre-fill merchandise_name and branch_id
    if (viewingStocksFor && adminBranchId) {
      // Check if this merchandise type requires sizing
      setRequiresSizing(requiresSizingForMerchandise(viewingStocksFor));
      setModalStep('form');
      setFormData({
        merchandise_name: viewingStocksFor,
        size: '',
        quantity: '',
        price: '',
        branch_id: adminBranchId.toString(),
        gender: '',
        type: '',
        image_url: '',
        remarks: '',
        item_name: '',
        sku: '',
      });
      setEditingMerchandiseType(null);
    } else if (adminBranchId) {
      // If we're in merchandise types view, pre-fill branch_id
      setRequiresSizing(false);
      setModalStep('form');
      setFormData({
        merchandise_name: '',
        size: '',
        quantity: '',
        price: '',
        branch_id: adminBranchId.toString(),
        gender: '',
        type: '',
        image_url: '',
        remarks: '',
        item_name: '',
        sku: '',
      });
      setEditingMerchandiseType(null);
      void loadInventoryCatalog();
    }
    setFormErrors({});
    setIsModalOpen(true);
  };

  // Open request modal from global "Request Stock" button (catalog-driven bulk form)
  const openRequestModal = () => {
    setIsRequestModalOpen(true);
    setIsRequestingSpecificStock(false);
    setBulkRequestLines([createEmptyBulkLine()]);
    setBulkLineErrors({});
    setRequestFormData({ request_reason: '' });
    setRequestFormErrors({});
    setCatalogError('');
    void loadInventoryCatalog();
  };

  const loadInventoryCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError('');
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
          setInventoryIntegrationEnabled(false);
          setInventoryCatalog({ categories: [], items: [] });
          setCatalogError('');
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
        // One automatic retry for transient RHET / network failures
        await new Promise((r) => setTimeout(r, 1200));
        catalog = await attempt();
      }
      setInventoryIntegrationEnabled(true);
      setInventoryCatalog(catalog);
      if (!catalog.categories.length) {
        setCatalogError(
          'No RHET Inventory categories returned. Check inventory integration or try again.'
        );
      } else if (catalog?.meta?.stale || catalog?.meta?.cached) {
        setCatalogError(
          'Loaded a recent cached RHET catalog (inventory is slow right now). You can continue, or tap Reload catalog.'
        );
      }
    } catch (err) {
      if (isInventoryIntegrationDisabledError(err)) {
        setInventoryIntegrationEnabled(false);
        setInventoryCatalog({ categories: [], items: [] });
        setCatalogError('');
      } else {
        setInventoryIntegrationEnabled(true);
        setInventoryCatalog({ categories: [], items: [] });
        setCatalogError(
          err.message ||
            'Could not load RHET Inventory catalog. Request Stock requires a live catalog.'
        );
      }
    } finally {
      setCatalogLoading(false);
    }
  };

  const closeRequestModal = () => {
    setIsRequestModalOpen(false);
    setIsRequestingSpecificStock(false);
    setBulkRequestLines([createEmptyBulkLine()]);
    setBulkLineErrors({});
    setRequestFormData({ request_reason: '' });
    setRequestFormErrors({});
    setCatalogError('');
  };

  const addBulkRequestLine = () => {
    setBulkRequestLines((prev) => [...prev, createEmptyBulkLine()]);
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
          const items = getCatalogItemsForCategory(inventoryCatalog.items, line.category_name);
          const selected = findCatalogItemByKey(items, value);
          updated.item_name = selected?.itemName || '';
          updated.sku = selected?.sku || '';
          updated.inventory_id = selected?.inventoryId || '';
          updated.catalog_item_key = selected ? catalogItemSelectKey(selected) : value;
          if (isLearningKitMerchandiseName(line.category_name)) {
            const recipe = getLearningKitRecipe({
              itemName: updated.item_name,
              sku: updated.sku,
            });
            const kitQty = Math.max(1, parseInt(updated.quantity, 10) || 1);
            updated.components = recipe
              ? buildKitComponentsFromRecipe(recipe, kitQty)
              : [];
          }
        }
        if (field === 'quantity' && isLearningKitMerchandiseName(line.category_name)) {
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
            const items = getCatalogItemsForCategory(
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

  const handleAddKitComponent = (lineId, component) => {
    setBulkRequestLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? { ...line, components: [...(line.components || []), component] }
          : line
      )
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

  const openEditModal = (item) => {
    // Verify merchandise belongs to admin's branch
    if (item.branch_id !== adminBranchId) {
      appAlert('You can only edit merchandise from your branch.');
      return;
    }
    
    setEditingMerchandise(item);
    setEditingMerchandiseType(null);
    setError('');
    setModalStep('form');
    // Removed setSelectedBranch - admin only sees their branch
    setRequiresSizing(
      isUniformMerchandiseName(item.merchandise_name) ||
        requiresSizingForMerchandise(item.merchandise_name) ||
        !!item.size
    );
    setFormData({
      merchandise_name: item.merchandise_name || '',
      size: item.size || '',
      quantity: item.quantity?.toString() || '',
      price: item.price?.toString() || '',
      branch_id: item.branch_id ? item.branch_id.toString() : adminBranchId?.toString() || '',
      gender: item.gender || '',
      type: item.type || '',
      image_url: item.image_url || '',
      remarks: item.remarks || '',
      item_name: getMerchandiseStockItemName(item),
      sku: getMerchandiseStockSku(item),
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditMerchandiseTypeModal = (merchType) => {
    setOpenMenuId(null);
    setEditingMerchandise(null);
    setEditingMerchandiseType(merchType);
    setError('');
    setModalStep('form');
    // Removed setSelectedBranch - admin only sees their branch
    // Get the first item of this type to get image_url
    const sampleItem = merchandise.find(
      item => item.branch_id === adminBranchId && 
               item.merchandise_name === merchType.name &&
               item.image_url
    ) || merchandise.find(
      item => item.branch_id === adminBranchId && 
               item.merchandise_name === merchType.name
    );
    
    setFormData({
      merchandise_name: merchType.name || '',
      size: '',
      quantity: '',
      price: '',
      branch_id: adminBranchId?.toString() || '',
      gender: '',
      type: '',
      image_url: merchType.image_url || sampleItem?.image_url || '',
      remarks: sampleItem?.remarks || merchType.remarks || '',
      item_name: '',
      sku: '',
    });
    setFormErrors({});
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingMerchandise(null);
    setEditingMerchandiseType(null);
    setModalStep('form'); // Removed branch-selection step
    // Removed setSelectedBranch - admin only sees their branch
    setFormErrors({});
    setRequiresSizing(false);

  };

  // Removed handleBranchSelect and handleBackToBranchSelection - admin only sees their branch

  // Get stocks for a specific merchandise name (filtered by branch and merchandise name)
  // Moved up for use in requiresSizingForMerchandise
  const getStocksByMerchandiseName = (merchandiseName) => {
    if (!adminBranchId || !merchandiseName) return [];

    // Exclude type-shell rows (category + image only) — View Stocks stays empty until real stock.
    const filteredStocks = merchandise.filter(
      (item) =>
        item.branch_id === adminBranchId &&
        item.merchandise_name === merchandiseName &&
        !isMerchandiseTypeShellRow(item)
    );

    return filteredStocks.map((item) => ({
      merchandise_id: item.merchandise_id,
      size: item.size || 'N/A',
      quantity: item.quantity || 0,
      price: item.price || 0,
      gender: item.gender || '',
      type: item.type || '',
      remarks: item.remarks || '',
      item_name: item.item_name || '',
      sku: item.sku || '',
    }));
  };

  // Check if a merchandise type requires sizing
  // Moved up for use in handleRequestInputChange
  const requiresSizingForMerchandise = (merchandiseName) => {
    if (!merchandiseName) return false;
    
    if (isUniformMerchandiseName(merchandiseName)) {
      return true;
    }
    
    // Check if any stock item has a size (not null/empty/N/A)
    const stocks = getStocksByMerchandiseName(merchandiseName);
    return stocks.some(stock => stock.size && stock.size !== 'N/A' && stock.size.trim() !== '');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const updated = { ...prev, [name]: value };
      if (name === 'merchandise_name') {
        updated.type = '';
        if (!requiresUniformPieceFields(value)) {
          updated.gender = '';
        }
        if (!requiresSizingForMerchandise(value)) {
          updated.size = '';
        }
      }
      if (name === 'gender') {
        updated.type = '';
      }
      return updated;
    });
    if (formErrors[name]) {
      setFormErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const handleRequestInputChange = (e) => {
    const { name, value } = e.target;
    setRequestFormData((prev) => ({ ...prev, [name]: value }));
    if (requestFormErrors[name]) {
      setRequestFormErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
  };

  const validateForm = () => {
    const errors = {};

    // When editing merchandise type image only, we don't need merchandise_name validation
    if (!editingMerchandiseType && !formData.merchandise_name.trim()) {
      errors.merchandise_name = 'Merchandise category is required';
    }

    const name = formData.merchandise_name?.trim() || '';
    const creatingType =
      !editingMerchandise && !editingMerchandiseType && !viewingStocksFor;

    // New type must be an exact RHET category when catalog is available
    if (inventoryIntegrationEnabled && creatingType && name) {
      const allCatalog = getCreateMerchandiseCategoryOptions(inventoryCatalog, {
        excludeLearningKit: true,
      });
      if (
        allCatalog.length > 0 &&
        !allCatalog.some((c) => c.toLowerCase() === name.toLowerCase())
      ) {
        errors.merchandise_name =
          'Select a category from the RHET Inventory list (exact category name required).';
      }
    }

    if (creatingType && inventoryIntegrationEnabled && !formData.image_url?.trim()) {
      errors.image_url = 'Image is required for merchandise types';
    }

    // Add / Edit Stock: keep attribute validation (not on create-type shell)
    if (!creatingType && !editingMerchandiseType) {
      const needsSizing =
        requiresSizing ||
        requiresSizingForMerchandise(name) ||
        requiresUniformPieceFields(name);
      const isUniform = requiresUniformPieceFields(name);

      if (isUniform) {
        if (!formData.size?.trim() || ['n/a', 'na'].includes(formData.size.trim().toLowerCase())) {
          errors.size = 'Size is required for uniforms (cannot be N/A)';
        }
        if (!formData.gender?.trim()) {
          errors.gender = 'Gender is required for uniforms';
        }
        if (!formData.type?.trim()) {
          errors.type = isLcaShirtCategory(name) ? 'Logo is required' : 'Piece is required';
        }
      } else if (needsSizing && !formData.size?.trim()) {
        errors.size = 'Size is required for this merchandise type';
      }

      if (isItemNamedStockCategory(name) && (viewingStocksFor || editingMerchandise)) {
        if (!(formData.item_name || '').trim()) {
          errors.item_name =
            'Item name is required (RHET itemName, e.g. string-bag / nc-pk-worksheets)';
        }
        if (!(formData.sku || '').trim()) {
          errors.sku = 'SKU is required for non-uniform stock (from the same catalog row)';
        }
      }
    }

    if (formData.quantity && (isNaN(formData.quantity) || parseInt(formData.quantity) < 0)) {
      errors.quantity = 'Quantity must be a non-negative integer';
    }

    if (formData.price && (isNaN(formData.price) || parseFloat(formData.price) < 0)) {
      errors.price = 'Price must be a positive number';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
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

      if (categoryName && isLearningKitMerchandiseName(categoryName)) {
        const kitErr = validateKitLineComponents(line);
        if (kitErr) row.item_name = kitErr;
      } else if (
        categoryName &&
        resolveRequestStockFormMode({
          categoryName,
          categoryKind:
            line.category_kind ||
            findCatalogCategoryKind(inventoryCatalog.categories, categoryName),
        }) === 'uniform'
      ) {
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

  const validateRequestForm = () => validateBulkRequestForm();

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

  const findExistingUniformStockRow = ({
    merchandiseName,
    size,
    gender,
    type,
    branchId,
    excludeId = null,
  }) => {
    if (!merchandiseName || !branchId) return null;
    const sizeKey = String(size || '').trim();
    const genderKey = String(gender || '').trim();
    const typeKey = String(type || '').trim();
    return (
      merchandise.find((item) => {
        if (excludeId != null && String(item.merchandise_id) === String(excludeId)) return false;
        if (String(item.branch_id) !== String(branchId)) return false;
        if (String(item.merchandise_name || '').trim() !== String(merchandiseName).trim()) return false;
        if (String(item.size || '').trim() !== sizeKey) return false;
        if (String(item.gender || '').trim() !== genderKey) return false;
        if (String(item.type || '').trim() !== typeKey) return false;
        return true;
      }) || null
    );
  };

  const handleDuplicateUniformStock = async (existing, pieceLabel) => {
    const goEdit = await appConfirm({
      title: 'Stock already exists',
      message: `${pieceLabel} is already created for this branch.\n\nPlease edit that stock row to adjust the quantity instead of adding a duplicate.`,
      confirmLabel: 'Edit existing stock',
      cancelLabel: 'Cancel',
    });
    if (goEdit && existing) {
      closeModal();
      openEditModal(existing);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    if (
      !editingMerchandise &&
      !editingMerchandiseType &&
      requiresUniformPieceFields(formData.merchandise_name)
    ) {
      const branchId = adminBranchId || (formData.branch_id ? parseInt(formData.branch_id, 10) : null);
      const merchandiseName = formData.merchandise_name.trim();
      const size = formData.size?.trim() || '';
      const gender = formData.gender?.trim() || '';
      const piece = formData.type?.trim() || '';
      const existing = findExistingUniformStockRow({
        merchandiseName,
        size,
        gender,
        type: piece,
        branchId,
      });
      if (existing) {
        await handleDuplicateUniformStock(existing, `${gender} · ${piece} · ${size}`);
        return;
      }
    }

    setSubmitting(true);
    setError('');
    try {
      if (isLearningKitMerchandiseName(formData.merchandise_name)) {
        // Allowed local type — stock credited after RHET fulfill
      }
      const normalized = normalizeMerchandiseAttributes({
        merchandise_name: formData.merchandise_name.trim(),
        gender: formData.gender,
        size: formData.size,
        type: formData.type,
      });
      const creatingType =
        !editingMerchandise && !editingMerchandiseType && !viewingStocksFor;
      const basePayload = creatingType
        ? {
            merchandise_name: normalized.merchandise_name,
            size: null,
            quantity: null,
            price: null,
            branch_id: adminBranchId || (formData.branch_id ? parseInt(formData.branch_id, 10) : null),
            gender: null,
            type: null,
            image_url: formData.image_url || null,
            remarks: null,
            item_name: null,
            sku: null,
          }
        : {
            merchandise_name: normalized.merchandise_name,
            size: normalized.size,
            quantity: formData.quantity && formData.quantity !== '' ? parseInt(formData.quantity) : null,
            price: formData.price && formData.price !== '' ? parseFloat(formData.price) : null,
            branch_id: adminBranchId || (formData.branch_id ? parseInt(formData.branch_id) : null),
            gender: normalized.gender,
            type: normalized.type,
            image_url: formData.image_url || null,
            remarks: formData.remarks?.trim() || null,
            item_name: isItemNamedStockCategory(normalized.merchandise_name)
              ? formData.item_name?.trim() || null
              : null,
            sku: isItemNamedStockCategory(normalized.merchandise_name)
              ? formData.sku?.trim() || null
              : null,
          };
      
      if (editingMerchandise) {
        if (requiresUniformPieceFields(basePayload.merchandise_name)) {
          const existing = findExistingUniformStockRow({
            merchandiseName: basePayload.merchandise_name,
            size: basePayload.size,
            gender: basePayload.gender,
            type: basePayload.type,
            branchId: basePayload.branch_id || editingMerchandise.branch_id,
            excludeId: editingMerchandise.merchandise_id,
          });
          if (existing) {
            setSubmitting(false);
            await handleDuplicateUniformStock(
              existing,
              `${basePayload.gender} · ${basePayload.type} · ${basePayload.size}`
            );
            return;
          }
        }
        await apiRequest(`/merchandise/${editingMerchandise.merchandise_id}`, {
          method: 'PUT',
          body: JSON.stringify(basePayload),
        });
      } else if (editingMerchandiseType) {
        // When editing merchandise type, update all items of that type with the image
        // First, get all items of this type
        const itemsToUpdate = merchandise.filter(
          item => item.branch_id === adminBranchId && 
                   item.merchandise_name === editingMerchandiseType.name
        );
        
        // Update each item with the new image_url
        for (const item of itemsToUpdate) {
          await apiRequest(`/merchandise/${item.merchandise_id}`, {
            method: 'PUT',
            body: JSON.stringify({
              image_url: basePayload.image_url,
            }),
          });
        }
      } else {
        await apiRequest('/merchandise', {
          method: 'POST',
          body: JSON.stringify(basePayload),
        });
      }
      
      closeModal();
      // Refresh merchandise data to show updated images
      if (adminBranchId) {
        await fetchMerchandiseByBranch(adminBranchId);
      }
      // If we were viewing stocks, refresh the stocks view
      if (viewingStocksFor) {
        // The stocks will automatically update since merchandise state is refreshed
      }
    } catch (err) {
      // Extract detailed error message from response
      let errorMessage = err.message || `Failed to ${editingMerchandise ? 'update' : 'create'} merchandise`;
      
      // If there are validation errors, show them
      if (err.response?.data?.errors && Array.isArray(err.response.data.errors)) {
        const validationErrors = err.response.data.errors.map(e => e.msg || e.message).join(', ');
        errorMessage = `Validation failed: ${validationErrors}`;
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      }
      
      setError(errorMessage);
      console.error('Error saving merchandise:', err);
      if (err.response?.data?.errors) {
        console.error('Validation errors:', err.response.data.errors);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestSubmit = async (e) => {
    e.preventDefault();

    if (!validateRequestForm()) {
      return;
    }

    setSubmitting(true);
    try {
      const sharedReason = requestFormData.request_reason.trim();
      const payloads = bulkRequestLines.map((line) =>
        buildCatalogRequestPayload(line, sharedReason)
      );

      // Prefer availability check before submit (block unmatched / out of stock).
      // Learning Kit: skip pre-check — kit stock is virtual/computed; components are
      // validated in CMS; RHET still validates on POST /stock-requests.
      for (let i = 0; i < payloads.length; i += 1) {
        const payload = payloads[i];
        if (isLearningKitMerchandiseName(payload.category_name)) {
          continue;
        }
        try {
          await checkLineAvailability(payload);
        } catch (availErr) {
          // Soft-skip when RHET/proxy is down or timed out — submit still validates.
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

      let successCount = 0;
      let inventoryIntegrated = false;
      const failures = [];
      for (let i = 0; i < payloads.length; i += 1) {
        const payload = payloads[i];
        const label = isUniformLikeCategory(
          payload.category_name,
          payload.category_kind
        )
          ? `${payload.category_name} ${payload.gender || ''} ${payload.type || ''} ${payload.size || ''}`.trim()
          : `${payload.category_name} / ${payload.item_name || payload.sku || 'item'}`;
        try {
          const response = await apiRequest('/merchandise-requests', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          inventoryIntegrated = Boolean(response?.inventoryIntegrated);
          successCount += 1;
        } catch (lineErr) {
          failures.push(`Row ${i + 1} (${label}): ${lineErr.message || 'Failed'}`);
        }
      }

      await fetchMerchandiseRequests();

      if (failures.length === 0) {
        closeRequestModal();
        appAlert(
          `${successCount} stock request${successCount === 1 ? '' : 's'} submitted successfully! ${
            inventoryIntegrated
              ? 'Sent to RHET Central Inventory. Stock will be added to your branch when inventory admin approves.'
              : 'Superadmin will be notified.'
          }`
        );
      } else if (successCount === 0) {
        appAlert(`Failed to submit stock request:\n${failures.join('\n')}`);
      } else {
        closeRequestModal();
        appAlert(
          `${successCount} of ${payloads.length} submitted. The rest failed:\n${failures.join('\n')}`
        );
      }
    } catch (err) {
      appAlert(err.message || 'Failed to submit stock request');
      console.error('Error submitting request:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestId) => {
    if (
      !(await appConfirm({
        title: 'Cancel request',
        message: 'Are you sure you want to cancel this request?',
        destructive: true,
        confirmLabel: 'Cancel request',
      }))
    ) {
      return;
    }

    try {
      await apiRequest(`/merchandise-requests/${requestId}/cancel`, {
        method: 'PUT',
      });
      
      // Refresh requests
      await fetchMerchandiseRequests();
      appAlert('Request cancelled successfully');
    } catch (err) {
      appAlert(err.message || 'Failed to cancel request');
    }
  };

  const handleConfirmDelivery = async (request) => {
    if (!request?.request_id) return;
    if (
      !(await appConfirm({
        title: 'Confirm received',
        message:
          'Confirm that this stock has arrived at your branch? This will mark the request as Delivered in RHET Inventory and add the quantity to your branch stock.',
        confirmLabel: 'Confirm received',
      }))
    ) {
      return;
    }

    try {
      setSubmitting(true);
      const response = await apiRequest(
        `/merchandise-requests/${request.request_id}/confirm-delivery`,
        {
          method: 'POST',
          body: JSON.stringify({
            notes: 'Branch admin confirmed physical receipt in CMS',
          }),
        }
      );
      await fetchMerchandiseRequests();
      setTrackingRequest(null);
      appAlert(
        response?.message ||
          'Receipt confirmed. Stock was added to your branch and RHET Inventory is now Delivered.'
      );
    } catch (err) {
      appAlert(err.message || 'Failed to confirm delivery. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Removed formatBranchName - admin only sees their branch

  // Get unique merchandise types for the selected branch with their images
  const getUniqueMerchandiseTypes = () => {
    if (!adminBranchId || !merchandise.length) return [];
    
    // Filter merchandise by branch_id
    const branchMerchandise = merchandise.filter(item => item.branch_id === adminBranchId && item.merchandise_name);
    
    // Group by merchandise_name and get the first item's image_url (or most recent)
    const typeMap = new Map();
    
    branchMerchandise.forEach(item => {
      const name = item.merchandise_name;
      if (!typeMap.has(name)) {
        // Get the first item with an image, or the first item if no image
        const withImage = branchMerchandise.find(i => i.merchandise_name === name && i.image_url);
        typeMap.set(name, {
          name,
          image_url: withImage?.image_url || item.image_url || null,
          // Get any item of this type for reference
          sampleItem: item,
        });
      } else {
        // Update if we find an item with an image
        const existing = typeMap.get(name);
        if (!existing.image_url && item.image_url) {
          existing.image_url = item.image_url;
        }
      }
    });
    
    // Convert to array and sort alphabetically
    return Array.from(typeMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  };

  const getStatusBadge = (status) => {
    const statusStyles = {
      Pending: 'bg-yellow-100 text-yellow-800',
      Shipped: 'bg-blue-100 text-blue-800',
      Delivered: 'bg-green-100 text-green-800',
      Approved: 'bg-green-100 text-green-800',
      Returned: 'bg-orange-100 text-orange-800',
      Rejected: 'bg-red-100 text-red-800',
      Cancelled: 'bg-gray-100 text-gray-800',
    };
    const label = status === 'Approved' ? 'Delivered' : status;

    return (
      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status] || 'bg-gray-100 text-gray-800'}`}>
        {label}
      </span>
    );
  };

  // Render modals function
  const renderModals = () => (
    <>
        {/* Create/Edit Merchandise Modal */}
      {isModalOpen && createPortal(
          <div 
          className="fixed inset-0 backdrop-blur-sm bg-black/5 flex items-center justify-center z-[9999] p-4"
            onClick={closeModal}
          >
            <div 
            className={`bg-white rounded-lg shadow-xl ${isCreateTypeMode || editingMerchandiseType ? 'max-w-lg w-full' : 'max-w-2xl w-full'} max-h-[90vh] flex flex-col overflow-hidden`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
                <div>
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  {editingMerchandiseType
                    ? 'Edit Merchandise Image'
                    : editingMerchandise
                      ? 'Edit Stock'
                      : viewingStocksFor
                        ? 'Add Stock'
                        : 'Add Merchandise Type'}
                  </h2>
                  {modalStep === 'form' && !editingMerchandise && (
                    <p className="text-sm text-gray-500 mt-1">
                      {editingMerchandiseType
                        ? 'Update the image for this merchandise type'
                        : viewingStocksFor
                          ? 'Fill in the stock details for this merchandise type'
                          : 'Pick a RHET Inventory category and set a display image. Stock and sizes come from Request Stock.'}
                    </p>
                  )}
                </div>
                <button
                  onClick={closeModal}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                <div className="p-6 overflow-y-auto flex-1">
                  {error && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                      {error}
                    </div>
                  )}
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2">
                        {viewingStocksFor && !editingMerchandise ? (
                          <>
                            <label htmlFor="merchandise_name" className="label-field">
                              Merchandise Name <span className="text-red-500">*</span>
                            </label>
                            <div>
                              <input
                                type="text"
                                value={formData.merchandise_name}
                                readOnly
                                className="input-field bg-gray-50 cursor-not-allowed"
                              />
                              <p className="mt-1 text-xs text-gray-500">Merchandise name is pre-filled from the selected type</p>
                            </div>
                          </>
                        ) : !editingMerchandise && !editingMerchandiseType ? (
                          <>
                            {inventoryIntegrationEnabled ? (
                              <>
                                <RhetCategorySelect
                                  id="merchandise_name"
                                  value={formData.merchandise_name}
                                  options={createTypeCategoryOptions}
                                  onChange={applyRhetCategoryToCreateForm}
                                  onRetry={loadInventoryCatalog}
                                  loading={catalogLoading}
                                  error={
                                    createTypeCategoryOptions.length === 0 && !catalogLoading
                                      ? catalogError || 'No categories loaded'
                                      : ''
                                  }
                                  className={formErrors.merchandise_name ? 'border-red-500' : ''}
                                />
                                {catalogError && createTypeCategoryOptions.length > 0 && (
                                  <p className="mt-1 text-xs text-amber-700">{catalogError}</p>
                                )}
                              </>
                            ) : (
                              <>
                                <label htmlFor="merchandise_name" className="label-field">
                                  Merchandise Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  id="merchandise_name"
                                  name="merchandise_name"
                                  value={formData.merchandise_name}
                                  onChange={handleInputChange}
                                  className={`input-field ${formErrors.merchandise_name ? 'border-red-500' : ''}`}
                                  required
                                  placeholder="Local merchandise type name (legacy mode)"
                                />
                                <p className="mt-1 text-xs text-gray-500">
                                  RHET Inventory integration is not configured — legacy free-text name.
                                </p>
                              </>
                            )}
                            {formErrors.merchandise_name && (
                              <p className="mt-1 text-sm text-red-600">{formErrors.merchandise_name}</p>
                            )}
                          </>
                        ) : editingMerchandiseType ? (
                          <>
                            <label className="label-field">Category</label>
                            <input
                              type="text"
                              value={formData.merchandise_name}
                              readOnly
                              className="input-field bg-gray-50 cursor-not-allowed"
                            />
                            <p className="mt-1 text-xs text-gray-500">
                              Category is locked after create (must stay exact RHET categoryName for fulfill matching).
                            </p>
                          </>
                        ) : (
                          <>
                            <label htmlFor="merchandise_name" className="label-field">
                              Merchandise Name <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              id="merchandise_name"
                              name="merchandise_name"
                              value={formData.merchandise_name}
                              onChange={handleInputChange}
                              className={`input-field ${formErrors.merchandise_name ? 'border-red-500' : ''}`}
                              required
                              placeholder="RHET category name"
                            />
                            {formErrors.merchandise_name && (
                              <p className="mt-1 text-sm text-red-600">{formErrors.merchandise_name}</p>
                            )}
                          </>
                        )}
                      </div>

                    <div className="md:col-span-2">
                        <label htmlFor="branch_id" className="label-field">
                          Branch <span className="text-red-500">*</span>
                        </label>
                        {/* Branch is auto-set to admin's branch - read-only display */}
                        <div>
                          <input
                            type="text"
                            value={selectedBranchName}
                            readOnly
                            className="input-field bg-gray-50 cursor-not-allowed"
                          />
                          <input
                            type="hidden"
                            id="branch_id"
                            name="branch_id"
                            value={formData.branch_id}
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            Branch is automatically set to your branch
                          </p>
                        </div>
                      </div>

                      {isCreateTypeMode && (
                        <div className="md:col-span-2">
                          <p className="text-xs text-gray-500 rounded-lg bg-gray-50 border border-gray-100 p-3">
                            Stock quantities, sizes, and variants come from{' '}
                            <strong>Request Stock</strong> / RHET Inventory — not from this form.
                          </p>
                        </div>
                      )}

                    {/* Only show these fields when adding/editing stock (not when adding merchandise type) */}
                    {(viewingStocksFor || editingMerchandise) && (
                      <>
                      {(requiresSizing || requiresSizingForMerchandise(formData.merchandise_name)) && (
                        <div>
                          <label htmlFor="size" className="label-field">
                            Size {requiresUniformPieceFields(formData.merchandise_name) ? '*' : ''}
                          </label>
                          <select
                            id="size"
                            name="size"
                            value={formData.size}
                            onChange={handleInputChange}
                            className={`input-field ${formErrors.size ? 'border-red-500' : ''}`}
                          >
                            <option value="">Select Size</option>
                            {UNIFORM_SIZE_OPTIONS.map((size) => (
                              <option key={size} value={size}>
                                {formatUniformSizeDisplayLabel(size)}
                              </option>
                            ))}
                            {formData.size &&
                              !UNIFORM_SIZE_OPTIONS.includes(formData.size) && (
                              <option value={formData.size}>{formData.size} (legacy)</option>
                            )}
                          </select>
                          {formErrors.size && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.size}</p>
                          )}
                        </div>
                      )}

                      {isItemNamedStockCategory(formData.merchandise_name) && (
                        <>
                          <div>
                            <label htmlFor="item_name" className="label-field">
                              Item name <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              id="item_name"
                              name="item_name"
                              value={formData.item_name}
                              onChange={handleInputChange}
                              className={`input-field ${formErrors.item_name ? 'border-red-500' : ''}`}
                              placeholder="RHET itemName (e.g. nc-pk-worksheets)"
                              required
                            />
                            {formErrors.item_name && (
                              <p className="mt-1 text-sm text-red-600">{formErrors.item_name}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                              Concrete product under this category — not the category title.
                            </p>
                          </div>
                          <div>
                            <label htmlFor="sku" className="label-field">
                              SKU <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              id="sku"
                              name="sku"
                              value={formData.sku}
                              onChange={handleInputChange}
                              className={`input-field ${formErrors.sku ? 'border-red-500' : ''}`}
                              placeholder="RHET SKU from the same catalog item"
                              required
                            />
                            {formErrors.sku && (
                              <p className="mt-1 text-sm text-red-600">{formErrors.sku}</p>
                            )}
                          </div>
                        </>
                      )}

                      <div>
                        <label htmlFor="quantity" className="label-field">
                          Quantity
                        </label>
                        <input
                          type="number"
                          min="0"
                          id="quantity"
                          name="quantity"
                          value={formData.quantity}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.quantity ? 'border-red-500' : ''}`}
                          placeholder="0"
                        />
                        {formErrors.quantity && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.quantity}</p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="price" className="label-field">
                          Price
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          id="price"
                          name="price"
                          value={formData.price}
                          onChange={handleInputChange}
                          className={`input-field ${formErrors.price ? 'border-red-500' : ''}`}
                          placeholder="0.00"
                        />
                        {formErrors.price && (
                          <p className="mt-1 text-sm text-red-600">{formErrors.price}</p>
                        )}
                      </div>

                      <div className="md:col-span-2">
                        <label htmlFor="remarks" className="label-field">
                          Remarks
                        </label>
                        <textarea
                          id="remarks"
                          name="remarks"
                          value={formData.remarks}
                          onChange={handleInputChange}
                          className="input-field"
                          rows={2}
                          placeholder="Optional notes or remarks for this merchandise"
                        />
                      </div>

                      {/* Gender and Piece fields - only show for uniforms */}
                      {isUniformMerchandiseName(formData.merchandise_name) && (
                        <>
                          <div>
                            <label htmlFor="gender" className="label-field">
                              Gender *
                            </label>
                            <select
                              id="gender"
                              name="gender"
                              value={formData.gender}
                              onChange={handleInputChange}
                              className={`input-field ${formErrors.gender ? 'border-red-500' : ''}`}
                            >
                              <option value="">Select Gender</option>
                              {getMerchandiseFormGenderOptions(formData.merchandise_name).map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            {formErrors.gender && (
                              <p className="mt-1 text-sm text-red-600">{formErrors.gender}</p>
                            )}
                          </div>

                          <div>
                            <label htmlFor="type" className="label-field">
                              Piece: {getUniformPieceLabels(formData.merchandise_name, formData.gender).upper}
                              {getUniformPieceOptions(formData.merchandise_name, formData.gender).length > 1
                                ? ` / ${getUniformPieceLabels(formData.merchandise_name, formData.gender).lower}`
                                : ''}{' '}
                              *
                            </label>
                            <select
                              id="type"
                              name="type"
                              value={formData.type}
                              onChange={handleInputChange}
                              className={`input-field ${formErrors.type ? 'border-red-500' : ''}`}
                            >
                              <option value="">Select Piece</option>
                              {getUniformPieceOptions(
                                formData.merchandise_name,
                                formData.gender
                              ).map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            {formErrors.type && (
                              <p className="mt-1 text-sm text-red-600">{formErrors.type}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                              Each stock row is one piece. Polo and Shirt are different types.
                            </p>
                          </div>
                        </>
                      )}
                      </>
                    )}

                      {/* Image Upload - create type shell or edit type image only */}
                      {(editingMerchandiseType || isCreateTypeMode) && (
                        <div className="md:col-span-2">
                          <MerchandiseImageUpload
                            currentImageUrl={formData.image_url}
                            onImageUploaded={(imageUrl) => {
                              setFormData((prev) => ({
                                ...prev,
                                image_url: imageUrl || '',
                              }));
                              if (formErrors.image_url) {
                                setFormErrors((prev) => {
                                  const next = { ...prev };
                                  delete next.image_url;
                                  return next;
                                });
                              }
                            }}
                            merchandiseName={formData.merchandise_name}
                            merchandiseId={
                              editingMerchandiseType?.sampleItem?.merchandise_id
                            }
                          />
                          {formErrors.image_url && (
                            <p className="mt-1 text-sm text-red-600">{formErrors.image_url}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                    disabled={submitting}
                  >
                    {submitting ? (
                      <span className="flex items-center space-x-2">
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Saving...</span>
                      </span>
                    ) : (
                      editingMerchandiseType
                        ? 'Update Image'
                        : editingMerchandise
                        ? 'Update Stock'
                        : viewingStocksFor
                        ? 'Add Stock'
                        : 'Add Merchandise Type'
                    )}
                  </button>
                </div>
              </form>
          </div>
        </div>,
        document.body
      )}

      {/* Request Stock Modal — RHET catalog-driven */}
      {isRequestModalOpen && createPortal(
        <div
          className="fixed inset-0 backdrop-blur-sm bg-black/5 flex items-center justify-center z-[9999] p-4"
          onClick={closeRequestModal}
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
                onClick={closeRequestModal}
                className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                aria-label="Close"
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



                {(catalogLoading || catalogError) && (
                  <div
                    className={`flex-shrink-0 rounded-lg border px-3 py-2 text-sm flex items-start justify-between gap-3 ${
                      catalogError
                        ? 'border-red-200 bg-red-50 text-red-800'
                        : 'border-blue-100 bg-blue-50 text-blue-800'
                    }`}
                  >
                    <span>{catalogLoading ? 'Loading RHET Inventory catalog…' : catalogError}</span>
                    {catalogError && !catalogLoading && (
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
                          const nonUniformItems = getCatalogItemsForCategory(
                            inventoryCatalog.items,
                            line.category_name
                          );
                          const catalogItemKey =
                            line.catalog_item_key ||
                            (line.sku || line.item_name
                              ? `${line.sku}|${line.item_name}|${line.inventory_id || ''}`
                              : '');



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
                                  {requestStockCategoryOptions.map((cat) => (
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
                                    lineError={lineErr}
                                    disabled={catalogLoading}
                                    onKitSelect={(value) =>
                                      handleBulkLineChange(line.id, 'catalog_item_key', value)
                                    }
                                    onComponentChange={(componentId, field, value) =>
                                      handleKitComponentChange(line.id, componentId, field, value)
                                    }
                                    onAddComponent={(component) =>
                                      handleAddKitComponent(line.id, component)
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
                  onClick={closeRequestModal}
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
      )}


    </>
  );
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }
  // Show stocks view
  if (viewingStocksFor) {
    const rawStocks = getStocksByMerchandiseName(viewingStocksFor);
    const isUniformStocks = isUniformStockCategory(viewingStocksFor);
    const isItemNamedStocks = isItemNamedStockCategory(viewingStocksFor);
    // Type shells already excluded in getStocksByMerchandiseName; keep legacy blank-qty filter for uniforms.
    const stocks = isUniformStocks
      ? rawStocks.filter((s) => {
          const blank =
            !String(s.gender || '').trim() &&
            !String(s.type || '').trim() &&
            (!String(s.size || '').trim() ||
              ['n/a', 'na'].includes(String(s.size || '').trim().toLowerCase()));
          const qty =
            s.quantity == null || s.quantity === '' ? 0 : parseInt(s.quantity, 10) || 0;
          if (blank && qty <= 0) return false;
          return true;
        })
      : rawStocks;
    const showSizeColumn = isUniformStocks && requiresSizingForMerchandise(viewingStocksFor);
    const showGenderTypeColumns = isUniformStocks;
    const pieceCounts = isUniformStocks ? countUniformPiecesByType(stocks) : null;
    const pieceLabels = isUniformStocks ? getUniformPieceLabels(viewingStocksFor) : null;
    const needsRepairBlankCount = isUniformStocks
      ? stocks.filter((s) => {
          const blank =
            !String(s.gender || '').trim() && !String(s.type || '').trim();
          const qty =
            s.quantity == null || s.quantity === '' ? 0 : parseInt(s.quantity, 10) || 0;
          return blank && qty > 0;
        }).length
      : 0;
    const genderFilterOptions = [
      ...new Set(
        stocks
          .map((s) => (s.gender || '').trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));
    if (genderFilterOptions.length === 0 && isUniformStocks) {
      genderFilterOptions.push('Men', 'Women', 'Unisex');
    }
    const typeFilterOptions = [
      ...new Set(
        stocks
          .map((s) => (s.type || '').trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b));
    if (typeFilterOptions.length === 0 && isUniformStocks) {
      getUniformPieceOptions(viewingStocksFor).forEach((o) => typeFilterOptions.push(o.value));
    }
    const sizeFilterOptions = [
      ...new Set(
        stocks
          .map((s) => (s.size || '').trim())
          .filter((sz) => sz && sz !== 'N/A')
      ),
    ].sort((a, b) => {
      const ai = UNIFORM_SIZE_OPTIONS.indexOf(a);
      const bi = UNIFORM_SIZE_OPTIONS.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    if (sizeFilterOptions.length === 0 && showSizeColumn) {
      UNIFORM_SIZE_OPTIONS.forEach((sz) => sizeFilterOptions.push(sz));
    }
    const hasActiveStockFilters =
      !!stockFilters.gender || !!stockFilters.type || !!stockFilters.size;
    const filteredStocks = stocks.filter((stock) => {
      if (stockFilters.gender) {
        if (String(stock.gender || '').trim() !== stockFilters.gender) return false;
      }
      if (stockFilters.type) {
        if (String(stock.type || '').trim() !== stockFilters.type) return false;
      }
      if (stockFilters.size) {
        const stockSize = stock.size && stock.size !== 'N/A' ? String(stock.size).trim() : '';
        if (stockSize !== stockFilters.size) return false;
      }
      return true;
    });

    const stockColCount =
      (isItemNamedStocks ? 2 : 0) + // item name + sku
      (showGenderTypeColumns ? 2 : 0) +
      (showSizeColumn ? 1 : 0) +
      3; // qty, price, remarks

    return (
      <div className="space-y-6">
        {/* Header with back button */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center space-x-4">
            <button
              onClick={handleBackToMerchandise}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Stocks: {viewingStocksFor}
              </h1>
              <p className="text-sm text-gray-500 mt-1">{selectedBranchName}</p>
              {pieceCounts && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                    {pieceLabels?.upper || 'Upper'}: {pieceCounts.top}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                    {pieceLabels?.lower || 'Lower'}: {pieceCounts.bottom}
                  </span>
                  {pieceCounts.unspecified > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">
                      {needsRepairBlankCount > 0
                        ? `Needs repair: ${needsRepairBlankCount} blank row(s) with qty`
                        : `Unspecified piece: ${pieceCounts.unspecified}`}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}
        {/* Uniform stock filters */}
        {(isUniformStocks || showSizeColumn || showGenderTypeColumns) && (
          <div className="bg-white rounded-lg shadow border border-gray-100 p-3 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {hasActiveStockFilters && (
                <div className="sm:col-span-3 flex justify-end -mb-1">
                  <button
                    type="button"
                    onClick={() => setStockFilters({ gender: '', type: '', size: '' })}
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2"
                  >
                    Clear filters
                  </button>
                </div>
              )}
              {(isUniformStocks || showGenderTypeColumns) && (
                <div>
                  <label htmlFor="stock-filter-gender" className="block text-xs font-medium text-gray-600 mb-1">
                    Gender
                  </label>
                  <select
                    id="stock-filter-gender"
                    value={stockFilters.gender}
                    onChange={(e) =>
                      setStockFilters((prev) => ({ ...prev, gender: e.target.value }))
                    }
                    className="input-field text-sm"
                  >
                    <option value="">All genders</option>
                    {genderFilterOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(isUniformStocks || showGenderTypeColumns) && (
                <div>
                  <label htmlFor="stock-filter-type" className="block text-xs font-medium text-gray-600 mb-1">
                    Type (piece)
                  </label>
                  <select
                    id="stock-filter-type"
                    value={stockFilters.type}
                    onChange={(e) =>
                      setStockFilters((prev) => ({ ...prev, type: e.target.value }))
                    }
                    className="input-field text-sm"
                  >
                    <option value="">All types</option>
                    {typeFilterOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {showSizeColumn && (
                <div>
                  <label htmlFor="stock-filter-size" className="block text-xs font-medium text-gray-600 mb-1">
                    Size
                  </label>
                  <select
                    id="stock-filter-size"
                    value={stockFilters.size}
                    onChange={(e) =>
                      setStockFilters((prev) => ({ ...prev, size: e.target.value }))
                    }
                    className="input-field text-sm"
                  >
                    <option value="">All sizes</option>
                    {sizeFilterOptions.map((sz) => (
                      <option key={sz} value={sz}>
                        {sz}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Stocks Table */}
        <div className="bg-white rounded-lg shadow">
          <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
            <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: isItemNamedStocks ? '800px' : showSizeColumn ? '900px' : '750px' }}>
              <thead className="bg-white">
                <tr>
                  {isItemNamedStocks && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Item name
                    </th>
                  )}
                  {isItemNamedStocks && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      SKU
                    </th>
                  )}
                  {showGenderTypeColumns && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Gender
                    </th>
                  )}
                  {showGenderTypeColumns && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                  )}
                  {showSizeColumn && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Size
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quantity
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Remarks
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredStocks.length > 0 ? (
                  filteredStocks.map((stock) => (
                    <tr key={stock.merchandise_id}>
                      {isItemNamedStocks && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div
                            className="text-sm text-gray-900 max-w-[220px] truncate"
                            title={formatMerchandiseStockItemName(stock)}
                          >
                            {formatMerchandiseStockItemName(stock)}
                          </div>
                        </td>
                      )}
                      {isItemNamedStocks && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{formatMerchandiseStockSku(stock)}</div>
                        </td>
                      )}
                      {showGenderTypeColumns && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{stock.gender || '—'}</div>
                        </td>
                      )}
                      {showGenderTypeColumns && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{stock.type || '—'}</div>
                        </td>
                      )}
                      {showSizeColumn && (
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{stock.size || 'N/A'}</div>
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{stock.quantity}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {stock.price ? `₱${parseFloat(stock.price).toFixed(2)}` : '—'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-[200px] truncate" title={stock.remarks || '—'}>
                          {stock.remarks || '—'}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={stockColCount} className="px-6 py-4 text-center text-sm text-gray-500">
                      {stocks.length === 0
                        ? 'No stock items yet. Use Request Stock or Add Stocks to add inventory for this category.'
                        : 'No stocks match the selected filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        {/* Modals */}
        {renderModals()}
      </div>
    );
  }
  // Main view: Show merchandise types directly (admin only sees their branch)
  // If no branch ID, show loading or error
  if (!adminBranchId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-gray-500">Loading branch information...</p>
        </div>
      </div>
    );
  }
  // Show merchandise items for admin's branch directly
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Merchandise</h1>
          <p className="text-sm text-gray-500 mt-1">{selectedBranchName}</p>
        </div>
        {/* Request Stock Button - Upper Right */}
        <button 
          onClick={() => openRequestModal()}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center justify-center space-x-2 shadow-md"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Request Stock</span>
        </button>
      </div>
      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex flex-wrap gap-x-8 gap-y-1">
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'inventory'
                ? 'border-[#F7C844] text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Inventory
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('requests')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors flex items-center space-x-2 ${
              activeTab === 'requests'
                ? 'border-[#F7C844] text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span>My Requests</span>
            {requests.filter((r) => r.status === 'Pending').length > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                {requests.filter((r) => r.status === 'Pending').length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'logs'
                ? 'border-[#F7C844] text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Merchandise Logs
          </button>
        </nav>
      </div>
      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {/* Tab Content */}
      {activeTab === 'inventory' ? (
        <>
      {/* Merchandise Types List - Card Grid */}
      {getUniqueMerchandiseTypes().length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {getUniqueMerchandiseTypes().map((merchType) => (
            <div
              key={merchType.name}
              className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow duration-200 border border-gray-200"
            >
              {/* Image Section - Fixed aspect ratio for consistent card sizes */}
              <div className="relative w-full aspect-square bg-gray-100 overflow-hidden">
                {merchType.image_url ? (
                  <img
                    src={merchType.image_url}
                    alt={merchType.name}
                    className="absolute inset-0 w-full h-full object-cover object-center"
                    onError={(e) => {
                      // Fallback if image fails to load
                      e.target.style.display = 'none';
                      const placeholder = e.target.nextElementSibling;
                      if (placeholder) placeholder.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div 
                  className={`absolute inset-0 w-full h-full flex items-center justify-center bg-gray-100 ${merchType.image_url ? 'hidden' : 'flex'}`}
                >
                  <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              {/* Content Section */}
              <div className="p-4 relative overflow-visible">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 truncate" title={merchType.name}>
                  {merchType.name}
                </h3>
                
                {/* Action Buttons */}
                <div className="flex flex-col items-center space-y-2">
                  <button
                    onClick={() => handleViewStocks(merchType.name)}
                    className="w-full px-4 py-2 text-sm font-medium text-gray-900 bg-[#F7C844] hover:bg-[#F5B82E] rounded-lg transition-colors"
                  >
                    View Stocks
                    </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            No merchandise types found for this branch.
          </p>
        </div>
      )}
        </>
      ) : activeTab === 'logs' ? (
        <MerchandiseReleaseLogsPanel
          branchId={adminBranchId || ''}
          branchName={selectedBranchName || 'Your Branch'}
          showBranchColumn={false}
        />
      ) : (
        <>
          <MerchandiseRequestStatusModules
            requests={requests}
            value={requestStatusModule}
            onChange={setRequestStatusModule}
          />
          {(() => {
            const filteredRequests = filterRequestsByStatusModule(
              requests,
              requestStatusModule
            );
            const moduleMeta = getRequestStatusModuleMeta(requestStatusModule);
            const modulePage = requestModulePageByStatus[requestStatusModule] || 1;
            const paged = paginateRequestList(
              filteredRequests,
              modulePage,
              REQUEST_STATUS_MODULE_PAGE_SIZE
            );
            const setModulePage = (nextPage) => {
              setRequestModulePageByStatus((prev) => ({
                ...prev,
                [requestStatusModule]: nextPage,
              }));
            };
            if (filteredRequests.length === 0) {
              return (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 sm:p-12 text-center">
                  <p className="text-base font-semibold text-gray-800">{moduleMeta.emptyTitle}</p>
                  <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                    {requests.length === 0
                      ? 'Submit a stock request and it will appear here under Pending.'
                      : 'Merchandise stock requests in this status will appear here.'}
                  </p>
                </div>
              );
            }
            return (
            <div className="bg-white rounded-lg shadow border border-gray-200">
              <TablePaginationSummary
                page={paged.page}
                totalItems={paged.total}
                itemsPerPage={REQUEST_STATUS_MODULE_PAGE_SIZE}
                itemLabel="requests"
                className="px-4 pt-4 pb-2"
              />
              <div className="overflow-x-auto rounded-lg" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc', WebkitOverflowScrolling: 'touch' }}>
                <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '1320px' }}>
                  <thead className="bg-white">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Merchandise
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Size
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Quantity
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Reason
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Gender
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Approved By
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date & Time
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                    {paged.items.map((request) => (
                      <tr key={request.request_id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {request.inventory_category_name || request.merchandise_name}
                          </div>
                          {request.inventory_item_name && (
                            <div className="text-xs text-gray-500">{request.inventory_item_name}</div>
                          )}
                          {(request.inventory_matched_sku || request.inventory_requested_sku) && (
                            <div className="text-xs text-gray-400">
                              SKU: {request.inventory_matched_sku || request.inventory_requested_sku}
                            </div>
                          )}
                          {request.inventory_rejection_reason && (
                            <div
                              className="text-xs text-red-600 max-w-[220px] truncate"
                              title={request.inventory_rejection_reason}
                            >
                              {request.inventory_rejection_reason}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{request.size || 'N/A'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{request.requested_quantity}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 max-w-xs truncate" title={request.request_reason}>
                            {request.request_reason}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{request.gender || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{request.type || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(request.status)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">
                            {getMerchandiseRequestApprovedBy(request)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDateTimeManila(request.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <RequestActionsMenu
                            requestId={request.request_id}
                            items={buildMerchandiseRequestActionItems(request, {
                              role: 'admin',
                              onTrack: setTrackingRequest,
                              onConfirmDelivery: handleConfirmDelivery,
                              onCancel: handleCancelRequest,
                            })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 pb-4 sm:pr-36">
                <FixedTablePagination
                  page={paged.page}
                  totalPages={paged.totalPages}
                  totalItems={paged.total}
                  itemsPerPage={REQUEST_STATUS_MODULE_PAGE_SIZE}
                  itemLabel="requests"
                  onPageChange={setModulePage}
                />
              </div>
            </div>
            );
          })()}
        </>
      )}
      {/* Modals */}
      {renderModals()}
      <TrackRequestProgressModal
        open={Boolean(trackingRequest)}
        request={trackingRequest}
        onClose={() => setTrackingRequest(null)}
        canConfirmDelivery={
          trackingRequest?.status === 'Shipped' && Boolean(trackingRequest?.inventory_request_id)
        }
        confirming={submitting}
        onConfirmDelivery={() => handleConfirmDelivery(trackingRequest)}
      />
    </div>
  );
};
export default AdminMerchandise;
