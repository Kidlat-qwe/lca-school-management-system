# lessonPlanRevisionFeedback

Shared helpers and UI for verifier revision notes shown to teachers.

## Exports

| Export | Purpose |
|--------|---------|
| `parseRevisionFeedbackClient` | Parse legacy plain-text or JSON `revision_reason` |
| `getPlanRevisionFeedback` | Prefer API `revision_feedback`, else parse `revision_reason` |
| `getRevisionItemsForField` | Items flagged for a form field key |
| `FieldRevisionNotes` | Red banner under a field (only when status is `revision_requested`) |
| `GeneralRevisionNotes` | Red banner for general / legacy notes |
| `RevisionFeedbackSummary` | Full summary block for the read-only view modal (before Edit) |

```jsx
import {
  FieldRevisionNotes,
  GeneralRevisionNotes,
  RevisionFeedbackSummary,
} from '../lessonPlanRevisionFeedback';

<RevisionFeedbackSummary plan={plan} />
<FieldRevisionNotes plan={plan} fieldKey="topic" />
<GeneralRevisionNotes plan={plan} />
```
