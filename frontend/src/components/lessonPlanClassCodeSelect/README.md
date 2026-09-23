# LessonPlanClassCodeSelect

Custom Class Code dropdown for teacher lesson plans.

- Menu is rendered in a **portal** with `position: fixed` directly **below** the trigger (never flips upward like a native `<select>`)
- Opening highlights the first **selectable** option
- Selected value shows the **full class code + phase/session** (and schedule date when available); long values wrap instead of truncating
- Menu option rows still truncate with a **hover** `title` tooltip for the full string
- **Makeup** options show an amber badge
- **Cancelled** (suspended) options show a red badge, struck-through text, and are **not selectable** (visible for context next to makeup)
- Used instead of a native `<select>`

```jsx
import LessonPlanClassCodeSelect from '../components/lessonPlanClassCodeSelect';
```
