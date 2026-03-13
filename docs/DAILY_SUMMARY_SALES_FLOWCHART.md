## Daily Summary Sales – Flowchart

This document provides a flowchart view of the **Daily Summary Sales** workflow, from branch Admin submission to Superadmin/Superfinance approval.

```mermaid
flowchart TD
  %% Admin side – create daily summary
  A[Admin logs in] --> B[Role: Admin (branch)]
  B --> C[Open Manage Invoice → Daily Summary Sale]
  C --> D[Backend resolves branch_id<br/>and today (Asia/Manila)]
  D --> E[GET /daily-summary-sales/check-today]

  E --> F{Summary for today<br/>already exists?}
  F -- Yes --> G[Show existing summary<br/>(any status)]
  G --> H[Disable Submit Daily Summary<br/>Admin cannot create another]

  F -- No --> I[GET /daily-summary-sales/preview?<br/>date=today&branch_id=branch_id]
  I --> J[Show preview totals<br/>from paymenttbl:
           <br/>• total_amount = SUM(payable_amount)
           <br/>• total_transactions = COUNT(*)]
  J --> K{Admin confirms<br/>preview correct?}

  K -- No --> L[Admin reviews Payment Logs<br/>or re-checks inputs]
  L --> J

  K -- Yes --> M[POST /daily-summary-sales<br/>(no manual amount)]
  M --> N[Insert into daily_summary_salestbl:
           <br/>• branch_id
           <br/>• summary_date = today
           <br/>• total_amount, total_transactions
           <br/>• status = SUBMITTED]
  N --> O[Return created record<br/>to frontend]
  O --> P[Show SUBMITTED summary<br/>and disable Submit button]

  %% Superadmin / Superfinance – review & approval
  Q[Superadmin / Superfinance logs in] --> R[Open Manage Invoice → Daily Summary Sales]
  R --> S[Use filters:
           <br/>• date / date range
           <br/>• branch
           <br/>• status]
  S --> T[GET /daily-summary-sales<br/>with filters]
  T --> U[Display list of summaries<br/>grouped by branch & date]

  U --> V{Row status = SUBMITTED?}
  V -- No --> W[Row is APPROVED or REJECTED<br/>Read-only; no actions]

  V -- Yes --> X[Reviewer selects row<br/>for detailed check]
  X --> Y[Optionally open Payment Logs<br/>filtered by branch & date]
  Y --> Z[Cross-check totals against<br/>underlying payments]

  Z --> AA{Approve or Reject?}
  AA -- Approve --> AB[PUT /daily-summary-sales/:id/approve<br/>{ action: "approve" }]
  AB --> AC[Update status → APPROVED<br/>set approved_by, timestamps]

  AA -- Reject --> AD[PUT /daily-summary-sales/:id/approve<br/>{ action: "reject", remarks }]
  AD --> AE[Update status → REJECTED<br/>save remarks]

  AC --> AF[Row becomes locked<br/>used for reports & audit]
  AE --> AF
```

### Legend

- **Admin (branch)**: Can **preview** and **submit** a daily summary **once per day per branch**.
- **Superadmin / Superfinance**: Can **view, approve, or reject** submitted summaries across branches.
- **Finance (branch)**: Uses Payment Logs and AR only; **no access** to Daily Summary Sales.

### Key Rules (Visual Summary)

- One record per `(branch_id, summary_date)` in `daily_summary_salestbl`.
- Totals always come from `paymenttbl` (backend calculation) — **no manual total input**.
- All "today" logic uses **Asia/Manila** timezone.
- `APPROVED` and `REJECTED` states are **terminal** (no further edits).

