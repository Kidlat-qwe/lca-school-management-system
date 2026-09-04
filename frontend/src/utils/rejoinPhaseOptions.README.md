# rejoinPhaseOptions

Shared helpers for **Rejoin** target-phase dropdowns (Student History Installment + Classes).

## Rule

Rejoin target must be **strictly after** the highest dropped enrollment phase, and also not before the class schedule enrollment floor:

`min = max(scheduleFloor, maxDroppedPhase + 1)`

Example: dropped Phase 2 → options start at Phase 3 (unless the schedule floor is higher).

## Exports

| Export | Purpose |
|--------|---------|
| `getMinRejoinPhaseAfterDrop` | `dropped + 1` |
| `resolveMaxDroppedAbsolutePhaseFromPlan` | From installment phase rows |
| `resolveMaxDroppedAbsolutePhaseFromStudent` | From Classes student row |
| `buildRejoinPhaseOptions` | Dropdown options |
| `getDefaultRejoinPhase` | Default selection (first option / floor) |
| `fetchClassRejoinScheduleContext` | Load phase/session schedule for a class |
