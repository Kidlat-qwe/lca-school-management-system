# Announcement send email toggle

Optional toggle on **Create Announcement** forms (Superadmin, Admin, Teacher).

## Behavior

- Default: **on** (matches previous automatic email on Active create).
- When **off**, the announcement is saved but `POST /announcements` skips outbound email.
- Shown on **edit** as read-only hint only (updates never trigger email today).
- Subject is required only when send email is on and status is Active.
- `variant="card"` — mockup style with envelope icon (used in announcement form modal).

## Usage

```jsx
import AnnouncementSendEmailToggle from '../../components/announcementSendEmailToggle';

<AnnouncementSendEmailToggle
  checked={formData.send_email}
  onChange={(value) => setFormData((prev) => ({ ...prev, send_email: value }))}
  status={formData.status}
  showEditHint={Boolean(editingAnnouncement)}
/>
```

Payload on create: `{ send_email: true | false }` (omit on PUT).
