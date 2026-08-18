# Announcement board filters

Shared live Search Filter for every announcements page (Admin, Superadmin, Teacher, Finance, Superfinance, Student).

## Behavior

- No Search, Reset, or advanced-filters toggle.
- Layout: Title, Recipient Group, Status (optional), Created On.
- Changing any field reloads the table after a short debounce. Clearing a field does the same.
- Only the table shows a loading overlay; the page chrome stays mounted.
- Recipient filter includes **Guardians** (guardian email notifications on create are handled by the backend).

## Usage

```jsx
import {
  AnnouncementBoardFilters,
  AnnouncementTableLoadingShell,
  useAnnouncementBoardList,
} from '../../components/announcementBoardFilters';

const {
  announcements,
  tableLoading,
  error,
  titleSearchTerm,
  setTitleSearchTerm,
  filterRecipientGroup,
  setFilterRecipientGroup,
  filterCreatedOn,
  setFilterCreatedOn,
  filterStatus,
  setFilterStatus,
  currentPage,
  setCurrentPage,
  itemsPerPage,
  totalItems,
  totalPages,
  fetchAnnouncements,
} = useAnnouncementBoardList({
  extraParams: globalBranchId ? { branch_id: String(globalBranchId) } : {},
});
```
