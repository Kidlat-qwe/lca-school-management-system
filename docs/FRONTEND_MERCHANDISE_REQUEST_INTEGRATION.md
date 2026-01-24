# Frontend Integration Guide - Merchandise Requests

## Overview
This guide provides step-by-step instructions to add merchandise request features to both Admin and Superadmin merchandise pages.

---

## Part 1: Admin Merchandise Page
**File:** `frontend/src/pages/admin/adminMerchandise.jsx`

### Step 1: Add Import (at top of file)
```javascript
import { apiRequest } from '../../config/api';
// ... existing imports
```

### Step 2: Add State Variables (after existing useState declarations, around line 35)
```javascript
// Merchandise request states
const [showRequestModal, setShowRequestModal] = useState(false);
const [showRequestsView, setShowRequestsView] = useState(false);
const [requests, setRequests] = useState([]);
const [requestStats, setRequestStats] = useState({ 
  pending_count: 0, 
  approved_count: 0, 
  rejected_count: 0,
  cancelled_count: 0,
  total_count: 0 
});
const [requestFormData, setRequestFormData] = useState({
  merchandise_id: null,
  merchandise_name: '',
  size: '',
  requested_quantity: '',
  request_reason: '',
});
const [submittingRequest, setSubmittingRequest] = useState(false);
```

### Step 3: Add Fetch Functions (after existing fetch functions, around line 90)
```javascript
const fetchRequests = async () => {
  try {
    const response = await apiRequest(`/merchandise-requests?page=1&limit=100`);
    setRequests(response.data || []);
  } catch (err) {
    console.error('Error fetching requests:', err);
  }
};

const fetchRequestStats = async () => {
  try {
    const response = await apiRequest(`/merchandise-requests/stats`);
    setRequestStats(response.data || { 
      pending_count: 0, 
      approved_count: 0, 
      rejected_count: 0,
      cancelled_count: 0,
      total_count: 0 
    });
  } catch (err) {
    console.error('Error fetching request stats:', err);
  }
};

// Add to existing useEffect that fetches merchandise
useEffect(() => {
  if (adminBranchId) {
    fetchMerchandiseByBranch(adminBranchId);
    fetchRequests();
    fetchRequestStats();
  }
}, [adminBranchId]);
```

### Step 4: Add Handler Functions (around line 200, after existing handlers)
```javascript
const handleRequestSubmit = async (e) => {
  e.preventDefault();
  
  if (!requestFormData.merchandise_name || !requestFormData.requested_quantity) {
    alert('Please fill in all required fields');
    return;
  }
  
  try {
    setSubmittingRequest(true);
    await apiRequest('/merchandise-requests', {
      method: 'POST',
      body: JSON.stringify(requestFormData),
    });
    
    alert('Request submitted successfully! Superadmin will be notified.');
    setShowRequestModal(false);
    setRequestFormData({ 
      merchandise_id: null, 
      merchandise_name: '', 
      size: '', 
      requested_quantity: '', 
      request_reason: '' 
    });
    fetchRequests();
    fetchRequestStats();
  } catch (err) {
    alert(err.message || 'Failed to submit request');
  } finally {
    setSubmittingRequest(false);
  }
};

const handleCancelRequest = async (requestId) => {
  if (!confirm('Are you sure you want to cancel this request?')) return;
  
  try {
    await apiRequest(`/merchandise-requests/${requestId}/cancel`, { method: 'PUT' });
    alert('Request cancelled successfully');
    fetchRequests();
    fetchRequestStats();
  } catch (err) {
    alert(err.message || 'Failed to cancel request');
  }
};

const getStatusBadgeColor = (status) => {
  switch(status) {
    case 'Pending': return 'bg-yellow-100 text-yellow-800';
    case 'Approved': return 'bg-green-100 text-green-800';
    case 'Rejected': return 'bg-red-100 text-red-800';
    case 'Cancelled': return 'bg-gray-100 text-gray-800';
    default: return 'bg-gray-100 text-gray-800';
  }
};

const openRequestModal = () => {
  setRequestFormData({
    merchandise_id: null,
    merchandise_name: '',
    size: '',
    requested_quantity: '',
    request_reason: '',
  });
  setShowRequestModal(true);
};
```

