# Confirm delivery context

Keeps Branch Admin **Confirm received** (RHET deliver + branch stock) running
across route changes.

## Why

`adminMerchandise` local state unmounts when navigating away, which would drop
the loading overlay / mini spinner. This provider lives under `Layout` so:

- Confirm API calls continue after leaving Merchandise
- Full overlay + minimized mini spinner (above **Need help?**) stay visible until done
- In-flight request IDs stay locked on Shipped checkboxes if the user returns early

## API

| Export | Purpose |
|--------|---------|
| `ConfirmDeliveryProvider` | Wraps Layout body; renders `ConfirmDeliveryLoadingOverlay` |
| `useConfirmDelivery()` | `isBusy`, `inFlightIds`, `isRequestInFlight(id)`, `confirmDelivery`, `confirmDeliveryBulk` |

Callers (Merchandise page) still show `appConfirm` before invoking
`confirmDelivery` / `confirmDeliveryBulk`. Alerts on success/failure are shown
from the provider so they appear even if the user left the page.
