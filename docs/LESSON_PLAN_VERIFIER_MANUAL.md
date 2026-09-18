# Lesson Plan Manual — Verifiers

End-user guide for reviewing, approving, and tracking teacher lesson plans in the Physical School Management System.

**Who this is for:**

- **Superadmin** — all branches  
- **Admin** selected as a lesson plan verifier in **Settings → Lesson Plans** — designated branch only  

**Where to open:**

- Superadmin: Sidebar → **Lesson Plans** (`/superadmin/lesson-plans`)  
- Admin verifier: Sidebar → **Lesson Plans** (`/admin/lesson-plans`)  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Who can verify](#2-who-can-verify)
3. [Status and tabs](#3-status-and-tabs)
4. [Filters and branch scope](#4-filters-and-branch-scope)
5. [Review a pending plan](#5-review-a-pending-plan)
6. [Approve (Head Teacher review)](#6-approve-head-teacher-review)
7. [Request revision](#7-request-revision)
8. [Revision and Verified tabs](#8-revision-and-verified-tabs)
9. [Missed tab](#9-missed-tab)
10. [Notifications and badges](#10-notifications-and-badges)
11. [Tips and common issues](#11-tips-and-common-issues)

---

## 1. Overview

Teachers submit LCA lesson plans for scheduled class sessions. Your role is to:

1. Review plans on the **Pending** tab.
2. Either **Approve** (with Head Teacher feedback) or **Request revision**.
3. Monitor **Revision**, **Verified**, and **Missed** as needed.

Workflow:

```text
Teacher submits
    → Pending (Submitted)
        → Approve → Verified (Awaiting Reflection → Completed by teacher)
        → Request revision → Revision tab → Teacher edits → Pending again
```

You do **not** re-approve after the teacher finishes reflection. Completing reflection is the teacher’s step.

---

## 2. Who can verify

| Role | Access |
|------|--------|
| **Superadmin** | Always. All branches (optional branch filter in the yellow header). |
| **Admin** | Only if selected under **Settings → Lesson Plans**. Sees only their designated branch. |

If an Admin is not selected as a verifier, Lesson Plans does not appear in their sidebar (or redirects away if they open the URL).

---

## 3. Status and tabs

| Tab | Plans shown | Your actions |
|-----|-------------|--------------|
| **Pending** | Submitted | Open, approve, or request revision |
| **Revision** | Revision requested | View only until the teacher resubmits |
| **Verified** | Awaiting Reflection, Completed | View (including Head Teacher review and later reflection) |
| **Missed** | Overdue sessions with **no submitted plan** | Log / monitor (not a review of an existing plan) |

Badge counts on each tab show how many items are in that queue (respecting branch filter for Superadmin).

---

## 4. Filters and branch scope

### Common filters

- **Search** — topic, teacher, class code, grade, branch name, etc.
- **Lesson Date** — exact date (Pending / Revision / Verified)
- **Grade Level**

### Superadmin branch filter

Use the **branch dropdown in the yellow app header** on Lesson Plan Review. Empty = All Branches.

### Missed tab filter

- **Track from** — start date for overdue history (default go-live: **2026-09-19**). Widen or narrow as needed.

Admin verifiers do not get a branch dropdown; the API already limits them to their branch.

---

## 5. Review a pending plan

1. Open the **Pending** tab.
2. Click the **eye** icon or the **topic** to open the review modal.
3. Read the LCA sections in order (topic, phase, session, class, goals, objectives, assessment, materials, procedure, class adjustments).
4. Teacher Reflection is empty / locked until after you approve — that is expected.
5. Choose **Approve** or **Request revision** at the bottom of the modal.

---

## 6. Approve (Head Teacher review)

Before Approve is enabled, you **must** complete **Head Teacher’s Review and Feedback**:

1. **Overall Assessment**
2. **Specific Feedback**
3. **Next Steps**

Then confirm Approve.

### Result

- Status becomes **Awaiting Reflection**.
- Plan moves to the **Verified** tab.
- **Verified At** is recorded.
- Teacher is notified and must fill Teacher Reflection to mark the plan **Completed**.

You cannot approve without all three Head Teacher fields. The system blocks incomplete approve both in the UI and on the server.

---

## 7. Request revision

1. On a Pending plan, click **Request revision**.
2. Flag fields that need work (**Field needs revision**) and enter a reason for each.
3. Optionally add a **general note**.
4. Submit the revision request (at least one flagged field or a general note is required).

### Result

- Status becomes **Revision requested**.
- Plan moves to the **Revision** tab.
- Teacher is notified and can edit, then **Resubmit for Verification**.
- After resubmit, the plan returns to **Pending** for you to review again.

Plans on the Revision tab are view-only for verifiers until the teacher resubmits.

---

## 8. Revision and Verified tabs

### Revision

Use this to see what is waiting on the teacher. Open a plan to re-read content and your previous feedback; you cannot approve from this tab until it is submitted again.

### Verified

- **Awaiting Reflection** — approved; teacher has not finished reflection yet.
- **Completed** — teacher finished all four reflection fields.

On Verified, the timestamp column shows **Verified At** (instead of Submitted At). Head Teacher review is shown read-only.

---

## 9. Missed tab

**Missed** lists expected lesson plans that were never submitted:

- Session **scheduled date** is before today (Asia/Manila), and
- On or after the **Track from** date, and
- No submitted plan exists for that teacher + class + phase + session

Important:

- A teacher **draft** does **not** clear a miss — only submit (or later workflow statuses) does.
- This tab is a **compliance log**, not a place to approve. Teachers clear items by submitting from their Lesson Plans → Missed → **Create**.

Default tracking start is **2026-09-19** so older class schedules from before the feature do not flood the list.

---

## 10. Notifications and badges

| Event | What you see |
|-------|----------------|
| Teacher submits | Sidebar **Lesson Plans** pending count updates (no separate urgent alert required) |
| You approve or request revision | Teacher receives a system notification |

---

## 11. Tips and common issues

| Issue | What to try |
|-------|-------------|
| Approve button disabled | Fill all three Head Teacher fields. |
| Admin cannot see Lesson Plans | Ask a Superadmin to add you under **Settings → Lesson Plans**. |
| Empty Pending but teachers say they submitted | Check branch filter (Superadmin). Confirm status is Submitted, not Draft. |
| Missed list too large / too old | Raise **Track from** toward the go-live date (or later). |
| Plan stuck on Revision | Teacher must resubmit after editing; you cannot pull it back to Pending yourself. |

---

## Quick checklist

- [ ] Open **Pending** daily (watch the sidebar badge)  
- [ ] Read the full LCA content before deciding  
- [ ] Approve only with complete Head Teacher feedback  
- [ ] Or request revision with clear field notes  
- [ ] Spot-check **Missed** for teachers who have not submitted  
- [ ] Superadmin: set branch filter when reviewing one campus  

---

## Settings note (Superadmin)

**Settings → Lesson Plans** manages which **Admin** users are verifiers. Superadmins are always allowed and are not stored on that list.

---

*Related technical notes for developers: `frontend/src/pages/superadmin/LessonPlans/README.md`, `backend/routes/lessonPlans/README.md`, `backend/lib/lessonPlans/README.md`.*
