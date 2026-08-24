# Announcement audience filters (UI)

Program + class multi-select used on Create/Edit Announcement.

## Behavior

- Shown by the form modal only when Students, Guardians, Teachers (or All) are selected
- Default is unset (`null`) — nothing pre-selected, including “All”
- User must choose **All** or specific ids; **All** is sent as `[]`
- When programs are narrowed, the class list is limited to those programs (**by `program_id`**, not level tag)
- Classes are loaded via paginated `GET /classes` (API max `limit=100` per page)

## Usage

```jsx
import AnnouncementAudienceFilters from '../components/announcementAudienceFilters';

<AnnouncementAudienceFilters
  programIds={formData.program_ids}
  classIds={formData.class_ids}
  branchId={formData.branch_id || userBranchId}
  errors={formErrors}
  onChange={({ program_ids, class_ids }) =>
    setFormData((prev) => ({ ...prev, program_ids, class_ids }))
  }
  compact
/>
```
