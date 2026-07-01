# Move Student – User Guide

This guide explains how to **move an enrolled student from one class to another** (same program). The feature is available to **Superadmin** and **Admin** users.

---

## 1. What “Move Student” Does

- Moves the student’s **enrollment(s)** from the **source class** to a **target class**.
- **Phase is preserved** (e.g. Phase 2 in the old class becomes Phase 2 in the new class).
- Only classes in the **same program** and **same branch** can be used as the target.
- The database is updated: enrollments and related installment profiles are moved to the target class.

---

## 2. Where to Find It

1. Go to **Classes** (Superadmin or Admin menu).
2. On the class list, open the **⋮ (three dots)** menu for the class that contains the student.
3. Click **View Students**.
4. Choose a phase (or **All Phases**) and click **Continue**.
5. In the **Students** table, find the student and use the **Move** link in the **Actions** column.

**Note:** The Move action is only shown for **enrolled** students. Reserved or Pending students do not have the Move option.

---

## 3. Step-by-Step: Moving a Student

### Step 1 – Open the Students list

- **Superadmin:** Classes → ⋮ on a class → **View Students**.
- **Admin:** Admin Classes → ⋮ on a class → **View Students**.
- Select phase (or All Phases) and click **Continue**.

### Step 2 – Start the move

- In the table, find the student you want to move.
- In the **Actions** column, click **Move**.

### Step 3 – Choose the target class

- A **Move to Another Class** modal opens.
- The **Target class** dropdown lists only:
  - Classes in the **same program** as the current class.
  - Classes in the **same branch**.
  - **Active** classes (excluding the current class).
- Select the target class from the dropdown.

### Step 4 – Confirm

- Click **Move Student**.
- When the move succeeds, a message confirms the move and the student disappears from the source class list (they now appear under the target class).

---

## 4. Rules and Limits

| Rule | Description |
|------|-------------|
| Same program only | Target class must use the same program as the source class. |
| Same branch | Source and target class must be in the same branch. |
| Phase preserved | The student’s phase number(s) do not change; only the class changes. |
| Enrolled students only | Move is available only for students with status **Enrolled** (not Reserved or Pending). |
| Not already in target | The student must not already be enrolled in the target class. |
| Target not full | The target class must have room (respects max students). |

If a rule is broken (e.g. target full or same class), the system shows an error message and the move is not performed.

---

## 5. What Gets Updated in the System

When you move a student:

1. **Enrollments**  
   All active enrollment records for that student in the source class are updated so they point to the target class. Phase numbers stay the same.

2. **Installment profiles**  
   If the student has an active installment profile linked to the source class, it is updated to the target class so future installment invoices are generated for the new class.

Attendance and payment history for past sessions are not changed; only current and future enrollment (and related installments) are tied to the new class.

---

## 6. Troubleshooting

| Situation | What to do |
|-----------|------------|
| **Move** link not visible | Ensure the student’s status is **Enrolled**. Reserved or Pending students cannot be moved via this action. |
| **No other active classes** in dropdown | There are no other active classes in the same program and branch. Create or activate another class first. |
| **“Student is already enrolled in the target class”** | The student is already in that class. Choose a different target or no action. |
| **“Target class is full”** | The target class has reached its max students. Choose another class or increase capacity. |

For technical details (API, database tables), see the backend implementation of `POST /api/sms/classes/move-student` and the move-student logic in the Classes route.
