# LessonPlanDateFilter

Native date filter for the teacher Lesson Plans list (same UI pattern as **Announcement Created On**).

- Label above the field (default: **Lesson Date**)
- Browser date input (`mm/dd/yyyy` + calendar icon + Clear / Today in the picker)
- **Default: off** — empty value means no date filter

```jsx
import LessonPlanDateFilter from '../components/lessonPlanDateFilter';

<LessonPlanDateFilter
  value={dateFilter}
  onChange={setDateFilter}
/>
```
