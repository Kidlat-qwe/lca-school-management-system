# Lesson Plan Manual — Teachers

End-user guide for creating, submitting, revising, and completing lesson plans in the Physical School Management System.

**Who this is for:** Teachers  
**Where to open:** Sidebar → **Lesson Plans** (`/teacher/lesson-plans`)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Status meanings](#2-status-meanings)
3. [Page layout](#3-page-layout)
4. [Create a lesson plan](#4-create-a-lesson-plan)
5. [Save draft vs submit](#5-save-draft-vs-submit)
6. [After you submit](#6-after-you-submit)
7. [If revision is requested](#7-if-revision-is-requested)
8. [Teacher Reflection (Awaiting Reflection)](#8-teacher-reflection-awaiting-reflection)
9. [Missed lesson plans](#9-missed-lesson-plans)
10. [Tips and common issues](#10-tips-and-common-issues)

---

## 1. Overview

A lesson plan is your LCA form for a specific **class session** (grade, class code, phase, session, and lesson date).

Typical flow:

1. You create and fill out the plan.
2. You **Submit for Verification**.
3. A verifier reviews it (approve or request revision).
4. After approval, you complete **Teacher Reflection**.
5. The plan becomes **Completed**.

You only see classes you are assigned to.

---

## 2. Status meanings

| Status | What it means | What you can do |
|--------|----------------|-----------------|
| **Draft** | Saved but not sent for review | Edit and submit |
| **Submitted** | Waiting for verifier review | View only (wait for decision) |
| **Revision requested** | Verifier sent it back with notes | Edit flagged fields, then **Resubmit for Verification** |
| **Awaiting Reflection** | Verifier approved the plan | Fill Teacher Reflection, then save to complete |
| **Completed** | Reflection finished | View only |

**Submitted At** is set the **first** time you submit. Resubmitting after revision does not change that original timestamp.

---

## 3. Page layout

### Tabs

| Tab | Purpose |
|-----|---------|
| **My Plans** | All your lesson plans (any status) |
| **Missed** | Overdue scheduled sessions that still need a submitted plan |

### Filters (My Plans)

- **Search** — topic, class code, grade, etc.
- **Lesson Date** — optional exact date
- **Grade Level**
- **Status**

### Table actions

- **Eye icon** — view the plan (read-only document). For **Awaiting Reflection**, opens the form so you can fill reflection.
- **Topic click** — open the edit form when the plan is editable (Draft / Revision requested / Awaiting Reflection).

---

## 4. Create a lesson plan

1. Click **Create Lesson Plan**.
2. Choose **Grade Level** (from your assigned classes).
3. Choose **Class Code** — this selects the class **and** the Phase / Session for that scheduled session.
4. Confirm **Phase**, **Session**, and **Lesson Date** (date usually fills from the session schedule).
5. Fill the LCA sections (rich-text editors — formatting like email: bold, lists, links, etc.; no font/undo controls):
   - Lesson topic (plain text)
   - Early Learning Goals
   - Learning Objectives (one field)
   - Assessment method and criteria
   - Materials needed
   - Preliminaries, Lesson Proper, Conclusion (activity & goal)
   - Class considerations and adjustments
6. Save as draft or submit for verification.

After approval, complete **Teacher Reflection** in the same rich-text format. Head Teacher review fields (verifier) also use the same editor.

### Notes

- Past upcoming sessions are hidden for new plans so you pick current/future sessions.
- If a session is on the **Missed** tab, use **Create** there — the form opens already filled for that past session.

---

## 5. Save draft vs submit

| Action | Result |
|--------|--------|
| Save as draft | Status stays **Draft**. Not visible in the verifier Pending queue. Still counts as **missed** until you submit. |
| **Submit for Verification** | Status becomes **Submitted**. Verifiers can review it. |

All required lesson sections must be complete before submit is allowed. Teacher Reflection is **not** filled at submit time — it unlocks only after approval.

---

## 6. After you submit

- The plan moves to **Submitted**.
- Verifiers see it under their **Pending** tab.
- You may receive a notification when they **approve** or **request revision**.

While status is **Submitted**, you cannot edit the body of the plan.

---

## 7. If revision is requested

1. Open the plan (topic click or eye).
2. Read the revision notes:
   - Field-specific notes next to flagged sections
   - General notes, if any
3. Update the requested sections.
4. Click **Resubmit for Verification**.

Status returns to **Submitted** and appears again in the verifier **Pending** queue.

---

## 8. Teacher Reflection (Awaiting Reflection)

After a verifier **approves** your plan:

1. Status becomes **Awaiting Reflection**.
2. Open the plan (eye or topic) — the form scrolls to **Teacher Reflection**.
3. Complete all four fields:
   - **Successes**
   - **Amazing Moments**
   - **Challenges**
   - **Improvements**
4. Click **Save Reflection & Mark Completed**.

No second verifier approval is required. Status becomes **Completed**.

You can also read the verifier’s **Head Teacher’s Review** (Overall Assessment, Specific Feedback, Next Steps) on the approved plan.

---

## 9. Missed lesson plans

The **Missed** tab lists scheduled class sessions that:

- Already happened (after the scheduled date), and
- Do not yet have a **submitted** lesson plan from you (a draft alone is not enough)

### Track from

Use **Track from** to set how far back the list looks. The system default starts from the lesson-plan go-live date so very old class history is not listed.

### Clear a missed row

Create and **submit** a lesson plan for that class + phase + session. After submit (or later statuses: revision / awaiting reflection / completed), it leaves the Missed list.

---

## 10. Tips and common issues

| Issue | What to try |
|-------|-------------|
| No class codes | Confirm you are assigned to the class. Ask Admin if the assignment is missing. |
| Cannot submit | Fill every required section. Check for empty Learning Objectives, materials, or procedure fields. |
| Cannot edit | Status may be Submitted or Completed. Wait for revision request, or open Awaiting Reflection for reflection only. |
| Still on Missed after saving | You must **Submit for Verification**, not only save a draft. |
| Wrong phase/session | Use Class Code from the list (same codes as Classes → View Class Details). Changing Class Code resets Phase/Session. |

---

## Quick checklist

- [ ] Create plan for the correct Grade → Class Code → Phase → Session  
- [ ] Complete all required LCA sections  
- [ ] Submit for Verification (not draft only)  
- [ ] If revision: fix notes → Resubmit  
- [ ] After approval: complete all four Reflection fields → Mark Completed  
- [ ] Check **Missed** regularly and clear overdue sessions  

---

*Related technical notes for developers: `frontend/src/pages/teacher/README.md`, `backend/lib/lessonPlans/README.md`.*
