# Lesson Plans feature flag

Controls whether Lesson Plans appear in the UI for all roles.

## Enable

Set in frontend env (`.env` / Coolify):

```env
VITE_LESSON_PLANS_ENABLED=true
```

Rebuild/redeploy the frontend after changing.

## When disabled (default)

- Sidebar: no **Lesson Plans** for Teacher, Admin, or Superadmin
- Routes: `/superadmin|admin|teacher/lesson-plans` redirect to each role’s dashboard
- Settings: **Lesson Plans** tab hidden
- Notifications: lesson-plan alerts open Announcements instead

Backend APIs remain available for a later launch.