### Step 5: Add Request Modal Component (before main return statement, around line 400)
```javascript
const RequestModal = () => (
  <div className="fixed inset-0 z-50 overflow-y-auto">
    <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
      <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setShowRequestModal(false)}></div>
      
      <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
        <form onSubmit={handleRequestSubmit}>
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Request Merchandise Stock</h3>
                <p className="text-sm text-gray-500 mt-1">Submit a request for additional merchandise inventory</p>
              </div>
              <button 
                type="button"
                onClick={() => setShowRequestModal(false)} 
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Merchandise <span className="text-red-500">*</span>
                </label>
                <select
                  value={requestFormData.merchandise_id || ''}
                  onChange={(e) => {
                    const merchId = e.target.value ? parseInt(e.target.value) : null;
                    const selectedMerch = merchId ? merchandise.find(m => m.merchandise_id === merchId) : null;
                    setRequestFormData({
                      ...requestFormData,
                      merchandise_id: merchId,
                      merchandise_name: selectedMerch ? selectedMerch.merchandise_name : '',
                      size: selectedMerch ? (selectedMerch.size || '') : '',
                    });
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  required
                >
                  <option value="">Choose existing merchandise...</option>
                  {getUniqueMerchandiseTypes().map((merchType) => (
                    <option key={merchType.merchandise_id} value={merchType.merchandise_id}>
                      {merchType.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">Or enter a new merchandise name below if not in the list</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Merchandise Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={requestFormData.merchandise_name}
                  onChange={(e) => setRequestFormData({ ...requestFormData, merchandise_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="e.g., LCA Uniform, LCA Bag"
                  required
                />
              </div>

              {requestFormData.merchandise_name && requiresSizingForMerchandise(requestFormData.merchandise_name) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Size</label>
                  <input
                    type="text"
                    value={requestFormData.size}
                    onChange={(e) => setRequestFormData({ ...requestFormData, size: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="e.g., S, M, L, XL"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantity <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  value={requestFormData.requested_quantity}
                  onChange={(e) => setRequestFormData({ ...requestFormData, requested_quantity: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Enter quantity"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Reason (Optional)</label>
                <textarea
                  rows={3}
                  value={requestFormData.request_reason}
                  onChange={(e) => setRequestFormData({ ...requestFormData, request_reason: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="e.g., Low stock, High demand, New merchandise needed"
                />
              </div>
            </div>
          </div>

          <div className="bg-gray-50 px-4 py-3 sm:px-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => setShowRequestModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingRequest}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {submittingRequest ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
);
```

### Step 6: Update Header Section (replace existing header, around line 890)
```javascript
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
  <div>
    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Merchandise</h1>
    <p className="text-sm text-gray-500 mt-1">{selectedBranchName}</p>
  </div>
  <div className="flex flex-col sm:flex-row gap-2">
    {/* View Requests Button */}
    <button 
      onClick={() => setShowRequestsView(!showRequestsView)}
      className="btn-secondary flex items-center justify-center space-x-2 relative"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      <span>My Requests</span>
      {requestStats.pending_count > 0 && (
        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
          {requestStats.pending_count}
        </span>
      )}
    </button>
    
    {/* Request Stock Button */}
    <button 
      onClick={openRequestModal}
      className="btn-primary flex items-center justify-center space-x-2"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>Request Stock</span>
    </button>
    
    {/* Add Merchandise Button (existing) */}
    <button 
      onClick={() => {
        setEditingMerchandise(null);
        setError('');
        setRequiresSizing(false);
        setModalStep('form');
        setFormData({
          merchandise_name: '',
          size: '',
          quantity: '',
          price: '',
          branch_id: adminBranchId.toString(),
          remarks: '',
          image_url: '',
        });
        setFormErrors({});
        setIsModalOpen(true);
      }}
      className="btn-primary flex items-center justify-center space-x-2"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      <span>Add Merchandise Type</span>
    </button>
  </div>
</div>
```

