import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { apiRequest } from '../config/api';
import { useAuth } from './AuthContext';

const GlobalBranchFilterContext = createContext(null);

const SUPPORTED_ROUTE_PREFIXES = ['/superadmin/', '/superfinance/'];
const SUPPORTED_ROUTE_SEGMENTS = new Set([
  'financial-dashboard',
  'operational-dashboard',
  'enrollment-dashboard',
  'personnel',
  'student',
  'classes',
  'package',
  'pricinglist',
  'room',
  'invoice',
  'installment-invoice',
  'payment-logs',
  'daily-summary-sales',
  'report',
  'calendar-schedule',
]);

const formatBranchNameParts = (branchName) => {
  if (!branchName) {
    return {
      company: 'All Branches',
      location: '',
    };
  }

  if (branchName.includes(' - ')) {
    const parts = branchName.split(' - ');
    return {
      company: parts[0].trim(),
      location: parts.slice(1).join(' - ').trim(),
    };
  }

  if (branchName.includes('-')) {
    const parts = branchName.split('-');
    return {
      company: parts[0].trim(),
      location: parts.slice(1).join('-').trim(),
    };
  }

  return {
    company: branchName,
    location: '',
  };
};

export const GlobalBranchFilterProvider = ({ children }) => {
  const { userInfo } = useAuth();
  const location = useLocation();
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loadingBranches, setLoadingBranches] = useState(false);

  const userType = userInfo?.user_type || userInfo?.userType || '';
  const branchId = userInfo?.branch_id ?? userInfo?.branchId ?? null;
  const isSuperfinance = userType === 'Finance' && (branchId === null || branchId === undefined);
  const isEligibleRole = userType === 'Superadmin' || isSuperfinance;

  const currentPath = location.pathname || '';
  const isSupportedPrefix = SUPPORTED_ROUTE_PREFIXES.some((prefix) => currentPath.startsWith(prefix));
  const currentSegment = currentPath.split('/')[2] || '';
  const shouldShowBranchFilter = isEligibleRole && isSupportedPrefix && SUPPORTED_ROUTE_SEGMENTS.has(currentSegment);

  useEffect(() => {
    if (!isEligibleRole) {
      setBranches([]);
      setSelectedBranchId('');
      return;
    }

    const loadBranches = async () => {
      try {
        setLoadingBranches(true);
        const response = await apiRequest('/branches');
        setBranches(response.data || []);
      } catch (error) {
        console.error('Error fetching global branch filters:', error);
        setBranches([]);
      } finally {
        setLoadingBranches(false);
      }
    };

    loadBranches();
  }, [isEligibleRole]);

  const selectedBranch = useMemo(
    () => branches.find((branch) => String(branch.branch_id) === String(selectedBranchId)) || null,
    [branches, selectedBranchId]
  );

  const value = useMemo(
    () => ({
      branches,
      loadingBranches,
      selectedBranchId,
      setSelectedBranchId,
      clearSelectedBranch: () => setSelectedBranchId(''),
      selectedBranch,
      selectedBranchName: selectedBranch?.branch_name || 'All Branches',
      selectedBranchNameParts: formatBranchNameParts(selectedBranch?.branch_name || 'All Branches'),
      shouldShowBranchFilter,
      isEligibleRole,
    }),
    [branches, loadingBranches, selectedBranchId, selectedBranch, shouldShowBranchFilter, isEligibleRole]
  );

  return (
    <GlobalBranchFilterContext.Provider value={value}>
      {children}
    </GlobalBranchFilterContext.Provider>
  );
};

export const useGlobalBranchFilter = () => {
  const context = useContext(GlobalBranchFilterContext);

  if (!context) {
    throw new Error('useGlobalBranchFilter must be used within GlobalBranchFilterProvider');
  }

  return context;
};
