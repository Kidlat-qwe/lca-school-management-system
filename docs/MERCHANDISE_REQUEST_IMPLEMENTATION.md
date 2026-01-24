# Merchandise Stock Request System - Implementation Guide

## Overview
This system allows Admins to request merchandise stock from Superadmins when inventory is low. Superadmins can approve or reject requests, and approved requests automatically update the merchandise inventory.

## Database Changes

### New Table: `merchandiserequestlogtbl`

**File**: `backend/migrations/051_create_merchandiserequestlogtbl.sql`

```sql
CREATE TABLE merchandiserequestlogtbl (
  request_id SERIAL PRIMARY KEY,
  merchandise_id INTEGER REFERENCES merchandisestbl(merchandise_id),
  requested_by INTEGER NOT NULL REFERENCES userstbl(user_id),
  requested_branch_id INTEGER NOT NULL REFERENCES branchestbl(branch_id),
  merchandise_name VARCHAR(255) NOT NULL,
  size VARCHAR(50),
  requested_quantity INTEGER NOT NULL,
  request_reason TEXT,
  status VARCHAR(50) DEFAULT 'Pending',
  reviewed_by INTEGER REFERENCES userstbl(user_id),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Status Values**:
- `Pending` - Awaiting Superadmin review
- `Approved` - Approved and stock added
- `Rejected` - Rejected by Superadmin
- `Cancelled` - Cancelled by Admin

## Backend API

### New Route: `/api/v1/merchandise-requests`

**Endpoints**:

1. **GET** `/api/v1/merchandise-requests`
   - List requests (Admin sees own branch, Superadmin sees all)
   - Query params: `status`, `branch_id`, `page`, `limit`
   
2. **GET** `/api/v1/merchandise-requests/stats`
   - Get request statistics

3. **GET** `/api/v1/merchandise-requests/:id`
   - Get specific request details

4. **POST** `/api/v1/merchandise-requests`
   - Create new request (Admin only)
   - Body: `{ merchandise_id, merchandise_name, size, requested_quantity, request_reason }`

5. **PUT** `/api/v1/merchandise-requests/:id/approve`
   - Approve request (Superadmin only)
   - Automatically adds/updates merchandise stock
   - Body: `{ review_notes }`

6. **PUT** `/api/v1/merchandise-requests/:id/reject`
   - Reject request (Superadmin only)
   - Body: `{ review_notes }` (required)

7. **PUT** `/api/v1/merchandise-requests/:id/cancel`
   - Cancel pending request (Admin only)

8. **DELETE** `/api/v1/merchandise-requests/:id`
   - Delete cancelled/rejected request

## Frontend Changes

### Admin Merchandise Page
**File**: `frontend/src/pages/admin/adminMerchandise.jsx`

**New Features**:
1. "Request Stock" button in header
2. Request modal with form:
   - Select merchandise (from existing types or enter new)
   - Enter quantity
   - Enter reason
3. "View Requests" tab/section showing:
   - Pending requests (yellow badge)
   - Request history with status
   - Ability to cancel pending requests

### Superadmin Merchandise Page
**File**: `frontend/src/pages/superadmin/Merchandise.jsx`

**New Features**:
1. "Pending Requests" badge/notification
2. "Requests" tab showing all requests from all branches
3. Request details modal with:
   - Request information
   - Current stock levels
   - Approve button (with optional notes)
   - Reject button (requires reason)
4. Filter by status, branch, date

## Business Logic

### Creating Request (Admin Flow)
```
1. Admin checks current stock
2. If stock low/empty:
   - Click "Request Stock"
   - Select merchandise type (existing or new)
   - Enter quantity needed
   - Enter reason (optional)
   - Submit request
3. Request created with status = 'Pending'
4. Superadmin notified (optional email)
```

### Approving Request (Superadmin Flow)
```
1. Superadmin sees pending requests badge
2. Views request details:
   - Merchandise name, size
   - Requested quantity
   - Current stock level
   - Request reason
3. Decides to approve:
   - Enter approval notes (optional)
   - Click "Approve"
4. System performs transaction:
   a. Check if merchandise exists for that branch
   b. If exists: UPDATE quantity += requested_quantity
   c. If not: INSERT new merchandise for branch
   d. UPDATE request status = 'Approved'
5. Admin notified (optional email)
```

### Rejecting Request (Superadmin Flow)
```
1. Superadmin reviews request
2. Decides to reject:
   - Enter rejection reason (required)
   - Click "Reject"
3. UPDATE request status = 'Rejected'
4. Admin notified (optional email)
```

## UI/UX Considerations

### Admin View
- **Request Button**: Prominent placement next to "Add Merchandise Type"
- **Visual Indicators**: Badge showing pending request count
- **Request Status**: Color-coded (Pending=yellow, Approved=green, Rejected=red)
- **Quick Actions**: Cancel pending requests easily

### Superadmin View
- **Notification**: Badge on Merchandise navigation
- **Request Queue**: Sorted by date (oldest first)
- **Batch Actions**: Approve/reject multiple requests
- **History**: View all requests with filters

## Security

- **Admin**: Can only create/cancel requests for their branch
- **Superadmin**: Can approve/reject all requests
- **Validation**: 
  - Quantity must be positive integer
  - Cannot approve non-pending requests
  - Cannot modify approved/rejected requests

## Future Enhancements

1. **Email Notifications**: 
   - Notify Superadmin when request created
   - Notify Admin when request approved/rejected

2. **Stock Alerts**:
   - Auto-generate request when stock below threshold
   - Configurable low-stock warnings

3. **Approval Workflow**:
   - Multiple approvers required
   - Approval limits by role

4. **Analytics**:
   - Most requested items
   - Average approval time
   - Stock turnover rate

## Testing Checklist

- [ ] Admin can create request
- [ ] Admin can only see own branch requests
- [ ] Admin can cancel pending requests
- [ ] Superadmin can see all requests
- [ ] Superadmin can approve request
- [ ] Approved request adds/updates merchandise stock correctly
- [ ] Superadmin can reject request with reason
- [ ] Cannot approve/reject non-pending requests
- [ ] Request statistics accurate
- [ ] Pagination works correctly
- [ ] Filters work correctly

## Migration Steps

1. Run SQL migration to create `merchandiserequestlogtbl`
2. Deploy backend changes (server.js + new route)
3. Deploy frontend changes (Admin + Superadmin pages)
4. Test in staging environment
5. Deploy to production
6. Monitor for errors

## Support & Troubleshooting

**Common Issues**:
1. **Request not creating**: Check Admin has `branch_id` in user info
2. **Approval not adding stock**: Check transaction logs for errors
3. **Requests not showing**: Check RBAC middleware permissions

