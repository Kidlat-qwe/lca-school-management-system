# LessonPlanViewModal

Read-only lesson plan document modal for teachers (and reusable elsewhere).

- Matches the **Create/Edit Lesson Plan** form field order (Class full-width, Class Code below, Phase/Week + Session as numbers, Topic, then sections 1–7)
- Includes DepEd-style `LessonPlanHeader`, meta fields, General Lesson Overview, and Head Teacher review when present
- Meta Phase/Week and Session show **numbers only** (same as form dropdowns)
- **Edit** / **Complete Reflection** button appears for `draft` / `revision_requested` / `awaiting_reflection` when `onEdit` is provided
- **Delete** appears after Edit only for **`draft`** when `onDelete` is provided (teacher soft-delete of unused drafts)
- For **`awaiting_reflection`**, the table eye icon opens the edit form directly so Teacher Reflection fields are writable
- Opening the eye icon refreshes the plan via `GET /lesson-plans/:id` so revision feedback is current
- Locks body scroll while open; closes on Escape or backdrop click

```jsx
import LessonPlanViewModal from '../components/lessonPlanViewModal';

<LessonPlanViewModal
  open={Boolean(viewPlan)}
  plan={viewPlan}
  onClose={() => setViewPlan(null)}
  onEdit={(plan) => { /* load into form */ }}
  onDelete={(plan) => { /* confirm + DELETE /lesson-plans/:id */ }}
  deleting={false}
/>
```
