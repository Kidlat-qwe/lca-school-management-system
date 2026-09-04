# installmentEnrollmentSync

Syncs `classstudentstbl` after installment phase payments.

## Rules

| Payment state | Enrollment |
|---------------|------------|
| No payment on chain | No enrollment |
| Partial (paid > 0, remaining > 0) | Insert/promote **`new`** (phase start) or **`re_enrolled`** — attendance allowed |
| Fully settled | Same; if row was **`dropped`** (partial delinquency), restore → **`re_enrolled`** and reactivate plan |

## Exports

- `syncInstallmentEnrollmentForPaidInvoice`
- `voidInstallmentEnrollmentForRejectedInvoice`
