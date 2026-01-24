# Merchandise Request Notifications Integration

## ✅ Backend Notification System Implemented

The backend has been updated to automatically create notifications (announcements) when:

### 1. Admin Creates a Request
**Notification sent to:** All Superadmins
**Priority:** High
**Content:**
```
Title: "New Merchandise Stock Request"
Body: "[Admin Name] from [Branch Name] has requested [X] units of [Merchandise]. 
       Reason: [Request reason if provided]"
```

### 2. Superadmin Approves Request
**Notification sent to:** Admin who made the request (branch-specific)
**Priority:** Medium
**Content:**
```
Title: "Merchandise Request Approved"
Body: "Your request for [X] units of [Merchandise] has been approved. 
       The stock has been added to your inventory.
       Notes: [Approval notes if provided]"
```

### 3. Superadmin Rejects Request
**Notification sent to:** Admin who made the request (branch-specific)
**Priority:** Medium
**Content:**
```
Title: "Merchandise Request Rejected"
Body: "Your request for [X] units of [Merchandise] has been rejected. 
       Reason: [Rejection reason]"
```

## How It Works

### Backend Flow
1. Request created/approved/rejected → Announcement inserted into `announcementstbl`
2. Announcement `recipient_groups` set to `['Superadmin']` or `['Admin']`
3. `branch_id` set for Admin notifications (ensures only that branch's Admin sees it)
4. `priority` set to High for new requests, Medium for responses

### Frontend Flow
1. User clicks notification bell → Fetches from `/announcements/notifications`
2. Backend filters announcements by:
   - User's `user_type` (role)
   - User's `branch_id` (for branch-specific notifications)
   - Announcement `status` (Active)
   - Date range (if `start_date`/`end_date` set)
3. Unread count shown on bell icon
4. Clicking notification marks as read and navigates to relevant page

## Notification Behavior

### For Superadmin:
- ✅ Sees "New Merchandise Stock Request" notifications
- ✅ High priority (appears at top)
- ✅ Clicking notification shows all requests or can navigate to Merchandise page
- ✅ Badge shows pending request count

### For Admin:
- ✅ Sees "Merchandise Request Approved" for their branch
- ✅ Sees "Merchandise Request Rejected" for their branch
- ✅ Only sees notifications for their own branch
- ✅ Can click to view request details

## Database Tables Involved

### announcementstbl
```sql
- announcement_id (PK)
- title (notification title)
- body (notification message)
- recipient_groups (array: ['Superadmin'], ['Admin'], etc.)
- status ('Active', 'Inactive', 'Draft')
- priority ('High', 'Medium', 'Low')
- branch_id (NULL for all branches, specific ID for branch-specific)
- created_by (user who created - system uses request reviewer/creator)
```

### announcement_readstbl
```sql
- announcement_read_id (PK)
- announcement_id (FK)
- user_id (FK)
- read_at (timestamp)
```

## Implementation Details

### Backend Changes Made
File: `backend/routes/merchandiserequests.js`

**Added:**
1. After creating request → Insert announcement for Superadmin
2. After approving request → Insert announcement for Admin
3. After rejecting request → Insert announcement for Admin

**Code Pattern:**
```javascript
// Create notification
await dbQuery(
  `INSERT INTO announcementstbl (title, body, recipient_groups, status, priority, branch_id, created_by)
   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [title, body, recipientGroups, 'Active', priority, branchId, userId]
);
```

## Testing Checklist

- [ ] Admin creates request → Superadmin sees notification in bell
- [ ] Superadmin approves → Admin sees "Approved" notification
- [ ] Superadmin rejects → Admin sees "Rejected" notification with reason
- [ ] Notifications count badge updates in real-time
- [ ] Clicking notification marks as read
- [ ] Admin only sees notifications for their branch
- [ ] Superadmin sees notifications from all branches
- [ ] High priority requests appear at top

## User Experience

### Admin Creates Request:
1. Admin fills request form and submits
2. Success message: "Request submitted successfully!"
3. **Immediately:** Superadmin's notification bell shows badge with count
4. Superadmin clicks bell → Sees new request notification

### Superadmin Reviews Request:
1. Superadmin clicks "Approve" or "Reject"
2. Success message shown
3. **Immediately:** Admin's notification bell shows badge with count
4. Admin clicks bell → Sees approval/rejection notification
5. Admin clicks notification → Can view merchandise page to see updated stock

## Future Enhancements

### Possible Additions:
1. **Click-to-Navigate**: Make notifications link directly to:
   - Request details page
   - Merchandise page with filters
2. **Batch Notifications**: Group multiple requests into one notification
3. **Notification Preferences**: Let users choose which notifications to receive
4. **Push Notifications**: Add browser push notifications
5. **Email Integration**: Send email copies of notifications (optional)

## Troubleshooting

### Notifications Not Showing:
1. Check `announcementstbl` has records with correct `recipient_groups`
2. Verify `status = 'Active'`
3. Check user's `branch_id` matches announcement's `branch_id` (for Admin)
4. Verify NotificationDropdown component is fetching correctly

### Duplicate Notifications:
1. Check if request creation/approval is being called multiple times
2. Add unique constraint if needed (e.g., one notification per request action)

### Wrong Recipients:
1. Verify `recipient_groups` array is correct: `['Superadmin']` or `['Admin']`
2. Check `branch_id` is set correctly for branch-specific notifications
3. Confirm user's `user_type` matches recipient group

## Notes

- Notifications use existing announcement system (no new tables needed)
- Integrates seamlessly with existing NotificationDropdown component
- No changes needed to frontend notification component
- Backend handles all notification creation automatically
- Notifications persist in database (not ephemeral)
- Users can view notification history in Announcements page

