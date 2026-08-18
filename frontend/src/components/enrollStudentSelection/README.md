# Enroll student selection

Shared UI for the class enroll wizard after a package is chosen.

Used by Admin [`adminClasses.jsx`](../../pages/admin/adminClasses.jsx) and Superadmin [`Classes.jsx`](../../pages/superadmin/Classes.jsx).

## Wizard flow

1. **Select students** — search/chips, package + promo. Order summary on the right.
2. **Configure items** — uniform sizes **and** freebie stock (Backpack, ID Lace, …). Keep/swap cards and the order summary show `N in stock`, not only the uniform size dropdown.
3. **Review** — final student, items (including **Replacement item** / Replaces: Backpack), then enroll.

Header title: **Add students to package**. Stepper: Select students → Configure items → Review.

## Layout

- **Small screens:** stacked (main, then summary)
- **`lg+`:** landscape — wide main pane + 320–360px order summary rail
- Footer: Cancel on the left; Back / Continue / Review order / Enroll & Generate Invoice on the right

## Files

| File | Role |
|------|------|
| `EnrollWizardStepper.jsx` | 1–2–3 progress |
| `EnrollOrderSummary.jsx` | Package, students, included items, total |
| `EnrollStudentSelectionLayout.jsx` | Main + summary columns |
| `buildEnrollSummaryItems.js` | Summary/review item lines from keep/swap + sizes |

Keep/swap cards: `components/packageMerch/PackageMerchEntitlementPanel.jsx`.
