# LessonPlanViewModal

Read-only lesson plan document modal for teachers (and reusable elsewhere).

- Matches the LCA / PDF field order used on the Superadmin review sheet
- Includes DepEd-style `LessonPlanHeader`, meta fields, sections 1–6, and Head Teacher review when present
- **Edit** / **Complete Reflection** button appears for `draft` / `revision_requested` / `awaiting_reflection` when `onEdit` is provided
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
/>
```
