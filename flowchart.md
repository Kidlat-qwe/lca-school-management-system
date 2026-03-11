## Finance & Superfinance – System Flowcharts

This document summarizes the main user flows and scenarios for **Finance** (branch-level) and **Superfinance** (system-level) roles in the Physical School Management System.

---

### 1. Login & Role Routing

```mermaid
  flowchart TD
  A[User opens Login page] --> B[Enter email & password]
  B --> C{Credentials valid?}
  C -- No --> D[Show error message<br/>'Failed to login...']
  C -- Yes --> E{User type from backend}

  E -- Finance with branch_id --> F[Redirect to Finance dashboards<br/>(branch-level)]
  E -- Finance with no branch_id --> G[Redirect to Superfinance dashboards<br/>(system-level)]
  E -- Admin/Superadmin/Teacher/Student --> H[Redirect to respective role home]

  F --> I[Header shows Role: Finance<br/>Branch name visible]
  G --> J[Header shows Role: Superfinance<br/>Branch filter available]
```

---

### 2. Invoice Lifecycle (Finance & Superfinance)

```mermaid
  flowchart TD
  A[Manage Invoice → Invoice] --> B[Finance/Superfinance views invoice list]
  B --> C[Filter by Status / Branch / Search<br/>by invoice no. or student]

  C --> D{Invoice selected?}
  D -- No --> B
  D -- Yes --> E[Open invoice details / actions]

  E --> F{Action chosen from 3-dots menu?}
  F -- View Details --> G[Show invoice header, items,<br/>payments, status, branch, students]
  F -- Download PDF --> H[Generate & download invoice PDF]
  F -- Pay --> I[Open Record Payment modal]
  F -- Delete Invoice* --> J[Delete invoice (with confirmation)<br/>*typically restricted to admins]

  I --> K{Payment Type}
  K -- Full Payment --> L[Record payment = remaining balance]
  K -- Partial Payment --> M[Record payment < remaining balance]
  K -- Advance Payment --> N[Record payment for future invoice<br/>or overpayment]

  L --> O[Invoice status → Paid]
  M --> P[Invoice status --> Partially Paid]
  N --> Q[Invoice status → Pending/Advance logic<br/>(depends on implementation)]

  O & P & Q --> R[Payment entry written to Payment Logs]
  R --> S[Affects dashboards & receivables metrics]
```

---

### 3. Installment Invoice Profiles & Phases

```mermaid
  flowchart TD
  A[Manage Invoice → Installment Invoice] --> B[View installment profiles/logs]
  B --> C[Filter by Branch (Superfinance), Status,<br/>search by Student/Program]

  C --> D{Profile selected?}
  D -- No --> B
  D -- Yes --> E[Open installment profile details]

  E --> F[See contract: total amount,<br/>monthly amount, frequency, total phases]
  F --> G[See generated invoices list<br/>with status and amounts]
  F --> H[See Phase Progress X/Y<br/>(based on PAID invoices only)]

  G --> I{Installment invoice due?}
  I -- Not yet --> J[Next generation date in future]
  I -- Due today/past --> K[Background scheduler generates invoice]

  K --> L[New invoice appears in Invoice list]
  L --> M[Branch Finance records payment via Pay modal]
  M --> N[When invoice Paid → increase paid phases]
  N --> O{All phases paid?}
  O -- No --> H
  O -- Yes --> P[Phase Progress Y/Y & status Completed]
```

---

### 4. Payment Logs – Auditing & Reporting

```mermaid
  flowchart TD
  A[Manage Invoice → Payment Logs] --> B[View payment list]
  B --> C[Filter by Date Range, Branch (Superfinance),<br/>Payment Method, Status, Invoice No., Student]

  C --> D{Need details?}
  D -- No --> C
  D -- Yes --> E[Open payment detail row / use invoice link]

  B --> F{Export requested?}
  F -- Yes --> G[Export to Excel (if enabled)]
  F -- No --> C

  E --> H[Use for reconciliation with bank,<br/>cash reports, or disputes]
```

---

### 5. Acknowledgement Receipts (AR) – Upfront Payments

```mermaid
  flowchart TD
  A[Manage Invoice → Acknowledgement Receipts] --> B[View AR table]
  B --> C[Filter by Branch (Superfinance), Status,<br/>search by Student/Ref No.]

  C --> D{Scenario}

  D -- New upfront payment at branch --> E[Branch Finance creates AR<br/>(Create Acknowledgement Receipt)]
  E --> F[Enter student/prospect name,<br/>guardian, package, level tag]
  F --> G[Enter Amount, Reference No., attach proof image]
  G --> H[Save AR]
  H --> I[Status: e.g., Enrolled / Reserved<br/>Amount tracked per branch]

  D -- Review existing AR --> J[Superfinance filters by branch & date]
  J --> K[Check Amount, Attachment, Reference No.]
  K --> L[Cross-check with invoices, enrollments,<br/>and bank/cash reports]
```

---

### 6. Cross-Branch View – Finance vs Superfinance

```mermaid
  flowchart TD
  A[Open any Finance page<br/>(Invoice, Installment, Payment Logs, AR)] --> B{Role}
  B -- Finance --> C[Branch filter hidden<br/>Data limited to assigned branch]
  B -- Superfinance --> D[Branch filter visible<br/>Can switch or clear to see all]

  D --> E[Select branch X → show only X data]
  D --> F[Clear branch → show all branches]

  C & E & F --> G[Same actions available:<br/>view invoices, record payments,<br/>review logs and receipts]
```

---

These flowcharts give Finance and Superfinance users (and developers) a clear picture of how the main financial scenarios behave across the system: from login and role routing, through invoice/payment lifecycles and installment plans, to acknowledgements and cross‑branch auditing.
