# RichTextEditor

Email-style rich text field for lesson plan content (and reusable elsewhere).

## Toolbar (included)

- Bold, Italic, Underline, Strikethrough
- Image (URL), Link
- Text color, highlight
- Bulleted / numbered lists
- Align left / center / right
- Table, clear formatting
- Expand / collapse second toolbar row

## Excluded (by product request)

- Undo / Redo
- Font family
- Font size

## Usage

```jsx
import RichTextEditor, {
  isRichTextEmpty,
  isLessonPlanRichTextField,
  LESSON_PLAN_RICH_TEXT_HTML_CLASS,
  mergeLessonPlanObjectivesHtml,
} from '../richTextEditor';

<RichTextEditor
  value={formData.early_learning_goals}
  onChange={(html) => handleInputChange('early_learning_goals', html)}
  placeholder="List early learning goals"
  disabled={!canEdit}
/>
```

Applied to all lesson-plan body fields from Early Learning Goals through Head Teacher Review
(topic / date / class selectors stay plain). HTML is stored in existing TEXT columns.
Legacy `objective_2` / `objective_3` merge on load via `mergeLessonPlanObjectivesHtml` and clear on save.