### Step 7: Add Requests View Section (after header, before merchandise grid, around line 930)
```javascript
{/* Show Requests View or Merchandise Grid */}
{showRequestsView ? (
  <div className="bg-white rounded-lg shadow p-6">
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">My Stock Requests</h2>
        <p className="text-sm text-gray-500 mt-1">Track your merchandise stock requests</p>
      </div>
      <div className="flex items-center space-x-4 text-sm">
        <div className="flex items-center space-x-2">
          <span className="px-2 py-1 rounded-full bg-yellow-100 text-yellow-800 font-medium">
            Pending: {requestStats.pending_count}
          </span>
          <span className="px-2 py-1 rounded-full bg-green-100 text-green-800 font-medium">
            Approved: {requestStats.approved_count}
          </span>
          <span className="px-2 py-1 rounded-full bg-red-100 text-red-800 font-medium">
            Rejected: {requestStats.rejected_count}
          </span>
        </div>
      </div>
    </div>
    
    <div 
      className="overflow-x-auto rounded-lg"
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: '#cbd5e0 #f7fafc',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <table className="divide-y divide-gray-200" style={{ width: '100%', minWidth: '900px' }}>
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Merchandise</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Review Notes</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {requests.length === 0 ? (
            <tr>
              <td colSpan="8" className="px-4 py-12 text-center text-gray-500">
                No requests found. Click "Request Stock" to create your first request.
              </td>
            </tr>
          ) : (
            requests.map((request) => (
              <tr key={request.request_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900 font-medium">{request.merchandise_name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{request.size || 'N/A'}</td>
                <td className="px-4 py-3 text-sm text-gray-900">{request.requested_quantity}</td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={request.request_reason}>
                  {request.request_reason || '-'}
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadgeColor(request.status)}`}>
                    {request.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                  {new Date(request.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={request.review_notes}>
                  {request.review_notes || '-'}
                </td>
                <td className="px-4 py-3 text-sm">
                  {request.status === 'Pending' ? (
                    <button
                      onClick={() => handleCancelRequest(request.request_id)}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      Cancel
                    </button>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
) : (
  /* Existing merchandise grid code stays here */
  ...
)}

{/* Add at bottom before closing main div */}
{showRequestModal && <RequestModal />}
```

---

## Part 2: Superadmin Merchandise Page
**File:** `frontend/src/pages/superadmin/Merchandise.jsx`

Follow similar steps as Admin, but add these additional features:

### Additional Handler Functions for Superadmin:
```javascript
const handleApproveRequest = async (requestId) => {
  const notes = prompt('Approval notes (optional):');
  if (notes === null) return; // User cancelled
  
  try {
    await apiRequest(`/merchandise-requests/${requestId}/approve`, {
      method: 'PUT',
      body: JSON.stringify({ review_notes: notes }),
    });
    alert('Request approved! Stock has been added to the branch inventory and Admin has been notified.');
    fetchRequests();
    fetchRequestStats();
    // Refresh merchandise if viewing that branch
    if (selectedBranchId) {
      fetchMerchandiseByBranch(selectedBranchId);
    }
  } catch (err) {
    alert(err.message || 'Failed to approve request');
  }
};

const handleRejectRequest = async (requestId) => {
  const reason = prompt('Rejection reason (required):');
  if (!reason || reason.trim() === '') {
    alert('Rejection reason is required');
    return;
  }
  
  try {
    await apiRequest(`/merchandise-requests/${requestId}/reject`, {
      method: 'PUT',
      body: JSON.stringify({ review_notes: reason }),
    });
    alert('Request rejected. Admin has been notified.');
    fetchRequests();
    fetchRequestStats();
  } catch (err) {
    alert(err.message || 'Failed to reject request');
  }
};
```

### Update Requests Table for Superadmin (Actions column):
```javascript
<td className="px-4 py-3 text-sm">
  {request.status === 'Pending' ? (
    <div className="flex space-x-2">
      <button
        onClick={() => handleApproveRequest(request.request_id)}
        className="px-3 py-1 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition-colors"
      >
        Approve
      </button>
      <button
        onClick={() => handleRejectRequest(request.request_id)}
        className="px-3 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 transition-colors"
      >
        Reject
      </button>
    </div>
  ) : (
    <span className="text-sm text-gray-500">
      {request.status === 'Approved' && 'Approved'}
      {request.status === 'Rejected' && 'Rejected'}
      {request.status === 'Cancelled' && 'Cancelled'}
    </span>
  )}
</td>
```

### Add Request Branch Column (for Superadmin):
```javascript
<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch</th>
...
<td className="px-4 py-3 text-sm text-gray-900">{request.requested_branch_name || 'Unknown'}</td>
```

---

## Testing Steps

1. **Run Database Migration:**
   ```sql
   -- Execute: backend/migrations/051_create_merchandiserequestlogtbl.sql
   ```

2. **Test Admin Flow:**
   - Login as Admin
   - Click "Request Stock"
   - Fill form and submit
   - Check "My Requests" tab
   - Verify Superadmin sees notification bell badge

3. **Test Superadmin Flow:**
   - Login as Superadmin
   - Check notification bell (should have notification)
   - Click "View Requests" in merchandise
   - Approve a request
   - Verify stock added to branch
   - Verify Admin receives notification

4. **Test Reject Flow:**
   - Superadmin rejects a request
   - Verify Admin receives rejection notification

---

## Styling Notes

### Tailwind Classes Used:
- `btn-primary` - Primary action button (yellow/gold)
- `btn-secondary` - Secondary action button (gray/outline)
- Responsive table pattern with `overflow-x-auto` and `minWidth`
- Badge colors match status (yellow=pending, green=approved, red=rejected)

### Notification Badge:
```css
/* Red badge on button */
absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5
```

---

## Summary

✅ **Backend:** Notifications automatically created
✅ **Frontend:** Request modal, requests view, approval/rejection
✅ **UI/UX:** Badges, status colors, responsive tables
✅ **Notifications:** Bell icon integration (no additional work needed)

The system is now complete with full request workflow and notification integration!

