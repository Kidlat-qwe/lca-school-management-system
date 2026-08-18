# Enrollment matrix → Student history

Opens **Student history** from phase/month re-enrollment matrix student names.

| Export | Purpose |
|---|---|
| `matrixTrackIsFullPayment` | Track is native full payment or converted (`is_full_payment` cells / `last_full_pay_month_key`) |
| `matrixTrackToHistoryStudent` | Maps a matrix row to the `student` prop for `StudentHistoryModal` |
| `useEnrollmentMatrixStudentHistory` | Open/close state used by both matrix charts |

## Initial tab

- **Full payment** track → `initial_tab: 'full-payment'`
- **Installment** track → `initial_tab: 'invoices'`

`StudentHistoryModal` honors `student.initial_tab` (and `is_full_payment` as a fallback).

`../enrollmentMatrixStudentHistory.js` re-exports this folder so Vite HMR and older import paths keep working. Do not put logic in that shim.
