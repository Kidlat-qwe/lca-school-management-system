# Announcement form modal

Landscape create/edit announcement wizard shared by Admin and Superadmin.
UI follows the product Create Announcement mockups (two-step content + audience).

## Flow

1. **Branch gate** (Superadmin create only): pick a branch or All Branches → Continue
2. **Step 1 — Content**: Title, Subject, email notification card, drag-and-drop attachment, description editor chrome → **Save as Draft** / **Next**
3. **Step 2 — Audience & Schedule**: Recipient group cards, Programs/Classes (when academic groups selected), Delivery Settings, Schedule → **Create Announcement**

## Notes

- Description stays plain text (email-safe); toolbar inserts simple markers / list prefixes
- Character limit: 5000
- Draft create allows empty recipient groups (backend)

## Usage

```jsx
import AnnouncementFormModal from '../components/announcementFormModal';

<AnnouncementFormModal
  isOpen={isModalOpen}
  onClose={closeModal}
  onSubmit={handleSubmit}
  onSaveDraft={handleSaveDraft}
  requireBranchGate
  showBranchSelect
  branches={branches}
  /* ... */
/>
```
