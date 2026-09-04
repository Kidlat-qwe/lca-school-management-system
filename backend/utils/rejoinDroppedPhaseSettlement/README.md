# Rejoin after drop — invoice settlement (Policy A + partial-drop)

Helpers in `backend/utils/rejoinDroppedPhaseSettlement/`.

## Rules

| Situation | Invoice page | Rejoin / continue |
|-----------|--------------|-------------------|
| Phase overdue, student **active** | Payable | N/A |
| Fully unpaid, student **dropped** | **Not payable** | Rejoin later phase |
| Partially paid, then **dropped** | **Payable** (settle remaining) | Blocked until remaining settled |
| After settle partial drop | — | Next phase enrolls as **`re_enrolled`** |
| Rejoin target | — | Must be **after** highest dropped phase (drop P2 → min P3) |
| Later-phase rejoin (full unpaid drop) | — | Charge full target phase; **supersede** earlier **fully unpaid** dropped chains only |
| Rejoin invoice due date | — | **First session date** of the target phase |

## Partial-payment delinquency path

1. Partial pay → enroll **`re_enrolled`** (attendance)
2. Remaining past `due + final_dropoff_days` → **`dropped`**
3. Settle remaining → **`dropped` → `re_enrolled`**, reactivate plan
4. Pay next phase → **`re_enrolled`** (not `rejoin`)

## Manual Classes drop (`DELETE /students/class/:classId/drop/:studentId`)

| Highest active phase | Drop marker |
|----------------------|-------------|
| Has open installment remaining (partial or unpaid) | That phase → **`dropped`** (no next-phase marker) |
| Fully settled | Soft-remove actives + insert **`dropped`** on highest + 1 |

## API / UI hooks

- `POST /classes/:id/students/:studentId/rejoin-pay` — rejects if open partial-dropped remaining; due date = phase session 1
- `POST /classes/:id/students/:studentId/rejoin-invoice` — same settle-first + minimum-phase rules
- `getDroppedEnrollmentPaymentBlock` — blocks fully unpaid drops only; allows partial-drop settle
- `getPartialDroppedSettleBlockBeforeRejoin` — rejoin gate
- `supersedeOpenDroppedPhaseChainsForRejoin` — skips chains with `total_paid > 0`
- Student History — Pay Now on partial-dropped phase; Rejoin alerts until settled

## Remarks tags

- `DROPPED_NOT_PAYABLE`
- `SUPERSEDED_BY_REJOIN_PHASE:{n}`
- `SUPERSEDED_BY_INVOICE:{id}`
- Rejoin invoice: `SETTLES_REMAINING_OF:{leafId}` when settling remaining
