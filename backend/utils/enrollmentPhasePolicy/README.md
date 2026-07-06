# Enrollment phase policy

Temporary override for **past-phase enrollment** (installment / per-phase enrollment when class is already in progress).

## Files

| Layer | File |
|-------|------|
| Backend | `backend/utils/enrollmentPhasePolicy.js` |
| Frontend | `frontend/src/utils/enrollmentPhasePolicy.js` |

## Flag

`ALLOW_ENROLLMENT_FROM_PREVIOUS_PHASES`

- **`true` (current)** — Minimum enrollable phase is **Phase 1** regardless of class schedule floor.
- **`false`** — Restore default: enrollment floor follows `getInstallmentEnrollmentFloorPhase` (previous phase last session rule).

## Used by

- `backend/utils/classActivePhase.js` → `resolveInstallmentEnrollmentMinPhase`
- `backend/routes/classes.js`, `backend/routes/reservations.js`
- `frontend/src/utils/classActivePhase.js` → enrollment modals on Classes pages

## Re-enable restriction

Set the flag to `false` in **both** backend and frontend files, then restart the API and refresh the browser.
