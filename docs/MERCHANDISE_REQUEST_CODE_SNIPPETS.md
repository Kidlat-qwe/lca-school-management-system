# Merchandise Request System - Frontend Code Snippets

## For Admin Merchandise Page

### 1. Add State Variables (after existing state declarations)
```javascript
// Merchandise request states
const [showRequestModal, setShowRequestModal] = useState(false);
const [showRequestsTab, setShowRequestsTab] = useState(false);
const [requests, setRequests] = useState([]);
const [requestStats, setRequestStats] = useState({ pending_count: 0, approved_count: 0, rejected_count: 0 });
const [requestFormData, setRequestFormData] = useState({
  merchandise_id: null,
  merchandise_name: '',
  size: '',
  requested_quantity: '',
  request_reason: '',
});
const [requestFormErrors, setRequestFormErrors] = useState({});
const [submittingRequest, setSubmittingRequest] = useState(false);
```

### 2. Add Fetch Functions (after existing fetch functions)
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
    setRequestStats(response.data || { pending_count: 0, approved_count: 0, rejected_count: 0 });
  } catch (err) {
    console.error('Error fetching request stats:', err);
  }
};

useEffect(() => {
  if (adminBranchId) {
    fetchRequests();
    fetchRequestStats();
  }
}, [adminBranchId]);
```

### 3. Add Request Modal Component (before return statement)
```javascript
const RequestModal = () => (
  <div className="fixed inset-0 z-50 overflow-y-auto">
    <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
      <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={() => setShowRequestModal(false)}></div>
      
      <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
        <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-gray-900">Request Merchandise Stock</h3>
            <button onClick={() => setShowRequestModal(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleRequestSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Merchandise <span className="text-red-500">*</span>
              </label>
              <select
                value={requestFormData.merchandise_id || ''}
                onChange={(e) => {
                  const merchId = e.target.value ? parseInt(e.target.value) : null;
                  const selectedMerch = merchandise.find(m => m.merchandise_id === merchId);
                  setRequestFormData({
                    ...requestFormData,
                    merchandise_id: merchId,
                    merchandise_name: selectedMerch ? selectedMerch.merchandise_name : '',
                    size: selectedMerch ? selectedMerch.size : '',
                  });
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              >
                <option value="">Choose merchandise...</option>
                {getUniqueMerchandiseTypes().map((merchType) => (
                  <option key={merchType.name} value={merchType.merchandise_id}>
                    {merchType.name}
                  </option>
                ))}
              </select>
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
                placeholder="e.g., Low stock, High demand, etc."
              />
            </div>

            <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
              <button
                type="button"
                onClick={() => setShowRequestModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingRequest}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:bg-gray-300"
              >
                {submittingRequest ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
);

const handleRequestSubmit = async (e) => {
  e.preventDefault();
  
  try {
    setSubmittingRequest(true);
    await apiRequest('/merchandise-requests', {
      method: 'POST',
      body: JSON.stringify(requestFormData),
    });
    
    alert('Request submitted successfully!');
    setShowRequestModal(false);
    setRequestFormData({ merchandise_id: null, merchandise_name: '', size: '', requested_quantity: '', request_reason: '' });
    fetchRequests();
    fetchRequestStats();
  } catch (err) {
    alert(err.message || 'Failed to submit request');
  } finally {
    setSubmittingRequest(false);
  }
};

const handleCancelRequest = async (requestId) => {
  if (!confirm('Cancel this request?')) return;
  
  try {
    await apiRequest(`/merchandise-requests/${requestId}/cancel`, { method: 'PUT' });
    alert('Request cancelled');
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
```

### 4. Add Request Stock Button in Header (replace existing header)
```javascript
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
  <div>
    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Merchandise</h1>
    <p className="text-sm text-gray-500 mt-1">{selectedBranchName}</p>
  </div>
  <div className="flex flex-col sm:flex-row gap-2">
    <button 
      onClick={() => setShowRequestsTab(!showRequestsTab)}
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
    
    <button 
      onClick={() => {
        setRequestFormData({ merchandise_id: null, merchandise_name: '', size: '', requested_quantity: '', request_reason: '' });
        setShowRequestModal(true);
      }}
      className="btn-primary flex items-center justify-center space-x-2"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>Request Stock</span>
    </button>
    
    <button 
      onClick={() => { /* existing add merchandise code */ }}
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

### 5. Add Requests Tab View (before merchandise grid)
```javascript
{showRequestsTab ? (
  <div className="bg-white rounded-lg shadow p-6">
    <h2 className="text-xl font-semibold text-gray-900 mb-4">My Stock Requests</h2>
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Merchandise</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {requests.length === 0 ? (
            <tr>
              <td colSpan="7" className="px-4 py-8 text-center text-gray-500">
                No requests found
              </td>
            </tr>
          ) : (
            requests.map((request) => (
              <tr key={request.request_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm text-gray-900">{request.merchandise_name}</td>
                <td className="px-4 py-3 text-sm text-gray-900">{request.size || 'N/A'}</td>
                <td className="px-4 py-3 text-sm text-gray-900">{request.requested_quantity}</td>
                <td className="px-4 py-3 text-sm text-gray-900">{request.request_reason || '-'}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadgeColor(request.status)}`}>
                    {request.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {new Date(request.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-sm">
                  {request.status === 'Pending' && (
                    <button
                      onClick={() => handleCancelRequest(request.request_id)}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      Cancel
                    </button>
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
  // Existing merchandise grid
  ...
)}

{showRequestModal && <RequestModal />}
```

## For Superadmin Merchandise Page

Similar implementation but with approval/rejection functionality:

```javascript
// Add these handler functions
const handleApproveRequest = async (requestId) => {
  const notes = prompt('Approval notes (optional):');
  if (notes === null) return; // User cancelled
  
  try {
    await apiRequest(`/merchandise-requests/${requestId}/approve`, {
      method: 'PUT',
      body: JSON.stringify({ review_notes: notes }),
    });
    alert('Request approved and stock added!');
    fetchRequests();
    fetchMerchandiseByBranch(selectedBranchId);
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
    alert('Request rejected');
    fetchRequests();
  } catch (err) {
    alert(err.message || 'Failed to reject request');
  }
};
```

Add action buttons in the requests table:
```javascript
{request.status === 'Pending' && (
  <div className="flex space-x-2">
    <button
      onClick={() => handleApproveRequest(request.request_id)}
      className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
    >
      Approve
    </button>
    <button
      onClick={() => handleRejectRequest(request.request_id)}
      className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
    >
      Reject
    </button>
  </div>
)}
```

