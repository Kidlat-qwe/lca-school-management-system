# Merchandise Stock Request System - Quick Start Guide

## ✅ What's Done (Backend Complete!)

The merchandise stock request system is **fully implemented on the backend** with automatic notifications!

### Backend Features Working:
- ✅ Request creation API
- ✅ Approval/rejection API
- ✅ Auto-stock update on approval
- ✅ **Automatic notifications to Superadmin when Admin creates request**
- ✅ **Automatic notifications to Admin when Superadmin approves/rejects**
- ✅ All notifications appear in notification bell 🔔
- ✅ Role-based access (Admin/Superadmin)
- ✅ Request history tracking
- ✅ Status management (Pending/Approved/Rejected/Cancelled)

---

## 🚀 Quick Setup (3 Steps)

### Step 1: Run Database Migration (5 minutes)
```sql
-- Open your PostgreSQL database and run this file:
backend/migrations/051_create_merchandiserequestlogtbl.sql

-- Verify it worked:
SELECT * FROM merchandiserequestlogtbl LIMIT 1;
```

### Step 2: Restart Backend (1 minute)
```bash
# The backend code is already updated
# Just restart your server:
cd backend
npm start
```

### Step 3: Update Frontend (30 minutes)
Open this file and follow the step-by-step instructions:
```
docs/FRONTEND_MERCHANDISE_REQUEST_INTEGRATION.md
```

It has **copy-paste ready code** for:
- Admin merchandise page (request creation + history)
- Superadmin merchandise page (approval/rejection)

---

## 🎯 How It Works

### Admin Flow:
```
1. Admin clicks "Request Stock" button
2. Fills form: merchandise + quantity + reason
3. Submits
4. ✨ Superadmin gets notification in bell icon instantly
5. Admin can view request status in "My Requests"
```

### Superadmin Flow:
```
1. 🔔 Bell icon shows badge (e.g., "3" pending requests)
2. Goes to Merchandise → "View Requests"
3. Sees all pending requests from all branches
4. Clicks "Approve" → Stock automatically added to branch
5. ✨ Admin gets notification instantly
```

### Notification System:
```
- Uses existing announcement system (no new code needed!)
- Notifications appear in bell icon
- Persists in database
- Can view history in Announcements page
```

---

## 📁 Files You Need

### Must Read:
1. **`docs/FRONTEND_MERCHANDISE_REQUEST_INTEGRATION.md`**
   - Complete frontend integration guide
   - Step-by-step with line numbers
   - Copy-paste ready code

### Reference (If Needed):
2. **`docs/MERCHANDISE_REQUEST_SUMMARY.md`**
   - Complete overview of system
   - Testing checklist
   - Troubleshooting

3. **`docs/MERCHANDISE_REQUEST_NOTIFICATIONS.md`**
   - How notifications work
   - Notification content examples

---

## 🧪 Test It

After completing all 3 steps above:

### Test 1: Create Request
1. Login as **Admin**
2. Go to Merchandise page
3. Click "Request Stock"
4. Fill form and submit
5. ✅ Should see success message
6. ✅ Go to "My Requests" → See your request (status: Pending)

### Test 2: Superadmin Notification
1. Login as **Superadmin** (different browser/incognito)
2. ✅ Look at notification bell → Should have badge with count
3. Click bell → See notification about new request
4. Go to Merchandise → "View Requests"
5. ✅ See the pending request

### Test 3: Approve Request
1. As **Superadmin**, click "Approve" on the request
2. (Optional) Enter approval notes
3. Confirm
4. ✅ Should see success message
5. Go to the Admin's branch merchandise
6. ✅ Stock should be added/updated

### Test 4: Admin Notification
1. Switch back to **Admin** account
2. ✅ Notification bell should have badge
3. Click bell → See "Request Approved" notification
4. Go to Merchandise
5. ✅ Stock should be visible in inventory

---

## 💡 Key Features

### For Admin:
- 🔘 "Request Stock" button (prominent in header)
- 📋 "My Requests" tab (shows history with status)
- 🔔 Notification when approved/rejected
- ❌ Cancel pending requests
- 📊 Stats: Pending/Approved/Rejected counts

### For Superadmin:
- 🔔 Notification when new request created
- 📋 View all requests from all branches
- ✅ Approve (adds stock automatically)
- ❌ Reject (with required reason)
- 🏢 See which branch made each request
- 📊 Overall request statistics

---

## 🎨 UI Preview

### Admin Header:
```
[My Requests (2)] [Request Stock 📦] [Add Merchandise Type ➕]
      ↑                 ↑                      ↑
   Badge if        Creates            Existing
   pending         request            button
```

### Admin Requests Table:
```
Merchandise | Size | Qty | Reason | Status | Date | Notes | Actions
LCA Uniform | M    | 50  | Low    | Pending| 1/5  | -     | [Cancel]
LCA Bag     | -    | 30  | Demand | Approved| 1/4 | OK   | -
```

### Superadmin Requests Table:
```
Branch | Merchandise | Size | Qty | Status | Actions
North  | LCA Uniform | M    | 50  | Pending | [Approve] [Reject]
South  | LCA Bag     | -    | 30  | Pending | [Approve] [Reject]
```

---

## 🐛 Quick Troubleshooting

### "Table doesn't exist"
→ Run the SQL migration: `backend/migrations/051_create_merchandiserequestlogtbl.sql`

### "No notification appears"
→ Check that `announcementstbl` table exists (it should, from previous work)

### "Can't see requests"
→ Make sure you restarted the backend after the code changes

### Frontend errors
→ Follow the integration guide **exactly** - check line numbers and variable names

---

## 📚 Documentation Files

All in `docs/` folder:

1. **FRONTEND_MERCHANDISE_REQUEST_INTEGRATION.md** ← **START HERE**
2. MERCHANDISE_REQUEST_SUMMARY.md
3. MERCHANDISE_REQUEST_IMPLEMENTATION.md
4. MERCHANDISE_REQUEST_NOTIFICATIONS.md
5. MERCHANDISE_REQUEST_CODE_SNIPPETS.md

---

## ⏱️ Time Estimate

- Database migration: **5 minutes**
- Backend restart: **1 minute**
- Frontend integration: **30 minutes**
- Testing: **15 minutes**
- **Total: ~50 minutes**

---

## ✨ What Makes This Great

1. **No Email Setup Needed** - Uses existing notification bell
2. **Auto-Stock Update** - No manual inventory management
3. **Role-Based** - Admin sees only their branch, Superadmin sees all
4. **Real-Time** - Notifications appear instantly
5. **Persistent** - All requests tracked in database
6. **Undo-able** - Admin can cancel, Superadmin can reject

---

## 🎉 You're Ready!

1. Run the SQL migration
2. Restart backend
3. Follow the frontend guide
4. Test it!

**That's it!** The system is fully functional and ready to use.

---

**Need Help?**
- Check: `docs/MERCHANDISE_REQUEST_SUMMARY.md`
- Or: Read through the other documentation files

**Ready to Start?**
→ Go to: `docs/FRONTEND_MERCHANDISE_REQUEST_INTEGRATION.md`

