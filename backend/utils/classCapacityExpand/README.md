# Class capacity expand (rejoin overflow)

## Business rule

- **Dropped students always free a seat** — they do not count in the numerator (`enrolled/max`).
- **Rejoin while under max** fills a free seat only — **do not** raise `max_students`.
- **Rejoin when the class is already full** is always allowed (no overflow limit). After enrollment, raise `max_students` to the new active headcount so the UI shows **N/N** (e.g. `12/12`).
- **New enroll / reserve** hard-stop at the stored `max_students`.

## Example walkthrough

| Step | Event | Display |
|------|--------|---------|
| 1 | Max 10, 10 enrolled | **10/10** |
| 2 | 3 students drop | **7/10** (each drop −1 from enrolled) |
| 3 | 1 of those dropped rejoins | **8/10** (seat was free; max unchanged) |
| 4 | 2 new students enroll | **10/10** |
| 5 | Remaining 2 dropped students rejoin | **12/12** (class was full; max expands) |

## API

| Export | Purpose |
|--------|---------|
| `expandClassMaxStudentsToFitActiveCount(client, classId)` | `UPDATE` max only when active distinct students **&gt;** current max |
| `isRejoinEnrollmentSourceLabel(sourceLabel)` | Detect rejoin auto-enroll source strings |

## Call sites

- `enrollStudentForFullPaymentPhases` — after rejoin-labeled enrollment
- Rejoin endpoints no longer reject with “Class is full”

See also: `utils/rejoinDroppedPhaseSettlement/README.md`.
