# Announcement recipient group helpers

Checkbox behavior for create/edit announcement forms when **All** is available (Superadmin, Teacher).

## Behavior

- Check **All** → selects All plus every individual group (all boxes checked).
- Uncheck **All** → clears every group.
- Uncheck one individual while All was selected → removes All and that group; others stay checked.
- Manually select every individual → **All** auto-checks.
- On submit, if All (or every individual) is selected → stores `['All']` only.

## Usage

```jsx
import {
  expandAnnouncementRecipientGroupsForForm,
  normalizeAnnouncementRecipientGroupsForSubmit,
  toggleAnnouncementRecipientGroups,
} from '../../utils/announcementRecipientGroups';

const handleRecipientGroupToggle = (group) => {
  setFormData((prev) => ({
    ...prev,
    recipient_groups: toggleAnnouncementRecipientGroups(
      prev.recipient_groups,
      group,
      RECIPIENT_GROUPS
    ),
  }));
};
```

Admin create form has no **All** option; it does not use this module.
