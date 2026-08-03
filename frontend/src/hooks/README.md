# Frontend hooks

Shared React hooks used across Admin / Superadmin pages.

| Hook | Purpose |
|---|---|
| `useMerchandiseLiveRefresh` | Poll Merchandise requests (+ stock) while the page is open so RHET `shipped` / `delivered` webhooks show without a manual refresh. |
| `useDebouncedValue` | Debounce a value for search inputs. |
| `useAttendanceDashboardFilters` | Attendance dashboard filter state. |
| `useOperationalAttendanceSessions` | Operational attendance session loading. |
| `useClassAttendanceDeepLink` | Deep-link into class attendance. |
| `usePaymentLogFilterSummaryForInvoice` | Payment-log filter summary for invoices. |
| `usePreventWheelChangingNumberInputs` | Block mouse-wheel changing focused number inputs. |
| `useTeacherAssignedClasses` | Teacher assigned-class list. |
| `useTemplateUnsavedGuard` | Guard leaving template editors with unsaved changes. |

## Merchandise live refresh

```js
import { useMerchandiseLiveRefresh } from '../hooks/useMerchandiseLiveRefresh';

useMerchandiseLiveRefresh({
  enabled: Boolean(branchId),
  requests,
  onRefresh: async () => {
    await fetchMerchandiseRequests({ silent: true });
    await fetchMerchandiseByBranch(branchId, { silent: true });
  },
});
```

Uses ~10s while any request is `Pending` / `Shipped`, otherwise ~30s. Skips ticks when the tab is hidden.
