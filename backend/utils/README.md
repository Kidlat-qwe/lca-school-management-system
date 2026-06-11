# Backend utilities

## `installmentPhaseBillingSync.js`

Keeps installment **phase slots**, **`generated_count`**, and **`TARGET_PHASE`** invoice remarks aligned.

| Problem | Fix |
|---------|-----|
| `generated_count` ahead of actual invoices (next generate skips a phase) | `syncInstallmentGeneratedCountToNextUnbilled()` sets count from the lowest empty profile-local slot |
| Student History shows Phase 3 empty but Phase 4 billed (no drop/rejoin) | `resolvePhaseChainByLocalSlot()` remaps chains to sequential slots 1..N for display |
| Advance pay skipped ahead of unbilled phases | `POST .../advance-pay` only allows the **next unbilled** local phase; sets `generated_count = phase_index` |
| Persist wrong `TARGET_PHASE` on existing rows | `node scripts/repairInstallmentPhaseAlignment.js --email ... --apply` |

Used by: `GET /installment-invoices/profiles/:id/phases`, manual/auto invoice generation, advance-pay.

## `installmentPhaseRowMapping.js`

Maps invoice chains to profile-local phase rows for Student History / Installment Plan tables. See `normalizeAdjacentPhaseDisplayDates` for issue-date display ordering.

`isInstallmentPlanSlotAddressed` / `annotateInstallmentPhasePlanSlots` mark a phase as cleared when it is paid, skipped, or has no outstanding balance — used so **Pay Now** / advance-pay unlocks the next phase when prior slots are settled.
