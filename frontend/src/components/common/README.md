# Common components

Shared UI primitives used across roles and pages.

## `FormattedDate`

Renders user-facing dates in the system standard format: **June 06, 2026** (long month name, zero-padded day, Asia/Manila).

```jsx
import FormattedDate from '../components/common/FormattedDate';

<FormattedDate value={invoice.issue_date} />
<FormattedDate value={payment.created_at} includeTime hour12 />
```

Prefer importing `formatDateManila` / `formatDateTimeManila` from `src/utils/dateUtils.js` when a string is needed (exports, filters, concatenation). Use `FormattedDate` in JSX for consistent table and detail rendering.

## `PaymentAdjustmentFields`

Shared **Tip/Payment Adjustment** and **Discount/Payment Adjustment** inputs for Record Payment modals (same layout as Invoice page).

```jsx
import { PaymentTipField, PaymentDiscountField } from '../components/common/PaymentAdjustmentFields';

<PaymentTipField value={form.tip_amount} onChange={handleChange} error={errors.tip_amount} />
<PaymentDiscountField
  value={form.discount_amount}
  onChange={handleChange}
  error={errors.discount_amount}
  payableAmount={remainingBalance}
/>
```

Labels and hints come from `src/constants/paymentFormLabels.js`.
