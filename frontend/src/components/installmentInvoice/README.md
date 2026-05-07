  # Installment Invoice Components

  Reusable React components powering the **Installment Invoice Logs**
  page across every role-scoped variant (Superadmin, Admin, Finance,
  Superfinance).

  ## Files

  | File | Purpose |
  | ---- | ------- |
  | `InstallmentPlanDetails.jsx`         | Self-contained, read-only **presentational** component that fetches and renders one installment plan (plan card, optional downpayment card, phases table, totals). Reused inline by other dialogs. |
  | `InstallmentInvoicePhasesModal.jsx`  | Modal shell around `InstallmentPlanDetails` for the "View Details" action on the Installment Invoice Logs pages. |

  ## `InstallmentPlanDetails`

  Renders a single installment plan inline. Used both inside
  `InstallmentInvoicePhasesModal` (modal context) and inside
  `components/student/StudentHistoryModal.jsx` › Invoices tab
  (rendered once per plan, with the plan's program label as a
  section header).

  ### Props

  | Prop | Type | Default | Description |
  | ---- | ---- | ------- | ----------- |
  | `profileId` | `number \| string` | — | `installmentinvoiceprofiles_id` to load. |
  | `showStudentName` | `boolean` | `true` | When `false`, the **Student Name** field is omitted (used by Student history because the student is already in the dialog header). |
  | `className` | `string` | `''` | Optional class names on the wrapper. |

  ## `InstallmentInvoicePhasesModal`

  Full-screen-on-mobile, centered-on-desktop modal that hosts
  `InstallmentPlanDetails`. Renders:

  1. Plan header — student name, program/package, frequency,
     **phase progress** (paid count / total · generated count / total
     plus a payment progress bar that turns green when the plan is
     complete), branch, and active flag.
  2. Downpayment card — AR number, amount, paid amount, **payment
     date**, and current status (when the profile has a downpayment
     invoice).
  3. Phases table — one row per phase, ordered 1..N. Generated phases
     show their AR number, issue/due dates, **payment date**, billed
     amount, paid amount, and a status badge. Phases that are not yet
     generated render as a placeholder row with status "Not Generated".
  4. Totals card — **Total Outstanding Balance** and **Total Paid
     (Student)** for the plan.

  ### Props

  | Prop | Type | Required | Description |
  | ---- | ---- | -------- | ----------- |
  | `open` | `boolean` | yes | Controls visibility of the modal. |
  | `profileId` | `number \| string \| null` | yes | `installmentinvoiceprofiles_id` to load. |
  | `onClose` | `() => void` | yes | Called when the user dismisses the modal (overlay click, Close button, or X button). |

  The modal is intentionally read-only: there are no inline edits, no
  status writes, and no parent-state callbacks. To make changes,
  collaborators continue to use the existing Invoice / Payment pages.

  ### Backend dependency

  The component fetches:

  - `GET /api/sms/installment-invoices/profiles/:id/phases` — returns
    the profile, downpayment summary, ordered phases array (each row
    including a `payment_date` field with the latest completed payment
    date for that phase), and totals. Branch isolation is enforced
    server-side for non-Superadmin roles.

  ### Role wiring

  Same component, identical props, on every page:

  - `frontend/src/pages/superadmin/InstallmentInvoice.jsx`
  - `frontend/src/pages/admin/adminInstallmentInvoice.jsx`
  - `frontend/src/pages/finance/financeInstallmentInvoice.jsx`
  - `frontend/src/pages/superfinance/superfinanceInstallmentInvoice.jsx`

  ### Responsive design

  - Modal uses the project's responsive table pattern: an
    `overflow-x-auto` wrapper around a `min-width: 820px` table so the
    page itself never scrolls horizontally.
  - On mobile the modal becomes a top-anchored full-height sheet
    (`items-stretch` + `rounded-t-xl`), and the footer button stretches
    to full width.
  - On `sm` and up the modal centers vertically with rounded corners on
    all sides.

  ### Phase grouping rules (server-side)

  - Invoices linked to the profile are grouped by chain root
    (`COALESCE(invoice_chain_root_id, invoice_id)`). A re-billed or
    balance invoice does **not** create a new phase; it inherits the
    status/dates of its chain.
  - The chain matching the profile's `downpayment_invoice_id` is split
    out as the dedicated downpayment row.
  - Remaining chains are sorted by issue date ASC and assigned phase
    numbers `1..N`. Phases beyond `N` and up to `total_phases` are
    returned as `Not Generated` placeholders so the UI shows the full
    schedule.
  - `paid_amount` per phase is the sum of `paymenttbl.payable_amount`
    for `status = 'Completed'` payments across every invoice in that
    chain.
  - `payment_date` per phase is the latest `paymenttbl.issue_date`
    across the chain's `status = 'Completed'` payments (`null` when
    the phase has never been paid).
  - `status` per phase is derived from the latest invoice in the chain:
    `Paid` / `Cancelled` from the invoice's own status, otherwise
    `Overdue` if `due_date < today` (server time), otherwise the raw
    invoice status (typically `Pending`).

  ### Totals semantics

  - `total_paid` = sum of `paid_amount` across all phases plus the
    downpayment.
  - `total_billed` = sum of generated invoice amounts plus the
    downpayment, **plus** the profile's per-phase amount for every
    not-yet-generated phase. This represents the full lifetime
    expected billing.
  - `total_outstanding` = sum of (amount − paid) per generated phase
    (floored at 0), plus the profile's per-phase amount for every
    not-yet-generated phase, plus any unpaid portion of the
    downpayment. This is the "still owed" balance the student carries
    on the plan.

  The modal currently surfaces `total_outstanding` and `total_paid`;
  `total_billed` remains in the API response for future use but is
  hidden from the UI per business request.
