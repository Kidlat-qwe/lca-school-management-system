# Update Plan

Shared multi-step modal for switching a student’s installment plan or converting to full payment.

## Component

`UpdatePlanModal.jsx`

### Steps

1. **Select package** — enroll-style package cards (installment / full payment).
2. **Promo & breakdown** — optional promo code, then calculation summary including **current payments credited** (tuition only; late penalties are shown as not credited when present), and confirm invoice / conversion.

### Props

| Prop | Purpose |
|------|---------|
| `open` | Show modal |
| `student` / `sourceClass` | Context header |
| `packages` | Filtered target package options |
| `selectedPackage` / `preview` | Step 2 state from parent |
| `onSelectPackage(pkg, { promo_id, promo_code })` | Package pick or promo refresh → parent fetches preview |
| `onBackToPackages` | Clear selection and return to step 1 |
| `onConfirm({ promo_id, promo_code })` | Create adjustment / conversion invoice |

### APIs

- `POST /classes/:id/students/:studentId/package-change-preview` — body: `target_package_id`, optional `promo_id` / `promo_code`
- `POST /classes/:id/students/:studentId/package-change-invoice` — same body
- `POST /promos/validate-code` — promo field validation

Used from Superadmin `Classes.jsx` and Admin `adminClasses.jsx`.
