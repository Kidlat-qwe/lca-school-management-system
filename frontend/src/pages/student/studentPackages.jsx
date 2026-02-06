import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';
import { useAuth } from '../../contexts/AuthContext';

const StudentPackages = () => {
  const { userInfo } = useAuth();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nameSearchTerm, setNameSearchTerm] = useState('');
  const [filterPackageType, setFilterPackageType] = useState('');
  const [filterLevelTag, setFilterLevelTag] = useState('');
  const [selectedPackageForDetails, setSelectedPackageForDetails] = useState(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedBranchName, setSelectedBranchName] = useState(userInfo?.branch_name || 'Your Branch');

  const studentBranchId = userInfo?.branch_id || userInfo?.branchId;

  useEffect(() => {
    if (studentBranchId) {
      fetchPackages();
      fetchBranchName();
    }
  }, [studentBranchId]);

  const fetchBranchName = async () => {
    if (studentBranchId && !userInfo?.branch_name) {
      try {
        const response = await apiRequest(`/branches/${studentBranchId}`);
        if (response.data?.branch_name) {
          setSelectedBranchName(response.data.branch_name);
        }
      } catch (err) {
        console.error('Error fetching branch name:', err);
      }
    }
  };

  const fetchPackages = async () => {
    try {
      setLoading(true);
      // Fetch packages for student's branch, only active packages
      const response = await apiRequest(`/packages?branch_id=${studentBranchId}&limit=100`);
      const allPackages = response.data || [];
      
      // Filter to only show Active packages
      const activePackages = allPackages.filter(pkg => pkg.status === 'Active');
      
      setPackages(activePackages);
    } catch (err) {
      setError(err.message || 'Failed to fetch packages');
      console.error('Error fetching packages:', err);
    } finally {
      setLoading(false);
    }
  };

  const openDetailsModal = async (packageItem) => {
    try {
      // Fetch the latest package data with details
      const response = await apiRequest(`/packages/${packageItem.package_id}`);
      setSelectedPackageForDetails(response.data);
      setIsDetailsModalOpen(true);
    } catch (err) {
      console.error('Error fetching package details:', err);
      setSelectedPackageForDetails(packageItem);
      setIsDetailsModalOpen(true);
    }
  };

  const closeDetailsModal = () => {
    setIsDetailsModalOpen(false);
    setSelectedPackageForDetails(null);
  };

  const getPricingDetailCount = (details = []) =>
    details.filter(detail => detail.pricinglist_id).length;

  const getMerchandiseTypeCount = (details = []) => {
    const types = new Set();
    details.forEach(detail => {
      if (detail.merchandise_id && detail.merchandise_name) {
        types.add(detail.merchandise_name);
      }
    });
    return types.size;
  };

  const getDisplayDetailsCount = (details = []) =>
    getPricingDetailCount(details) + getMerchandiseTypeCount(details);

  const uniquePackageTypes = [...new Set(packages.map(p => p.package_type).filter(Boolean))];
  const uniqueLevelTags = [...new Set(packages.map(p => p.level_tag).filter(Boolean))];

  const filteredPackages = packages.filter((packageItem) => {
    const matchesNameSearch = !nameSearchTerm || 
      packageItem.package_name?.toLowerCase().includes(nameSearchTerm.toLowerCase()) ||
      packageItem.level_tag?.toLowerCase().includes(nameSearchTerm.toLowerCase());
    
    const matchesPackageType = !filterPackageType || packageItem.package_type === filterPackageType;
    const matchesLevelTag = !filterLevelTag || packageItem.level_tag === filterLevelTag;
    
    return matchesNameSearch && matchesPackageType && matchesLevelTag;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Available Packages</h1>
          <p className="text-sm text-gray-600">View available packages for {selectedBranchName}</p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <input
              type="text"
              value={nameSearchTerm}
              onChange={(e) => setNameSearchTerm(e.target.value)}
              placeholder="Search by package name or level tag..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent"
            />
            {nameSearchTerm && (
              <button
                onClick={() => setNameSearchTerm('')}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div>
            <select
              value={filterPackageType}
              onChange={(e) => setFilterPackageType(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent"
            >
              <option value="">All Package Types</option>
              {uniquePackageTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={filterLevelTag}
              onChange={(e) => setFilterLevelTag(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:border-transparent"
            >
              <option value="">All Levels</option>
              {uniqueLevelTags.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Packages List */}
      {filteredPackages.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">
            {nameSearchTerm || filterPackageType || filterLevelTag
              ? 'No packages found matching your criteria.'
              : 'No available packages found for your branch.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div
            className="overflow-x-auto rounded-lg"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: '#cbd5e0 #f7fafc',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <table
              className="divide-y divide-gray-200"
              style={{ width: '100%', minWidth: '1000px' }}
            >
              <thead className="bg-white">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Package Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Level Tag
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Package Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Phase Range
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Included Items
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-[#ffffff] divide-y divide-gray-200">
                {filteredPackages.map((packageItem) => (
                  <tr key={packageItem.package_id}>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {packageItem.package_name || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {packageItem.level_tag || '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                          (packageItem.package_type || '').trim() === 'Installment'
                            ? 'bg-blue-100 text-blue-800'
                            : (packageItem.package_type || '').trim() === 'Reserved'
                            ? 'bg-yellow-100 text-yellow-800'
                            : (packageItem.package_type || '').trim() === 'Phase'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {(packageItem.package_type || 'Fullpayment').trim()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {packageItem.package_price !== null && packageItem.package_price !== undefined
                          ? `₱${parseFloat(packageItem.package_price).toFixed(2)}`
                          : '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {packageItem.package_type === 'Phase' && packageItem.phase_start ? (
                          <>
                            Phase {packageItem.phase_start}
                            {packageItem.phase_end && packageItem.phase_end !== packageItem.phase_start
                              ? ` - ${packageItem.phase_end}`
                              : ''}
                          </>
                        ) : (
                          '-'
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {getDisplayDetailsCount(packageItem.details || [])} item(s)
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => openDetailsModal(packageItem)}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredPackages.length > 0 && (
        <div className="text-sm text-gray-500 text-center">
          Showing {filteredPackages.length} of {packages.length} packages
        </div>
      )}

      {/* Package Details Modal */}
      {isDetailsModalOpen && selectedPackageForDetails && createPortal(
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] p-4"
          onClick={closeDetailsModal}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0 bg-white rounded-t-lg">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Package Details
                </h2>
                <p className="text-sm text-gray-500 mt-1">{selectedPackageForDetails.package_name}</p>
              </div>
              <button
                onClick={closeDetailsModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-6">
                {/* Package Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-gray-200">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Package Name</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedPackageForDetails.package_name || '-'}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Level Tag</label>
                    <p className="mt-1 text-sm text-gray-900">{selectedPackageForDetails.level_tag || '-'}</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Package Type</label>
                    <p className="mt-1">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                          (selectedPackageForDetails.package_type || '').trim() === 'Installment'
                            ? 'bg-blue-100 text-blue-800'
                            : (selectedPackageForDetails.package_type || '').trim() === 'Reserved'
                            ? 'bg-yellow-100 text-yellow-800'
                            : (selectedPackageForDetails.package_type || '').trim() === 'Phase'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {(selectedPackageForDetails.package_type || 'Fullpayment').trim()}
                      </span>
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Price</label>
                    <p className="mt-1 text-sm font-medium text-gray-900">
                      {selectedPackageForDetails.package_price !== null && selectedPackageForDetails.package_price !== undefined
                        ? `₱${parseFloat(selectedPackageForDetails.package_price).toFixed(2)}`
                        : '-'}
                    </p>
                  </div>
                  {selectedPackageForDetails.package_type === 'Phase' && (
                    <>
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Phase Start</label>
                        <p className="mt-1 text-sm text-gray-900">
                          {selectedPackageForDetails.phase_start ? `Phase ${selectedPackageForDetails.phase_start}` : '-'}
                        </p>
                      </div>
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Phase End</label>
                        <p className="mt-1 text-sm text-gray-900">
                          {selectedPackageForDetails.phase_end ? `Phase ${selectedPackageForDetails.phase_end}` : '-'}
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {/* Package Details - Pricing Lists and Merchandise */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">What's Included</h3>
                  {selectedPackageForDetails.details && selectedPackageForDetails.details.length > 0 ? (
                    <div className="space-y-4">
                      {(() => {
                        // Separate pricing lists and merchandise
                        const pricingDetails = selectedPackageForDetails.details.filter(d => d.pricinglist_id);
                        const merchandiseDetails = selectedPackageForDetails.details.filter(d => d.merchandise_id);
                        
                        // Group merchandise by type (merchandise_name)
                        const merchandiseByType = new Map();
                        merchandiseDetails.forEach(detail => {
                          const typeName = detail.merchandise_name;
                          if (typeName) {
                            if (!merchandiseByType.has(typeName)) {
                              merchandiseByType.set(typeName, []);
                            }
                            merchandiseByType.get(typeName).push(detail);
                          }
                        });
                        
                        return (
                          <>
                            {/* Display pricing lists */}
                            {pricingDetails.length > 0 && (
                              <div>
                                <h4 className="text-md font-medium text-gray-700 mb-3">Pricing Lists</h4>
                                <div className="space-y-2">
                                  {pricingDetails.map((detail) => (
                                    <div key={detail.packagedtl_id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                                      <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                          <span className="text-sm font-medium text-gray-900">
                                            {detail.pricing_name || `Pricing List ID: ${detail.pricinglist_id}`}
                                          </span>
                                          {detail.pricing_level_tag && (
                                            <span className="ml-2 text-xs text-gray-500">({detail.pricing_level_tag})</span>
                                          )}
                                          {detail.pricing_price && (
                                            <span className="ml-2 text-sm text-gray-600">
                                              - ₱{parseFloat(detail.pricing_price).toFixed(2)}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Display merchandise types (grouped) */}
                            {merchandiseByType.size > 0 && (
                              <div>
                                <h4 className="text-md font-medium text-gray-700 mb-3">Merchandise</h4>
                                <div className="space-y-2">
                                  {Array.from(merchandiseByType.entries()).map(([typeName, details]) => {
                                    // Group by size if applicable
                                    const bySize = new Map();
                                    details.forEach(detail => {
                                      const size = detail.size || 'No Size';
                                      if (!bySize.has(size)) {
                                        bySize.set(size, []);
                                      }
                                      bySize.get(size).push(detail);
                                    });

                                    return (
                                      <div key={typeName} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                                        <div className="flex items-start justify-between">
                                          <div className="flex-1">
                                            <span className="text-sm font-medium text-gray-900">
                                              {typeName}
                                            </span>
                                            {details.length > 1 && (
                                              <span className="ml-2 text-xs text-gray-500">
                                                ({details.length} item{details.length > 1 ? 's' : ''})
                                              </span>
                                            )}
                                            {bySize.size > 1 && (
                                              <div className="mt-2 space-y-1">
                                                {Array.from(bySize.entries()).map(([size, sizeDetails]) => (
                                                  <div key={size} className="text-xs text-gray-600 ml-4">
                                                    {size}: {sizeDetails.length} item{sizeDetails.length > 1 ? 's' : ''}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {pricingDetails.length === 0 && merchandiseByType.size === 0 && (
                              <p className="text-sm text-gray-500 italic">No items included in this package.</p>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No details available for this package.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 flex-shrink-0 bg-white rounded-b-lg">
              <button
                type="button"
                onClick={closeDetailsModal}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default StudentPackages;
