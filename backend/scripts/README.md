# Backend Scripts

This directory contains utility scripts for managing and maintaining the Physical School Management System backend.

## Available Scripts

### `diagnoseAndFixClassPackageVisibility.js`

Diagnose why packages do not appear in **Classes → Enroll → Select Package**, using the
same filters as `Classes.jsx` / `adminClasses.jsx` (branch, `level_tag`, `package_type`,
per-phase range).

**Default: dry-run** (read-only). Pass `--apply` when you are ready to write safe fixes.

Common finding: **`package_type = Phase`** packages only appear under enrollment option
**“Per Phase”**, not standard **“Package”**.

```bash
# Dry-run — class + new package names
node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-id=176 --package-names "Nursery Plan 3,PreK Plan 3"

# Dry-run — partial class name (lists matches if multiple)
node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-name=VMP_NURSERY --package-names "Nursery Plan 3"

# Apply safe fixes (branch_id, level_tag, status) after reviewing dry-run
node backend/scripts/diagnoseAndFixClassPackageVisibility.js --class-id=176 --package-ids=101,102 --apply --fix=branch,level-tag,status
```

Fix flags (`--fix=`): `branch`, `level-tag`, `status`, or `all`.

### `listPendingPackageMerchFromDate.js`

Read-only dump of Merchandise → **Pending Issue** (same logic as
`GET /merchandise/package-pending`), filtered to Manila dates **on or after**
`--from=` (default **2026-08-21**).

```bash
node backend/scripts/listPendingPackageMerchFromDate.js
node backend/scripts/listPendingPackageMerchFromDate.js --from=2026-08-21
node backend/scripts/listPendingPackageMerchFromDate.js --from=2026-08-21 --branch-id=6
node backend/scripts/listPendingPackageMerchFromDate.js --oos-only
```

### `repairPampangaUniformTypesToRhet.js`

Normalize School Uniform + PE Uniform piece labels to RHET values for one branch.
**Default branch: Malolos.** Override with `--branch-name=Cavite` / `Guiguinto` / `Pampanga` (etc.).

| Category | Updates |
|----------|---------|
| PE Uniform | `Top` → `Shirt`, `Bottom` → `Pants` |
| School Uniform | `Men`/`Women` → `Male`/`Female`; Male Top→`Polo`, Male Bottom→`Short`, Female Top→`Blouse`, Female Bottom→`Skirt` |

Also matches legacy names `LCA PE Uniform`, `LCA Uniform`, `School Uniform_Replacement`.
Default is **dry-run**; you run `--apply` when ready.

```bash
node backend/scripts/repairPampangaUniformTypesToRhet.js
node backend/scripts/repairPampangaUniformTypesToRhet.js --dry-run
node backend/scripts/repairPampangaUniformTypesToRhet.js --apply
node backend/scripts/repairPampangaUniformTypesToRhet.js --dry-run --branch-name=Cavite
node backend/scripts/repairPampangaUniformTypesToRhet.js --apply --branch-name=Pampanga
```

### `createMalolosTogaMerchandise.js`

Creates a **CMS-only** merchandise row **Toga Set** for the **Malolos** branch on the
**development** database (`psms_db`). Not linked to RHET / inventory (`item_name` and
`sku` stay `NULL`).

| Field | Default |
|-------|---------|
| Name | `Toga Set` |
| Quantity | `50` |
| Price | `0` |
| Gender | `Unisex` |
| Size / type / item_name / sku | `null` |

Idempotent: if Malolos already has `Toga Set`, the script exits without inserting.

```bash
node backend/scripts/createMalolosTogaMerchandise.js --development
node backend/scripts/createMalolosTogaMerchandise.js --development --apply
node backend/scripts/createMalolosTogaMerchandise.js --development --apply --quantity=20 --price=1500
```

### `removeGuiguintoUniformReplacementMerch.js`

Removes the **Uniform Replacement** merchandise type card (and all its stock rows) for
**one branch** (default **Guiguinto**; override with `--branch-name=Cavite`, etc.).
Matches CMS names:

- `Uniform Replacement` (UI card label)
- `School Uniform_Replacement`
- `PE Uniform_Replacement`
- any row on that branch whose name contains both `uniform` and `replacement`

Also clears FK blockers (package detail lines, promo links, release logs) and nulls
`merchandiserequestlogtbl.merchandise_id` so request history is kept. Other branches
and other types (e.g. plain `School Uniform`) are untouched.

Default is **dry-run**; pass `--apply` to delete. Optional `--branch-id=` if multiple
matching branches exist.

```bash
node scripts/removeGuiguintoUniformReplacementMerch.js --production
node scripts/removeGuiguintoUniformReplacementMerch.js --production --apply
node scripts/removeGuiguintoUniformReplacementMerch.js --production --branch-name=Cavite
node scripts/removeGuiguintoUniformReplacementMerch.js --production --branch-name=Cavite --apply
node scripts/removeGuiguintoUniformReplacementMerch.js --production --branch-id=5
```

### `removeBranchMerchandiseTypes.js`

Generic remover for one or more merchandise **type cards** on one branch (exact
`merchandise_name` match). Same FK cleanup as the Uniform Replacement script.

Example — Malolos **Recognition Program** + **Toga Set**:

```bash
node scripts/removeBranchMerchandiseTypes.js --production --branch-name=Malolos --names="Recognition Program,Toga Set"
node scripts/removeBranchMerchandiseTypes.js --production --branch-name=Malolos --names="Recognition Program,Toga Set" --apply
```

Required: `--branch-name=` and `--names="A,B"`. Optional: `--branch-id=`. Default dry-run.

### `removeMalolosSpecificUniformStockRows.js`

Deletes **specific stock SKU rows** on Malolos (not whole type cards) matching the
ops screenshots: Female Blouse M/XL/S/XS, Female Skirt M, Male Polo M×2 / S,
Male Short S / M — matched by gender+type+size+qty+price+remarks. Aborts if any
fingerprint is missing or ambiguous.

```bash
node scripts/removeMalolosSpecificUniformStockRows.js --production
node scripts/removeMalolosSpecificUniformStockRows.js --production --apply
```

### `repairBriaToledanoFullPaymentThroughJuly.js`

**Bria Renesmee M. Toledano** (`jennyrosewin@gmail.com`, student **356**, class **68** `VMP_Playgroup_SS_9:30AM`). Full payment INV-**350** auto-enrolled all **10** class phases, so Month Re-enrollment showed **October completed** and August still re-enrolled. Package ends **Phase 7 / July**.

| Step | Detail |
|------|--------|
| Keep | INV-350 Paid; payment **275** date **2025-09-10** / ₱50,000 |
| Remarks | `PHASE_START:1` `PHASE_END:7` |
| Phases 1–7 | 1 **new**, 2–6 **re_enrolled**, 7 **completed** |
| Phases 8–10 | **Delete** CS 336–338 |
| Matrix | Jan new → Feb–Jun re-enrolled → **Jul completed** → **Aug Inactive** |

```bash
node backend/scripts/repairBriaToledanoFullPaymentThroughJuly.js --production
node backend/scripts/repairBriaToledanoFullPaymentThroughJuly.js --production --apply
```

### `repairZeinNapilisanEnrollmentStatuses.js`

**Zein Austin Napilisan** (`napilisanedmar@gmail.com`, student **589**, profile **398**, class **162** `VMP_Pre-Kindergarten_MWF 11AM`). After Phase 1 drop + Phase 2 not enrolled, comeback labels were wrong (Phase 3 `new`, Phase 4–5 both `rejoin` → consecutive rejoins on the month matrix).

| Phase | CS | From | To |
|-------|----|------|----|
| 3 | **1204** | new | **rejoin** |
| 4 | **1715** | rejoin | **re_enrolled** |
| 5 | **2206** | rejoin | **re_enrolled** |

Does not change invoices, payments, or Phase 1 dropped / Phase 2 blank.

```bash
node backend/scripts/repairZeinNapilisanEnrollmentStatuses.js --production
node backend/scripts/repairZeinNapilisanEnrollmentStatuses.js --production --apply
```

### `repairEzraCanetePhase3to5Shift.js`

**Ezra Gabrielle M. Cañete** (`jericacanete01@gmail.com`, student **599**, profile **410**, class **162** `VMP_Pre-Kindergarten_MWF 11AM`). Wrong start at Phase 4–6; shift to Phase 3–5 so Phase 6 is not enrolled yet.

| Invoice | From | To | Issue / Due |
|---------|------|----|-------------|
| INV-1331 | Phase 4 | **Phase 3** new | **May 31 / Jun 5** |
| INV-1884 | Phase 5 | **Phase 4** re_enrolled | **Jun 25 / Jul 5** |
| INV-2421 | Phase 6 | **Phase 5** re_enrolled | **Jul 25 / Aug 5** |

Also: `phase_start` **4 → 3**, queue **next_gen 2026-08-25** / **next_month 2026-09-01** / scheduled **2026-09-05**, downpayment PHASE_START/END **3 / 9**, detach cancelled INV-1330.

```bash
node backend/scripts/repairEzraCanetePhase3to5Shift.js --production
node backend/scripts/repairEzraCanetePhase3to5Shift.js --production --apply
```

### `repairJayllaTenederoPhase678Enrollment.js`

**Jaylla Immaculata Tenedero** (`mikaella@apprenticesync.com`, student **607**, class **57** `NC_Playgroup_TTh_9:30-10:30PM`, profile **424**). Phase 5 was a wrong enrollment. Hide it and keep only Phase 6–8.

| Step | Detail |
|------|--------|
| Payment | Move completed payment(s) INV-**1394** → INV-**1398** (keep payment date) |
| Phase 6 | Clear penalty → **Paid** AR **261060**; CS **1405** → **new** |
| Phase 5 | Cancel + detach INV-**1394**; delete CS **1237** (not displayed) |
| Phase 7–8 | CS **1872** → **re_enrolled**; CS **2247** stays **re_enrolled** |
| Profile | `phase_start` **5 → 6**, `generated_count` **4 → 3**; downpayment PHASE_START/END **6 / 11** |

```bash
node backend/scripts/repairJayllaTenederoPhase678Enrollment.js --production
node backend/scripts/repairJayllaTenederoPhase678Enrollment.js --production --apply
```

### `repairMiguelBoholMoveToSomoJuly11am.js`

**Miguel Sebastian C. Bohol** (`carlosgeline26@gmail.com`, student **78**). UI already moved Phase 1 enrollment to `SOMO_JULY_Pre-Kinder_MWF 11 AM` (**95**), but inactive profile **54** stayed on class **37**, so Student History still showed the old class.

| Step | Detail |
|------|--------|
| Profile | **54** `class_id` 37 → 95 (`is_active` stays false) |
| Retag | invoice remarks `CLASS_ID:37` → `CLASS_ID:95` |
| Phase 2 | INV-1927 issue/due → **2026-07-25 / 2026-08-05** |

```bash
node backend/scripts/repairMiguelBoholMoveToSomoJuly11am.js --production
node backend/scripts/repairMiguelBoholMoveToSomoJuly11am.js --production --apply
```

### `repairMiguelBoholPhase2Dates.js`

**Miguel Sebastian C. Bohol** (`carlosgeline26@gmail.com`, student **78**, profile **54**, class **37**). Student History showed Phase 2 as Jun 28 / Mar 1 because Phase 1 INV-1850 issue was after Phase 2 (display date-swap).

| Invoice | Role | Target |
|---------|------|--------|
| INV-1850 | Phase 1 (Paid advance) | **Feb 25 / Mar 5** (unswap) |
| INV-1927 | Phase 2 (Unpaid) | **Mar 25 / Apr 5** |

Does not change penalty, dropped enrollment, or plan Inactive.

```bash
node backend/scripts/repairMiguelBoholPhase2Dates.js --production
node backend/scripts/repairMiguelBoholPhase2Dates.js --production --apply
```

### `repairShaoKunShiftPhasePayments.js`

**Shao Kun Calingasin Wang** (`calingasinhelen@gmail.com`, student **115**, profile **81**, class **56**). Shift installment payments forward so Phase 2 is unpaid with **Pay Now** (no penalty).

| Payment | From | To |
|---------|------|----|
| PAY-283 | Phase 2 INV-257 | Phase 3 INV-611 |
| PAY-654 | Phase 3 INV-611 | Phase 4 INV-1091 |
| PAY-1062 | Phase 4 INV-1091 | Phase 5 INV-1507 |
| PAY-1507 | Phase 5 INV-1507 | Phase 6 INV-1805 |

Phase 2 enrollment deleted (shows **—**). Phase 6 undropped to **re_enrolled**. After Phase 2 is paid, Pay Now moves to Phase 7.

```bash
node backend/scripts/repairShaoKunShiftPhasePayments.js --production
node backend/scripts/repairShaoKunShiftPhasePayments.js --production --apply
```

### `repairMariannaRomeroPhase6BlankEnrollmentInactive.js`

Follow-up for **Marianna Agatha Romero** after the date repair. Phase 6 INV-1953 is unpaid, so enrollment must be **—** (not re enrolled / not dropped). Plan status **Inactive**.

| Step | Detail |
|------|--------|
| Delete | classstudent **2099** (phase 6) |
| Deactivate | profile **400** `is_active = false` |
| Keep | Phase 4 **new**, Phase 5 **re_enrolled** (paid) |

```bash
node backend/scripts/repairMariannaRomeroPhase6BlankEnrollmentInactive.js --production
node backend/scripts/repairMariannaRomeroPhase6BlankEnrollmentInactive.js --production --apply
```

### `repairLucretiusManuelPhase5DueUngenerate6.js`

**Lucretius Theodore B Manuel** (`krisstinamanuel729@gmail.com`). Phase 5 advance partial due **Nov 5 → Aug 5**; cancel early Phase 6 INV-2261; blank Phase 5 enrollment until Paid; queue **Aug 25 / Sep 1** so Month Re-enrollment / Total Active / Student Status show August **Inactive** (not Active via premature re-enrolled).

```bash
node backend/scripts/repairLucretiusManuelPhase5DueUngenerate6.js --production
node backend/scripts/repairLucretiusManuelPhase5DueUngenerate6.js --production --apply
```

### `repairFalsePackageMerchReleaseNullQty.js`

Remove **false** `merchandise_release_logtbl` rows from package first payment when stock
quantity was **null/0** but a release was still logged (Workbooks at 0 stock showing
qty **1** in Merchandise Logs). After delete, the item returns to **Pending issue**.

```bash
node backend/scripts/repairFalsePackageMerchReleaseNullQty.js --payment-id=516 --merchandise-name=Workbooks
node backend/scripts/repairFalsePackageMerchReleaseNullQty.js --payment-id=516 --merchandise-name=Workbooks --apply
```

### `repairPsalmDavidAwoyemiInstallmentDescription.js`

**Psalm-David E. Awoyemi** (`lindauwagbale@yahoo.com`, user **610**, profile **427**, Cavite).
Acknowledgement receipt **No. 261955** (INV-2290) PDF DESCRIPTION showed
`Installment plan for Psalm Daniel Awoyemi - Nursery` while the student header was correct.
Replaces **Psalm Daniel Awoyemi** → **Psalm-David E. Awoyemi** on:

- installment profile description (future phases)
- related `invoiceitemstbl.description` (AR/PDF line text)
- related `invoicestbl` description / remarks copies

Default is dry-run; pass `--apply` to write.

```bash
node backend/scripts/repairPsalmDavidAwoyemiInstallmentDescription.js
node backend/scripts/repairPsalmDavidAwoyemiInstallmentDescription.js --apply
```

### `repairLucretiusManuelPhase5Balance4606.js`

**Lucretius Theodore B Manuel** (`krisstinamanuel729@gmail.com`). Phase 5 balance leaf **INV-1960** had Late Payment Penalty **₱460.60**, so Student History showed balance **₱5,066.60**. Zeros that penalty only; remaining balance becomes **₱4,606** (₱4,803 − ₱197 paid on INV-1959).

```bash
node backend/scripts/repairLucretiusManuelPhase5Balance4606.js --production
node backend/scripts/repairLucretiusManuelPhase5Balance4606.js --production --apply
```

### `repairMatteoAbenionPhase2Balance8901.js`

**Matteo Arvian Abenion** (`macandao23@gmail.com`). Phase 2 **INV-2084** (₱9,890, partial ₱989) → **INV-2439**. Balance leaf had correct remaining **₱8,901** plus **stacked Late Payment Penalty (10%)** lines that inflated amount to **₱26,384.60** / balance **₱25,395.60**. Rebuilds INV-2439 to a single **₱8,901** remaining line (no penalties).

```bash
node backend/scripts/repairMatteoAbenionPhase2Balance8901.js --production
node backend/scripts/repairMatteoAbenionPhase2Balance8901.js --production --apply
```

### `repairVitoFernandoPhaseDatesDrop6.js`

**Vito Javier Fernando** (`kret_26@yahoo.com`, student **527**, profile **310**, class **67** `VMP_Playgroup_TTh_11:00AM`). Phase 5 class start is **May 26**; invoices were billed a month late so August showed **Active / re-enrolled**. Realign issue/due (keep payment dates), drop Phase 6, stop further generation.

| Phase | Invoice | Issue / Due | Enrollment |
|-------|---------|-------------|------------|
| 2 | INV-771 Paid | **Apr 9 / Mar 3** | **new** |
| 3 | INV-1000 Paid | **Mar 25 / Apr 5** | **re_enrolled** |
| 4 | INV-1293 Paid | **Apr 25 / May 5** | **re_enrolled** |
| 5 | INV-1762 Paid | **May 25 / Jun 5** | **re_enrolled** |
| 6 | INV-2314 Unpaid | unchanged | **dropped** |
| 7 | INV-2339 Unpaid | — | **Cancel + detach** |

Profile `is_active = false`; queue `next_generation_date` cleared. Matrix target: Mar new → Apr–Jun re-enrolled → Jul dropped → **Aug Inactive**.

```bash
node backend/scripts/repairVitoFernandoPhaseDatesDrop6.js --production
node backend/scripts/repairVitoFernandoPhaseDatesDrop6.js --production --apply
```

### `repairMariannaRomeroPhase456DatesUngenerate7.js`

**Marianna Agatha Romero** (`amgromero1987@gmail.com`, student **560**, profile **400**, class **55**). Shift Phase 4–6 installment dates and un-generate Phase 7.

| Phase | Invoice | Current | Target |
|-------|---------|---------|--------|
| 4 | INV-1354 Paid | Apr 25 / May 5 | **May 25 / Jun 5** |
| 5 | INV-1948 Paid | May 25 / Jun 5 | **Jun 25 / Jul 5** |
| 6 | INV-1953 Unpaid | Jun 25 / Jul 5 | **Jul 25 / Aug 5** |
| 7 | INV-2153 | Generated overdue | **Cancel + detach** (Not Generated) |

Queue → `generated_count` **3**, next gen **2026-08-25**, next month **2026-09-01**. Restores Phase 6 enrollment **dropped → re_enrolled** (due Aug 5 is not 30 days unpaid) and reactivates profile **400**.

```bash
node backend/scripts/repairMariannaRomeroPhase456DatesUngenerate7.js --production
node backend/scripts/repairMariannaRomeroPhase456DatesUngenerate7.js --production --apply
```

### `repairMariannaRomeroMoveToNcNurseryTths.js`

**Marianna Agatha Romero** (`amgromero1987@gmail.com`, student **560**) — move from `NC_Nursery_MWF_11:00-12:00PM` (**56**) → `NC_NURSERY_TThS_11:00-12:00PM` (**55**). UI Move Student would leave inactive profile **400** on class 56.

| Step | Detail |
|------|--------|
| Move enrollments | classstudent **1208** (phase 4 new), **1753** (phase 5 re_enrolled), **2099** (phase 6 dropped) → class **55** |
| Move profile | profile **400** `class_id` 56 → 55 (`is_active` stays false) |
| Retag invoices | remarks `CLASS_ID:56` → `CLASS_ID:55` |

Does not reactivate the profile or change unpaid phase 6/7 invoices.

```bash
node backend/scripts/repairMariannaRomeroMoveToNcNurseryTths.js --production
node backend/scripts/repairMariannaRomeroMoveToNcNurseryTths.js --production --apply
```

### `repairOliviaSalesDeactivatePlan1.js`

Sets Olivia Brie Sales **Plan 1** (profile 128 / 9:30AM Nursery) `is_active = false`
after unpaid drops (last paid May). Production DB.

```bash
node backend/scripts/repairOliviaSalesDeactivatePlan1.js --production
node backend/scripts/repairOliviaSalesDeactivatePlan1.js --production --apply
```

### `repairOliviaSalesGeneratePlan2Phase6.js`

Generates Olivia Brie Sales **Plan 2 Phase 6** (INV issue 2026-07-25 / due 2026-08-05)
and sets installment queue to next_generation_date **2026-08-25**, next_invoice_month
**2026-09-01** (`generated_count` → 4). Production DB.

```bash
node backend/scripts/repairOliviaSalesGeneratePlan2Phase6.js --production
node backend/scripts/repairOliviaSalesGeneratePlan2Phase6.js --production --apply
```

### `repairOliviaSalesMovePhase9PaymentToPlan2Phase5.js`

Moves mistaken PAY-1498 (AR 261470) from **Plan 1 Phase 9 INV-1804** to
**Plan 2 Phase 5 INV-1744** for Olivia Brie Sales; drops Plan 1 Phase 9 enrollment;
waives late penalty on INV-1744 so ₱5,146 settles Paid. **Production DB only.**

```bash
node backend/scripts/repairOliviaSalesMovePhase9PaymentToPlan2Phase5.js --production
node backend/scripts/repairOliviaSalesMovePhase9PaymentToPlan2Phase5.js --production --apply
```

### `migrateMerchandiseLabelsToRhet.js`

Rewrites `merchandisestbl` category / gender / size / piece-type labels to RHET-canonical values
(`School Uniform`, `Shirt`, `Learning Kit`, `Moving Up Kit`, `Male`/`Female`, `XS`/`S`/`M`/…,
PE Uniform `Top`→`Shirt`, `Bottom`→`Pants`;
School Uniform Male `Top`→`Polo`, `Bottom`→`Short`, Female `Top`→`Blouse`, `Bottom`→`Skirt`).
Optional `--branch-id=N` for pilot branch (e.g. Malolos = 1).
Use `removeInvalidLcaShirtStockRows.js` to delete legacy `type=Shirt` rows on LCA Shirt (RHET uses ACC/Beeli/LCA/Logo).
Run migration **129** first.

```bash
node scripts/migrateMerchandiseLabelsToRhet.js --dry-run
node scripts/migrateMerchandiseLabelsToRhet.js --dry-run --branch-id=1
node scripts/migrateMerchandiseLabelsToRhet.js --apply --branch-id=1
```

### `removeInvalidLcaShirtStockRows.js`

Deletes branch stock rows for **Shirt / LCA_SHIRT** where `type = 'Shirt'`
(CMS-only label — RHET uses `ACC`, `Beeli`, `LCA`, `Logo 1`, `Logo 2`).
Clears blocking package/promo/release FKs first; request log rows are kept (`merchandise_id` → NULL).

```bash
node scripts/removeInvalidLcaShirtStockRows.js --dry-run --branch-id=1
node scripts/removeInvalidLcaShirtStockRows.js --apply --branch-id=1
```

### `seedLearningKitCatalogFromRhet.js`

Inserts **qty 0** CMS stock rows for every **Learning Kit** variant from RHET
`GET /catalog` (same itemName/sku as [RHET Inventory admin](https://inventory.lca-app.com/admin/dashboard)).
Read-only toward RHET — only writes `merchandisestbl`. Skips rows that already
match `branch_id + Learning Kit + item_name + sku`.

```bash
node scripts/seedLearningKitCatalogFromRhet.js --dry-run --branch-id=1
node scripts/seedLearningKitCatalogFromRhet.js --apply --branch-id=1
node scripts/seedLearningKitCatalogFromRhet.js --dry-run --all-branches
node scripts/seedLearningKitCatalogFromRhet.js --apply --all-branches
```

Requires `INVENTORY_API_URL` and `INVENTORY_INTEGRATION_KEY` in backend `.env`.

### `seedBackpackStockFromRhet.js`

Adds CMS **LCA Bag / Backpack** stock for a branch (bypasses Merchandise UI + Request Stock).

**Default (legacy):** bumps qty on the blank type shell only — **does not** set `item_name` or `sku`
(Pampanga / legacy merchandise page). No RHET call.

**Optional `--from-rhet`:** backfill RHET `itemName` + `sku` from `/catalog`.

```bash
node scripts/seedBackpackStockFromRhet.js --dry-run --branch-id=6 --qty=50
node scripts/seedBackpackStockFromRhet.js --apply --branch-id=6 --qty=50
node scripts/seedBackpackStockFromRhet.js --dry-run --branch-name=Pampanga --qty=50
```

### `seedLearningKitStockLegacy.js`

Adds CMS **Learning Kit** stock for a branch (bypasses Merchandise UI + Request Stock).

**Legacy blank shell:** bumps qty on the existing type row only — **does not** set `item_name` or `sku`.
Matches `Learning Kit`, `LCA Learning Kits`, and `LCA Learning Kit`. No RHET call.

```bash
node scripts/seedLearningKitStockLegacy.js --dry-run --branch-id=5 --qty=50
node scripts/seedLearningKitStockLegacy.js --apply --branch-id=5 --qty=50
node scripts/seedLearningKitStockLegacy.js --dry-run --branch-name=Guiguinto --qty=50
```

Malolos reset (remove RHET catalog rows, dedupe blank shells, set qty 50):

```bash
node scripts/seedLearningKitStockLegacy.js --dry-run --branch-id=1 --remove-rhet-seeds --dedupe-blank-shells --set-qty=50
node scripts/seedLearningKitStockLegacy.js --apply --branch-id=1 --remove-rhet-seeds --dedupe-blank-shells --set-qty=50
```

### `repairLcaShirtLegacyType.js`

Sets **Shirt** category stock rows to legacy piece type **`Shirt`** (instead of RHET logo labels ACC / Beeli / LCA / Logo 1 / Logo 2).

```bash
node scripts/repairLcaShirtLegacyType.js --dry-run --branch-id=1
node scripts/repairLcaShirtLegacyType.js --apply --branch-id=1
```

### `clearAllMerchandise.js`

**Destructive.** Deletes all (or one branch’s) `merchandisestbl` catalog/stock rows.
Also deletes blocking `promomerchandisetbl` links and `merchandise_release_logtbl`
rows. Keeps merchandise request history (`merchandise_id` set NULL by FK).
Default is dry-run; require `--apply` to write.

```bash
node scripts/clearAllMerchandise.js --dry-run
node scripts/clearAllMerchandise.js --apply
node scripts/clearAllMerchandise.js --dry-run --branch-id=3
node scripts/clearAllMerchandise.js --apply --branch-id=3
```

### `mergeMistakenMerchandiseTypes.js`

Merges mistaken types created from RHET `itemName` (e.g. `lca-backpack`) into the
real CMS category type (`Backpack`). Moves qty, repoints FKs, deletes the mistaken row.
Default dry-run.

```bash
node scripts/mergeMistakenMerchandiseTypes.js --dry-run
node scripts/mergeMistakenMerchandiseTypes.js --apply
```

### `repairInventoryFulfillment.js`

Repairs a CMS merchandise request that RHET already marked **FULFILLED** but CMS left
**Pending** (e.g. webhook 500 `column "updated_at" does not exist` — PSMS-33).
Run migration **130** first when possible. Idempotent stock apply via
`applyMerchandiseRequestStock`.

```bash
node scripts/repairInventoryFulfillment.js --production --request-id=33
node scripts/repairInventoryFulfillment.js --production --request-id=33 --inventory-request-id=<uuid>
```

Prefer `POST /api/v1/merchandise-requests/:id/sync-inventory` when the API is up.

### `repairBlankNonUniformStockRows.js`

Splits blank non-uniform aggregator rows (`item_name`/`sku` null, piled qty)
for **any** type (Workbooks, Backpack, Book, Accessory, …) using Approved
request history. Creates identified stock rows, then zeros the blank
aggregator. Dry-run by default. Default `--type=all` repairs every blank
non-uniform type on the branch.

```bash
node scripts/repairBlankNonUniformStockRows.js --branch-id=12 --type=all
node scripts/repairBlankNonUniformStockRows.js --branch-id=12 --type=Backpack
node scripts/repairBlankNonUniformStockRows.js --branch-id=12 --type=Workbooks --apply
node scripts/repairBlankNonUniformStockRows.js --branch-id=12 --type=all --apply
```

Requires migration **133** (`item_name` / `sku` columns).

### `auditClassActivePhase.js`

**Read-only** audit of Class Details **Current / auto-opened phase**. Compares the old buggy UI rule (often stuck on Phase 2 after Phase 1 ends) vs the fixed date-based rule. Does not update the database.

Flag **`WOULD_OPEN_WRONG_PHASE`** means schedule **data is fine**, but the **old UI logic** would open the wrong Current phase. It is not a data-quality error.

```bash
node scripts/auditClassActivePhase.js
node scripts/auditClassActivePhase.js --mismatches-only
node scripts/auditClassActivePhase.js --branch-id=3 --today=2026-07-20
node scripts/auditClassActivePhase.js --class-id=123 --json
```

Exit code `0` = old UI and correct rule agree; `2` = at least one class where old UI would open wrong phase; `1` = script error.

### `findStudentsWithDueDateAndPenalty.js`

Lists **students** whose invoice **due_date** falls on a target calendar day/month and who already have a **late penalty** (`late_penalty_applied_for_due_date` and/or `invoiceitemstbl.penalty_amount > 0`).

Default filter: **June 5, 2026** (common installment due day). Open invoices only (`Unpaid` / `Overdue` / etc. — excludes `Paid` and `Cancelled` unless `--include-settled`).

```bash
node scripts/findStudentsWithDueDateAndPenalty.js
node scripts/findStudentsWithDueDateAndPenalty.js --year=2026 --month=6 --day=5
node scripts/findStudentsWithDueDateAndPenalty.js --year=2026 --month=6 --day=
node scripts/findStudentsWithDueDateAndPenalty.js --include-settled
```

### `checkSystemTimezone.js`

Audits **Node.js** and **PostgreSQL** timezone settings against the business standard **Asia/Manila (UTC+8)**. Reports whether `CURRENT_DATE`, local Node dates, and `node-pg` DATE reads match Manila calendar dates (relevant to installment penalty / grace logic).

```bash
node scripts/checkSystemTimezone.js
node scripts/checkSystemTimezone.js --sample-due=2026-06-05
node scripts/checkSystemTimezone.js --json
```

Exit code `0` = all checks passed; `1` = at least one mismatch (see recommendations in output).

### `revokeAdminPaymentLogApprovals.js`

Revokes **Admin approvals on paymenttbl** only (global — **no year/month filter**):

- **paymenttbl**: Cash/bank/etc. rows `Approved` by Admin → `Pending` (e.g. PAY-736, PAY-611)
- **acknowledgement_receiptstbl**: **not modified** — AR stays Verified/Applied. Admin-verified unapplied AR rows show **Pending Approval** on Payment Logs via `backend/lib/paymentLogArApproval.js` (finance-unified API).

```bash
node scripts/revokeAdminPaymentLogApprovals.js --dry-run
node scripts/revokeAdminPaymentLogApprovals.js --apply
```

**Options:** `--dry-run` (explicit preview), `--apply` (write paymenttbl only), `--help`

### `revokeAdminArVerificationPaymentLogs.js`

**Deprecated.** Previously reverted AR to Submitted — do **not** use. Payment Logs Pending for Admin AR is handled by the API; use `revokeAdminPaymentLogApprovals.js` for cash/bank payment rows only.

```bash
node scripts/revokeAdminArVerificationPaymentLogs.js --dry-run   # preview only; --apply is blocked
```

### `restoreAdminArVerificationPaymentLogs.js`

Re-applies the **5 production AR rows** reverted by `revokeAdminArVerificationPaymentLogs.js --apply` (status, verifier, verified_at; linked payments for Applied rows).

```bash
node scripts/restoreAdminArVerificationPaymentLogs.js --dry-run
node scripts/restoreAdminArVerificationPaymentLogs.js --apply
```

### `checkPaymentLogStatusApprovedByAdmin.js`

Audits **Payment Logs status columns** and lists **Admin** approvers from both sources:
- `paymenttbl.approved_by` (regular payments)
- `acknowledgement_receiptstbl.verified_by_user_id` (unapplied AR rows shown as Acknowledgement Receipt in Payment Logs)

**Usage:**
```bash
node scripts/checkPaymentLogStatusApprovedByAdmin.js
node scripts/checkPaymentLogStatusApprovedByAdmin.js --detail
node scripts/checkPaymentLogStatusApprovedByAdmin.js --admin-only --detail
node scripts/checkPaymentLogStatusApprovedByAdmin.js --branch-id=1 --from=2026-01-01 --to=2026-06-30
```

**Options:** `--admin-only`, `--detail`, `--branch-id`, `--from`, `--to` (issue_date, Manila), `--limit`, `--help`

### `listPaymentLogApprovers.js`

Lists **who approved payments** in Payment Logs (`paymenttbl.approved_by` when `approval_status = 'Approved'`).

**Usage:**
```bash
# Summary: distinct approvers grouped by user_type and user
node scripts/listPaymentLogApprovers.js

# Include sample of each approved payment
node scripts/listPaymentLogApprovers.js --detail

# Filters
node scripts/listPaymentLogApprovers.js --branch-id=1
node scripts/listPaymentLogApprovers.js --from=2026-01-01 --to=2026-05-31
node scripts/listPaymentLogApprovers.js --user-type=Admin
node scripts/listPaymentLogApprovers.js --detail --limit=500
```

**Options:** `--detail`, `--branch-id`, `--from`, `--to` (approved_at, Manila date), `--user-type`, `--limit`, `--help`

Without `--branch-id`, output includes **all branches** from `branchestbl` with approval counts per payment branch (0 if none).

**Revert Admin approvals** (sets `approval_status` back to `Pending`, clears `approved_by`, `approved_at`, `finance_verified_reference_number` — same as revoke in the approve API):

```bash
# Preview only
node scripts/listPaymentLogApprovers.js --revert-admin-approvals

# Execute
node scripts/listPaymentLogApprovers.js --revert-admin-approvals --apply

# Scoped
node scripts/listPaymentLogApprovers.js --revert-admin-approvals --branch-id=1 --from=2026-01-01 --apply
```

### `deleteTodayAcknowledgementReceipts.js`

Deletes acknowledgement receipts for a target date (default: today in Manila timezone).

**Usage:**
```bash
# Dry run for today (Asia/Manila)
node scripts/deleteTodayAcknowledgementReceipts.js

# Execute deletion for today
node scripts/deleteTodayAcknowledgementReceipts.js --apply

# Execute deletion for a specific date
node scripts/deleteTodayAcknowledgementReceipts.js --date=2026-04-25 --apply

# Include applied/linked rows (invoice_id/payment_id/status=Applied)
node scripts/deleteTodayAcknowledgementReceipts.js --include-applied --apply
```

**Options:**
- `--date=YYYY-MM-DD`: Override target date. Default is today in `Asia/Manila`.
- `--include-applied`: Include rows already linked/applied.
- `--apply`: Actually delete rows. Without this, script is dry-run only.
- `--help, -h`: Show usage help.

### `listFirebaseUsers.js`

Lists all users registered in Firebase Authentication.

**Usage:**
```bash
# List all users (default: table format, max 1000 users)
node scripts/listFirebaseUsers.js

# List with custom limit
node scripts/listFirebaseUsers.js --limit 500

# Output in JSON format
node scripts/listFirebaseUsers.js --format json

# Filter by email (partial match, case-insensitive)
node scripts/listFirebaseUsers.js --email "@gmail.com"

# Get specific user by UID
node scripts/listFirebaseUsers.js --uid "abc123xyz"

# Show help
node scripts/listFirebaseUsers.js --help
```

**Options:**
- `--limit <number>`: Maximum number of users to retrieve (default: 1000)
- `--format <json|table>`: Output format (default: table)
- `--email <email>`: Filter by email (partial match, case-insensitive)
- `--uid <uid>`: Get specific user by UID
- `--help, -h`: Show help message

**Output Information:**
- User UID
- Email address
- Email verification status
- Display name
- Phone number
- Account status (disabled/enabled)
- Creation timestamp
- Last sign-in timestamp
- Authentication providers
- Custom claims (if any)

**Notes:**
- The script uses Firebase Admin SDK, so it requires proper Firebase Admin credentials to be configured
- Firebase Admin SDK has a limit of 1000 users per page, so pagination is handled automatically
- The script respects the `--limit` option but may retrieve more users if pagination is needed

### `diagnoseStudentInstallment.js`

Read-only diagnostic for one student: installment profiles, **`installmentinvoicestbl`** schedule rows (what the Finance Installment Invoice page lists), and linked **`invoicestbl`** rows. Uses `backend/.env` database settings (production if that file points to prod).

**Usage:**
```bash
cd backend

node scripts/diagnoseStudentInstallment.js --user-id 12345
node scripts/diagnoseStudentInstallment.js --email student@school.com
node scripts/diagnoseStudentInstallment.js --name "Penelope"
node scripts/diagnoseStudentInstallment.js --name Cudia --json

node scripts/diagnoseStudentInstallment.js --help
```

**Options:**
- `--user-id`: `userstbl.user_id`
- `--email`: Exact email match (trimmed, case-insensitive)
- `--name`: Partial match on `full_name`; if multiple students match, script lists them and exits without querying profiles (narrow the name or use `--user-id`).
- `--json`: Print a single JSON object instead of tables.

### `repairMatrixReviewStudents.js`

Targeted fix for manual unenroll + paid phases (Herby/Donna pattern) and **phase_start** installment packages (Andrei/Maven pattern).

```bash
cd backend
node scripts/repairMatrixReviewStudents.js --dry-run
node scripts/repairMatrixReviewStudents.js
```

### `findMultipleDroppedNoRejoinInstallmentStudents.js`

Lists installment student+class tracks with **multiple dropped** enrollment phases and **no continue** afterward (no `rejoin`, and no later active `new` / `re_enrolled` / `upsell` / `rejoin` after the latest drop). Useful to find Maverick-like plans that kept generating after unpaid drops and never rejoined.

```bash
node scripts/findMultipleDroppedNoRejoinInstallmentStudents.js
node scripts/findMultipleDroppedNoRejoinInstallmentStudents.js --min-drops=2
node scripts/findMultipleDroppedNoRejoinInstallmentStudents.js --branch-id=5
node scripts/findMultipleDroppedNoRejoinInstallmentStudents.js --csv
node scripts/findMultipleDroppedNoRejoinInstallmentStudents.js --json
node scripts/findMultipleDroppedNoRejoinInstallmentStudents.js --include-continued
```

### `findDelinquencyDropMismatchStudents.js`

Lists students with **`dropped`** rows from installment delinquency who still have **paid** or **partially paid** installment invoices (Skyler-like class-wide drop).

```bash
cd backend
node scripts/findDelinquencyDropMismatchStudents.js
```

### `reinstateSkylerLikeDelinquencyDrops.js`

Bulk reinstate only **eligible** delinquency-dropped phases (paid invoice, partial with payment, or later phase paid). Skips phases with no billing evidence (e.g. phase 9 dropped with only phase 1 paid).

```bash
cd backend
node scripts/reinstateSkylerLikeDelinquencyDrops.js --dry-run
node scripts/reinstateSkylerLikeDelinquencyDrops.js
node scripts/reinstateSkylerLikeDelinquencyDrops.js --student-id=118
```

### `reinstateStudentAfterDelinquencyDrop.js`

Restores **`classstudentstbl`** rows that were set to **`dropped`** by the installment delinquency job when the student should stay enrolled (e.g. other phases paid, partial payment on the overdue invoice). Clears **`removed_at`** / **`removed_reason`**; phase 1 → **`new`**, later phases → **`re_enrolled`**. **`student_statustbl`** updates via the existing trigger.

**Usage:**
```bash
cd backend
node scripts/reinstateStudentAfterDelinquencyDrop.js --email=student@school.com
node scripts/reinstateStudentAfterDelinquencyDrop.js --student-id=21
node scripts/reinstateStudentAfterDelinquencyDrop.js --email=... --dry-run
```

### `repairPhaseInstallmentIssueDateMonotonic.js`

Backfills **`invoicestbl.issue_date`** for phase installment invoices (rows whose **`remarks`** contain `TARGET_PHASE:N`) so that, within each **`installmentinvoiceprofiles_id`**, dates never go backwards when phases are sorted by **N** ascending. Use after fixing the AR enrollment code path, or to clean historical rows (e.g. Phase 2 dated before Phase 1).

**Usage:**
```bash
cd backend

# Preview only (default — no writes)
node scripts/repairPhaseInstallmentIssueDateMonotonic.js
npm run repair:phase-installment-issue-dates

# Only one invoice (loads its profile for phase order; applies at most that row)
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863
npm run repair:phase-invoice-863

# Apply updates
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --apply
npm run repair:phase-installment-issue-dates -- --apply
npm run repair:phase-invoice-863 -- --apply
# Invoice 863 conflict (issue floor after due): preview then apply with extended due
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --extend-due-when-needed
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --extend-due-when-needed --apply
# Phase 2 next billing cycle (issue 25th, due 5th of following month)
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --issue-date=2026-06-25 --due-date=2026-07-05
node scripts/repairPhaseInstallmentIssueDateMonotonic.js --invoice-id=863 --issue-date=2026-06-25 --due-date=2026-07-05 --apply
```

**Options:**
- `--apply`: Run `UPDATE invoicestbl`. Without it, the script only prints planned changes.
- `--invoice-id=N`: Restrict to invoice `N` only (full profile still scanned for monotonic rule).
- `--extend-due-when-needed`: **Only with `--invoice-id`.** If the issue fix would be after `due_date`, also set `due_date` to the same day as the new `issue_date` (minimal change). Often **not** the same as the real “25th / 5th next month” cycle; prefer `--issue-date` / `--due-date` when you need the next cycle.
- `--issue-date=YYYY-MM-DD` and `--due-date=YYYY-MM-DD`: **Together with `--invoice-id`**, set both fields on that row (e.g. Phase 2 = `2026-06-25` / `2026-07-05`). Incompatible with `--extend-due-when-needed`.
- `--help`, `-h`: Usage text.

Rows where the required floor would be **after** `due_date` are skipped and logged as a conflict.

### `listMissedInstallmentInvoicesForMonth.js`

List students whose installment plan should have generated a **phase invoice** in a calendar month (e.g. June 2026 / 25th cycle) but did not. Writes a CSV by default when there are misses.

```bash
node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06
node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06 --csv
node backend/scripts/listMissedInstallmentInvoicesForMonth.js --month 2026-06 --json
```

### `listLateStartInstallmentBillingMismatch.js`

Find **Kirsten-like** late-start installment drift: enrollment or first invoice begins after phase 1, `getCurrentInstallmentPhaseNumber` lags the next absolute `TARGET_PHASE`, the next phase invoice was never created, and the scheduler is stuck on a past cycle and/or the queue jumped ahead without generating.

These students are **not** included in `listMissedInstallmentInvoicesForMonth.js` (canonical schedule still points at the last paid month).

```bash
node backend/scripts/listLateStartInstallmentBillingMismatch.js
node backend/scripts/listLateStartInstallmentBillingMismatch.js --csv
node backend/scripts/listLateStartInstallmentBillingMismatch.js --json
```

### `diagnoseMissedInstallmentGeneration.js`

List class-linked installment profiles that **should** have auto-generated on a target date (25th cycle) but did not. Outputs summary, reason breakdown, and optional CSV.

```bash
node backend/scripts/diagnoseMissedInstallmentGeneration.js --date 2026-06-25
node backend/scripts/diagnoseMissedInstallmentGeneration.js --date 2026-06-25 --csv missed-2026-06-25.csv
node backend/scripts/diagnoseMissedInstallmentGeneration.js --date 2026-06-25 --json
```

Typical miss reason: `next_generation_date_in_future` — queue row is one month ahead. Fix with `repairInstallmentGenerationSchedule.js --apply`, then run the daily generator (`processDueInstallmentInvoices`).

### `repairInstallmentGenerationSchedule.js`

Batch scan/repair for **all class-linked installment plans** whose auto-generation queue (`installmentinvoicestbl`) has the wrong **25th / 5th-next-month** cycle or is stuck with `status = 'Generated'` while more phases remain.

Uses `buildPhaseInstallmentSchedule` (same rules as live billing) to compute the correct `next_generation_date` and `next_invoice_month`, then resets `status` to `NULL` so the scheduler can run again.

**Usage:**

```bash
# From repo root — preview ALL active students (safe, no writes)
node backend/scripts/repairInstallmentGenerationSchedule.js --dry-run

# Apply fixes for ALL active class-linked students
node backend/scripts/repairInstallmentGenerationSchedule.js --apply

# Single profile (e.g. Matthew Sabino)
node backend/scripts/repairInstallmentGenerationSchedule.js 154 --dry-run
node backend/scripts/repairInstallmentGenerationSchedule.js 154 --apply

# npm shortcuts (from backend/)
npm run repair:installment-generation-schedule
npm run repair:installment-generation-schedule:apply
```

**Options:**
- `--dry-run` (default): List mismatches only.
- `--apply`: Commit queue fixes.
- `--include-inactive`: Also scan inactive profiles that still have a queue row.
- `--verbose`: Log profiles that are already correct.
- `<profileId>`: Limit to one `installmentinvoiceprofiles_id`.

Does **not** change existing invoice amounts, payments, or `generated_count` — only the **next auto-generation** queue row.

### `repairAadamCawiliInstallmentGenerationQueue.js`

Pilot repair for **one student** before bulk `repairInstallmentGenerationSchedule.js --apply`. Targets **Aadam June Cawili** (profile `142`, `may778848@gmail.com`) — June 25, 2026 missed generation (`next_generation_date` was `2026-07-25` instead of `2026-06-25`).

```bash
# Preview queue fix (no writes)
node backend/scripts/repairAadamCawiliInstallmentGenerationQueue.js

# Apply queue fix only
node backend/scripts/repairAadamCawiliInstallmentGenerationQueue.js --apply

# Apply queue fix + generate missed phase 5 invoice (issue Jun 25, due Jul 5)
node backend/scripts/repairAadamCawiliInstallmentGenerationQueue.js --apply --generate
```

After a successful pilot, run bulk repair for the remaining profiles:

### `repairMissedInstallmentGenerationJune2026.js`

Bulk repair for **all students** who missed the June 25, 2026 installment run. Finds eligible profiles with no phase invoice in `2026-06`, fixes queue dates, and optionally generates missed invoices.

**Installment Invoice Logs alignment:** Writes the same fields shown on the logs page — `next_generation_date` (Next Generation) and `next_invoice_month` (Next Month). Before generate: e.g. `2026-06-25` / `2026-07-01`. After generate: e.g. `2026-07-25` / `2026-08-01`. Post-generate sync verifies the queue matches `buildPhaseInstallmentSchedule` (guards against generator off-by-one-month bugs).

```bash
# Preview all missed students (no writes)
node backend/scripts/repairMissedInstallmentGenerationJune2026.js

# Fix queue dates only
node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply

# Fix queue + generate missed phase invoices
node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate

# Skip pilot student already repaired (e.g. Aadam profile 142)
node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate --skip-profile-ids 142

# Test first N profiles
node backend/scripts/repairMissedInstallmentGenerationJune2026.js --apply --generate --limit 5
```

Options: `--apply`, `--generate` (requires `--apply`), `--limit N`, `--skip-profile-ids 1,2`, `--csv path`.

Dry-run table includes `after_generate_gen` / `after_generate_month` (what the logs page should show after `--generate`). Results CSV includes `final_next_generation_date`, `final_next_invoice_month`, and `queue_synced_after_generate`.

Writes a results CSV after `--apply`. Each profile is committed in its own transaction so one failure does not roll back others.

### `repairInstallmentQueueExplicitNextDates.js`

Sets **`installmentinvoicestbl.next_generation_date`** and **`next_invoice_month`** for a single open queue row. The Generate Invoice modal and the **Next generation** / **Next month** list columns use these values (with the frontend deriving issue/due/month from the generation anchor).

**Example (July / August anchor — confirm `profile_id` from your DB, e.g. via `diagnoseStudentInstallment.js`):**

```bash
cd backend
node scripts/repairInstallmentQueueExplicitNextDates.js \
  --profile-id=323 \
  --next-generation-date=2026-07-25 \
  --next-invoice-month=2026-08-01
node scripts/repairInstallmentQueueExplicitNextDates.js \
  --profile-id=323 \
  --next-generation-date=2026-07-25 \
  --next-invoice-month=2026-08-01 \
  --apply
```

**Resolve by name + class instead of profile id:**

```bash
node scripts/repairInstallmentQueueExplicitNextDates.js \
  --student-name="Princess Morianne" \
  --class-name="VMM_Nursery" \
  --next-generation-date=2026-07-25 \
  --next-invoice-month=2026-08-01 \
  --apply
```

**Options:** `--profile-id=N` **or** `--student-name=` + `--class-name=` (ILIKE substrings); **`--installmentinvoicedtl-id=N`** alone (or with `--profile-id` to verify); `--next-generation-date=YYYY-MM-DD`; `--next-invoice-month=YYYY-MM-DD`; `--apply`. If several open rows match the same profile, the script updates the **latest** (`installmentinvoicedtl_id` DESC) and prints a warning with the full list—use **`--installmentinvoicedtl-id=316`** to force one row.

### Installment invoice list / NULL `status` (migration `105`)

If Finance **Installment Invoice Logs** missed students because only the first 100 API rows loaded, deploy the frontend/backend changes that paginate until all rows are fetched and return `pagination.total`.

To backfill **`installmentinvoicestbl.status`** where it was `NULL`, apply migration **`105_backfill_installmentinvoicestbl_status.sql`** on production.

### `countMonthReEnrollmentMatrixLabels.js`

Counts **labeled cells** on the **Month Re-enrollment** dashboard matrix for a calendar year (same rules as the UI table). Reports **new**, **re-enrolled**, and **new + re-enrolled** totals per month and for the full year, and compares them to **rate header numerators** (month-to-month retention).

```bash
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --branch-id=1
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --program-id=2 --class-id=34
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --verbose
node scripts/countMonthReEnrollmentMatrixLabels.js --year=2026 --json
```

**Options:** `--year=YYYY`, `--branch-id=N`, `--program-id=N`, `--class-id=N`, `--verbose` (list each new/re-enrolled cell), `--json`, `--help`

### `auditEnrollmentKpiEdgeCases.js`

Scans the database for **enrollment KPI edge cases** similar to the Bronny James investigation:

1. **Partial payment dual-count** — multiple completed payments on the same student + class + phase + invoice chain (would inflate re-enrollment without dedupe; e.g. Vitrum Worldwide INV-567 phase 2).
2. **Bronny-like same-day upsell** — lower-program phase 1 payment on the same `issue_date` as a higher-program upsell / full pay.
3. **Misclassified phase 1** — lower phase 1 still `re_enrolled` on that same day (operational KPI risk).
4. **Multi-level tracks** — students with active rows in 2+ program levels (matrix single-row merge candidates).
5. **Matrix upsell merge** — duplicate matrix rows, unmerged upsell siblings, or merged-anchor completed phase mismatches for the month’s calendar year.

```bash
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06 --section=partial
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06 --section=bronny
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06 --section=matrix --verbose
node scripts/auditEnrollmentKpiEdgeCases.js --month=2026-06 --json
```

**Options:** `--month=YYYY-MM`, `--branch-id=N`, `--program-id=N`, `--class-id=N`, `--section=all|partial|bronny|misclassified|tracks|matrix`, `--verbose`, `--json`, `--help`

## Adding New Scripts

### `auditEnrollmentDataQuality.js`

Read-only scan of **all** completed class payments (not June-only) for enrollment KPI anomalies:

- Partial-payment groups that would double-count without invoice-chain + phase dedupe
- Bronny-like same-day cross-class / upsell patterns (legacy flip vs current classification)
- Lower-completed + higher-program upsell merge candidates

```bash
node scripts/auditEnrollmentDataQuality.js
node scripts/auditEnrollmentDataQuality.js --pattern=partial
node scripts/auditEnrollmentDataQuality.js --from=2020-01-01 --branch-id=1 --limit=50
node scripts/auditEnrollmentDataQuality.js --student-id=123 --json
```

**Options:** `--pattern=all|partial|bronny|upsell|dedupe`, `--from`, `--to`, `--branch-id`, `--student-id`, `--limit`, `--json`, `--help`

### `repairEnrollmentAuditFindings.js`

Sets higher-program phase 1 rows to `upsell` when a lower program is already `completed` (pairs flagged by the audit).

```bash
node scripts/repairEnrollmentAuditFindings.js --dry-run
node scripts/repairEnrollmentAuditFindings.js --apply
node scripts/repairEnrollmentAuditFindings.js --apply --student-id=336
```

**Options:** `--dry-run`, `--apply`, `--student-id`, `--help`

### `repairKirstenMahinayMissedPhase5Generation.js`

One-off repair for **Kirsten Celesse J. Mahinay** (`cherryjaodmd@gmail.com`, profile **123**) — missed **phase 5** (June 25, 2026) due to late-start billing drift. Restores `generated_count`, resets queue to Jun 25 / Jul 01, optionally generates the phase 5 invoice.

```bash
node backend/scripts/repairKirstenMahinayMissedPhase5Generation.js
node backend/scripts/repairKirstenMahinayMissedPhase5Generation.js --apply
node backend/scripts/repairKirstenMahinayMissedPhase5Generation.js --apply --generate
```

### `repairArtEnzoArbisuPhase5AugustMatrix.js`

One-off repair for **Art Enzo M. Arbisu** (`magz_remie1580@yahoo.com`, student **663**, profile **490**, class **94**). Late-start **phase 5** `new` was anchored on `enrolled_at` **2026-07-14**, so Month Re-enrollment / Report counted him in **July**. Ops: phase 5 billing month is **August**.

- `classstudent` **1871** `enrolled_at` → **2026-08-01**
- Phase 5 **INV-2003** issue/due → **2026-07-25** / **2026-08-05**

```bash
node scripts/repairArtEnzoArbisuPhase5AugustMatrix.js --production
node scripts/repairArtEnzoArbisuPhase5AugustMatrix.js --production --apply
```

### `repairSabrinaResurreccionEndedClassMatrix.js`

One-off repair for **Sabrina M. Resurreccion** (`ryayo18@yahoo.com`, student **421**, Malolos Kindergarten class **84**, Inactive, end **2026-04-30**). Late payment auto-enrolls set `enrolled_at` in May/Jun 2026, so the 2026 matrix wrongly showed May=`new` through Dec=`re-enrolled`. Aligns phases 2–10 to the class calendar — **new starts Aug 2025**, Sep 2025–Mar 2026 re-enrolled, Apr 2026 completed, May+ blank.

```bash
node scripts/repairSabrinaResurreccionEndedClassMatrix.js --production
node scripts/repairSabrinaResurreccionEndedClassMatrix.js --production --apply
```

### `repairRyanQuiendayEndedClassMatrix.js`

One-off repair for **Ryan Sebastian Quienday** (`geneveivgeronca@yahoo.com`, student **225**, Malolos Pre-Kinder class **86**, Inactive, end **2026-04-27**). Late May 2026 payments auto-enrolled phases 8–10 with `enrolled_at` in May, so the matrix wrongly showed May=`new`, Jun=`re-enrolled`, Jul=`completed` (Report counted him Active). Aligns to class calendar — **new starts Feb 2026**, Mar re-enrolled, Apr completed, May Inactive.

```bash
node scripts/repairRyanQuiendayEndedClassMatrix.js --production
node scripts/repairRyanQuiendayEndedClassMatrix.js --production --apply
```

### `moveAnastasiaYangaPreKToNursery930.js`

One-off cross-program move + billing fix for **Anastasia Chrysanthe Catibog Yanga** (`mveravgc@gmail.com`, student **337**). Mis-click used package **176** "Per Phase - Old Rate" as **Fullpayment** on Pre-K class **69**, auto-enrolling all 10 phases as **upsell**. Converts package **176** → **Phase + Installment** (Nursery, phases 1–10; sole user), moves **phase 1 only** to active Nursery class **153** `VMM_Nursery_TThS 9:30 AM` as **new**, creates installment profile + phase-2 queue, retags **INV-2054** as `TARGET_PHASE:1`, deletes phases 2–10 and 2 mismatched Pre-K attendance rows.

```bash
node scripts/moveAnastasiaYangaPreKToNursery930.js --production
node scripts/moveAnastasiaYangaPreKToNursery930.js --production --apply
```

### `repairMargauxNacarPendingEnrollment.js`

One-off repair for **Margaux Emilia Nacar** (`nepjuanillo@gmail.com`, student **657**, profile **483**, class **154**). Downpayment (**INV-1968**) and Phase 1 (**INV-1995**) are Paid, but `classstudent` **1812** stayed on `pending_enrollment`, so Month Re-enrollment showed July **pending enrollment** / August **Inactive** instead of **new**. Re-runs `syncInstallmentEnrollmentForPaidInvoice` to promote → `new`.

```bash
node scripts/repairMargauxNacarPendingEnrollment.js --production
node scripts/repairMargauxNacarPendingEnrollment.js --production --apply
```

### `repairMargauxNacarGeneratePhase2.js`

Follow-up for **Margaux Emilia Nacar**: installment queue had jumped to **Aug 25 / Sep 01**. Forces queue to **2026-07-25 / 2026-08-01**, optionally generates **Phase 2**, then advances queue to **Aug 25 / Sep 01**.

```bash
node scripts/repairMargauxNacarGeneratePhase2.js --production
node scripts/repairMargauxNacarGeneratePhase2.js --production --apply --generate
```

### `repairBrixxCabotejaPendingAndPhase2.js`

Same Margaux scenario for **Brixx Irving T. Caboteja** (`marjorietanala@gmail.com`, student **666**, profile **492**, class **149**): promote `pending_enrollment` → `new`, force queue **Jul 25 / Aug 01**, generate **Phase 2**, then queue **Aug 25 / Sep 01**.

```bash
node scripts/repairBrixxCabotejaPendingAndPhase2.js --production
node scripts/repairBrixxCabotejaPendingAndPhase2.js --production --apply --generate
```

### `repairClydeFalconInactiveStopGeneration.js`

**CLYDE WESLEY Q. FALCON** (student **81**, Cavite profiles **55** Pre-Kinder + **58** Playgroup): May matrix stayed **Active** with no due date because unpaid invoices lacked `TARGET_PHASE` (lifecycle could not map them). Code fix ranks by `issue_date` when remarks are missing. This script sets both profiles `is_active=false`, clears `next_generation_date`, and keeps queue status `Generated` so generation stops.

```bash
node scripts/repairClydeFalconInactiveStopGeneration.js --production
node scripts/repairClydeFalconInactiveStopGeneration.js --production --apply
```

### `repairMargaretEndicoMissedPhase5Generation.js`

One-off repair for **Margarette Celine P. Endico** (`endico.kiel@yahoo.com`, profile **436**, class **47**) — missed **phase 5** (issue **2026-06-25**, due **2026-07-05**). Queue had jumped to Sep 25 / Oct 01; canonical schedule is also poisoned by phase 4’s Aug 26 issue, so the script **forces** Jun 25 / Jul 01, optionally generates phase 5, then advances the queue to **Jul 25 / Aug 01**.

```bash
node scripts/repairMargaretEndicoMissedPhase5Generation.js --production
node scripts/repairMargaretEndicoMissedPhase5Generation.js --production --apply
node scripts/repairMargaretEndicoMissedPhase5Generation.js --production --apply --generate
```

### `repairMargaretEndicoPhase45IssueDueDates.js`

Follow-up date fix after phase 5 was generated with wrong dates (**INV-2074** Aug 26 / Aug 26 while Phase 4 held Jun 25 / Jul 05). Sets:

| Phase | Invoice | Issue | Due |
|-------|---------|-------|-----|
| 4 | **1439** | 2026-05-25 | 2026-06-05 |
| 5 | **2074** | 2026-06-25 | 2026-07-05 |

Also sets installment queue to **2026-07-25** / **2026-08-01**.

```bash
node scripts/repairMargaretEndicoPhase45IssueDueDates.js --production
node scripts/repairMargaretEndicoPhase45IssueDueDates.js --production --apply
```

### `repairPrincessMoriannePascualPhase4Dates.js`

**Princess Morianne F. Pascual** (`florescomillearianne@gmail.com`) — Nursery Installment Plan 3 (profile **323**).

| Target | From | To |
|--------|------|-----|
| Phase 4 **INV-1749** / AR **261413** | 2026-06-25 / 2026-07-05 | **2026-07-25** / **2026-08-05** |
| Queue next_generation / next_invoice_month | (confirm) | **2026-08-25** / **2026-09-01** |

Also clears late penalty on INV-1749 and recalculates amount / program payment status.

```bash
node scripts/repairPrincessMoriannePascualPhase4Dates.js
node scripts/repairPrincessMoriannePascualPhase4Dates.js --apply
```

### `repairTheoSamuelMoralesPhase3Dates.js`

**Theo Samuel P. Morales** (`charlsmorales01@gmail.com`) — Pre-Kindergarten Installment Plan 3 (profile **371**).

| Target | From | To |
|--------|------|-----|
| Phase 3 **INV-1761** / AR **261425** | 2026-06-25 / 2026-07-05 | **2026-07-25** / **2026-08-05** |
| Queue next_generation / next_invoice_month | (confirm; often already set) | **2026-08-25** / **2026-09-01** |

Also clears late penalty on INV-1761 and recalculates amount / program payment status.

```bash
node scripts/repairTheoSamuelMoralesPhase3Dates.js
node scripts/repairTheoSamuelMoralesPhase3Dates.js --apply
```

### `moveAndreaSalurioToVmpPreK4pm.js`

**Andrea Claire Salurio** (`deegurrolajanine123@gmail.com`, user **640**) — move **completed** Phase 10 from `VMP_Pre-Kindergarten_MWF_2:30PM` (**65**) → `VMP_Pre-Kindergarten_MWF_4PM` (**66**).

UI move-student cannot move `completed` enrollments; this script:

| Step | Detail |
|------|--------|
| Soft-remove duplicate | classstudent **1532** (dup phase 10) |
| Move | classstudent **1463** → class **66** |
| Retag invoices | INV **1837**, **1853** remarks `CLASS_ID:65` → `CLASS_ID:66` |

Phases 1–9 on **NC_Pre-Kindergarten_MWF 4PM** / Active **VMP_Pre-Kindergarten_MWF 4PM** (162) are left unchanged. Target class **66** is currently **Inactive** — confirm before apply; optional `--reactivate-target`.

```bash
node scripts/moveAndreaSalurioToVmpPreK4pm.js
node scripts/moveAndreaSalurioToVmpPreK4pm.js --apply
node scripts/moveAndreaSalurioToVmpPreK4pm.js --apply --reactivate-target
```

### `removeAndreaSalurioInactiveVmp4pmPhase10.js`

Same student — **undo** inactive Phase 10 on old `VMP_Pre-Kindergarten_MWF_4PM` (**66**). Keep Active `VMP_Pre-Kindergarten_MWF 4PM` (**162**, phases 1–9).

| Action | Class | Detail |
|--------|-------|--------|
| **KEEP** | **162** Active | phases 1–9 unchanged |
| **REMOVE** | **66** Inactive | soft-remove classstudent **1463** (phase 10 completed) |
| Retag invoices | INV **1837**, **1853** | `CLASS_ID:66` → `CLASS_ID:162` |

```bash
node scripts/removeAndreaSalurioInactiveVmp4pmPhase10.js
node scripts/removeAndreaSalurioInactiveVmp4pmPhase10.js --apply
```

### `removeAndreaSalurioWrongKg13pmPending.js`

Same student — remove **wrong pending** enrollment on `KG_1-3PM` (**166**) only. She appears on Class Students as Pending / Not verified because of an **active installment profile** + unpaid downpayment **INV-2368** (`CLASS_ID:166`), not a `classstudent` row.

| Action | Detail |
|--------|--------|
| **KEEP** | **162** Active VMP 4PM phases 1–9 unchanged |
| Soft-remove | any active `classstudent` on **166** (none expected) |
| Cancel | unpaid invoices on the KG profile (refuse if any **Paid**) |
| Deactivate | installment profile(s) on **166** (`is_active = false`) |

```bash
node scripts/removeAndreaSalurioWrongKg13pmPending.js
node scripts/removeAndreaSalurioWrongKg13pmPending.js --apply
```

### `repairMorganAquinoPlaygroupMatrix.js`

**Morgan Atlas Milag Aquino** (`kimberlymilag@gmail.com`, user **514**) — Playgroup class **89** / profile **296**.

Align month re-enrollment matrix with invoice Enrollment:

| Month | Label |
|-------|-------|
| Apr 2026 | **new** |
| May 2026 | **re-enrolled** |
| Jun 2026 | **re-enrolled** |
| Jul 2026 | **dropped** |
| Aug 2026 | **rejoin** |
| Sep 2026 | **Active** |

Also sets phase 2 `program_enrollment_status` to `re_enrolled` and `first_billing_month` to **2026-04-01**.

```bash
node scripts/repairMorganAquinoPlaygroupMatrix.js
node scripts/repairMorganAquinoPlaygroupMatrix.js --apply
```

### `repairAlonzoDeLunaPhase7Dates.js`

**Alonzo Xavier De Luna** (`larainerabago@gmail.com`) — Playgroup Installment Plan 1 (profile **495**, phase_start **6**).

| Target | From | To |
|--------|------|-----|
| Phase 7 **INV-2347** / AR **262012** | 2026-07-26 / 2026-08-05 | **2026-08-25** / **2026-09-05** |
| Queue next_generation / next_invoice_month | (confirm; often already set) | **2026-09-25** / **2026-10-01** |

Also clears late penalty on INV-2347 if present and recalculates amount / program payment status.

```bash
node scripts/repairAlonzoDeLunaPhase7Dates.js
node scripts/repairAlonzoDeLunaPhase7Dates.js --apply
```

### `repairAlonzoDeLunaMatrixAugustNew.js`

Same student — month re-enrollment matrix: move Phase 6 **new** from July → **August**, then **Active** in September.

| Month | Label |
|-------|-------|
| Aug 2026 | **new** |
| Sep 2026 | **Active** |

Updates classstudent **1936** `enrolled_at` → **2026-08-25** and profile **495** `first_billing_month` → **2026-08-01**.

```bash
node scripts/repairAlonzoDeLunaMatrixAugustNew.js
node scripts/repairAlonzoDeLunaMatrixAugustNew.js --apply
```

### `repairMatthaiasDeChavezRemovePlan1.js`

**Matthaias Sabino De Chavez** (`sabinomira000@gmail.com`, user **147**) — Playgroup duplicate plans on class `VMM_Playgroup_SS_11:00-12:00PM`.

| Action | Profile | Package | Notes |
|--------|---------|---------|-------|
| **REMOVE** Plan 1 | **279** | Phase 1-8_Old Rate No DP | Unpaid INV **1929, 2248, 2335, 2351** (+ schedule) deleted |
| **KEEP** Plan 2 | **281** | Phase 1-8_ Plan 1 No DP | Paid phases 1–4; unpaid phase 5 INV **2174** |

Does not modify `classstudentstbl`. Refuses if Plan 1 has any Paid invoices.

```bash
node scripts/repairMatthaiasDeChavezRemovePlan1.js
node scripts/repairMatthaiasDeChavezRemovePlan1.js --apply
```

### `repairMatthaiasDeChavezEnrollmentLabels.js`

Same student / class **92** / profile **281** — continuous paid path labels for phases 1–5:

| Phase | Before | After |
|-------|--------|-------|
| 1 | dropped (false delinquency) | **new** |
| 2 | new | **re_enrolled** |
| 3 | dropped (false delinquency) | **re_enrolled** |
| 4 | re_enrolled | **re_enrolled** |
| 5 | rejoin | **re_enrolled** |

Clears `removed_at` / reason on those rows. Aborts unless invoices for phases 1–5 are Paid.

```bash
node scripts/repairMatthaiasDeChavezEnrollmentLabels.js --production
node scripts/repairMatthaiasDeChavezEnrollmentLabels.js --production --apply
```

### `repairChloeAgadEnrollmentAfterFullPayment.js`

**Chloe Skye Agad** (`Kahreen.agad@yahoo.com`, user **11**) — class **38** SOMO Pre-Kinder MWF 11:00, profile **24** (Cavite). Paid conversion **INV-1348** (`PACKAGE_CHANGE_TO_FULLPAYMENT`). Leftover Unpaid TARGET_PHASE 4–7 invoices caused Student History delinquency sync to re-drop Phases 4–6 after enrollment-only repairs.

| Step | Action |
|------|--------|
| Billing | Cancel open Unpaid/Pending/Overdue invoices on profile **24**; deactivate profile; cancel Pending/Scheduled schedule rows |
| Enrollment | P1 **new**, P2–9 **re_enrolled**, P10 **completed**; clear `removed_at` |
| Verify | Re-run delinquency sync (expect 0 drops); August matrix Active |

```bash
node scripts/repairChloeAgadEnrollmentAfterFullPayment.js --production
node scripts/repairChloeAgadEnrollmentAfterFullPayment.js --production --apply
```

### `repairAzikielTecsonPhase67DueEnrollment.js`

**Azikiel T. Tecson** (`luis.tecson.ph@gmail.com`, user **643**) — class **47** SOMO Playgroup TTh, profile **472** (`phase_start` 6).

| Fix | Before | After |
|-----|--------|-------|
| INV **2403** Phase 6 due | 2026-07-20 | **2026-08-05** |
| INV **2820** Phase 7 due | 2026-12-05 | **2026-09-05** |
| CS **1519** Phase 6 | `pending_enrollment` (enrolled Jul 1) | **`new`** @ **2026-08-03** (August matrix = new) |
| CS **2481** Phase 7 | `re_enrolled` @ Sep 1 | keep **`re_enrolled`** (September matrix) |

Default is dry-run. You apply.

```bash
node scripts/repairAzikielTecsonPhase67DueEnrollment.js --production
node scripts/repairAzikielTecsonPhase67DueEnrollment.js --production --apply
```

### `repairJohnzelDeJesusEnrollmentMayJunJul.js`

**JOHNZEL MAURU G. DE JESUS** (`jezreelgarcia09@gmail.com`, user **75**) — class **50** SOMO Playgroup SS, profile **49**.

After Phase 2 drop, Phase 3 enrollment was missing (May blank on Month Re-enrollment). Phases 4–5 were incorrectly `rejoin`.

| Fix | Result |
|-----|--------|
| INSERT Phase 3 `rejoin` @ 2026-05-04 | **May = rejoin** |
| CS **1085** Phase 4 → `re_enrolled` | **June = re-enrolled** |
| CS **1478** Phase 5 → `re_enrolled` | **July = re-enrolled** |

```bash
node scripts/repairJohnzelDeJesusEnrollmentMayJunJul.js --production
node scripts/repairJohnzelDeJesusEnrollmentMayJunJul.js --production --apply
```

### `repairSkylerVillanuevaUpsellSeptember.js`

**Skyler Dawson Legerin Villanueva** (`shannenlegerin@gmail.com`, user **254**) — Pre-K class **161** (start **2026-09-03**), profile **526**.

Nursery completed April; Pre-K Phase 1 is already **`upsell`**, but `enrolled_at` was **2026-08-31**, so Month Re-enrollment showed **August upsell**. Shift enroll dates so **September = upsell**, then Oct+ = re-enrolled.

```bash
node scripts/repairSkylerVillanuevaUpsellSeptember.js --production
node scripts/repairSkylerVillanuevaUpsellSeptember.js --production --apply
```

### `repairKirstenMahinayPhaseEnrollmentAndPayments.js`

One-off repair for **Kirsten Celesse J. Mahinay** (`cherryjaodmd@gmail.com`). **Cascades** earlier invoice + AR onto later phase slots (payments stay on the same physical invoice rows):

| Phase slot | Invoice | AR | Payment | Issued | Due | Enrollment |
|------------|---------|-----|---------|--------|-----|------------|
| 1 | — | — | — | — | — | Not enrolled |
| 2 | **311** (was ph.1) | — | PAY-209 | 2026-03-25 | 2026-04-05 | New (paid) |
| 3 | **571** (was ph.2) | **260224** | PAY-681 | 2026-04-25 | 2026-05-05 | Re-enrolled (paid) |
| 4 | **1012** (was ph.3) | **260674** | — | 2026-05-25 | 2026-06-05 | Generated, unpaid |

INV-**1511** (old phase 4) is **Cancelled** and **detached** from the profile (`installmentinvoiceprofiles_id = NULL`) so it cannot appear on phase slot 1. Sets `TARGET_PHASE` on 311/571/1012 for correct Student History mapping.

**Attendance:** `attendancetbl` rows on class **curriculum** phase 1 sessions move to matching phase 2 sessions (same `phase_session_number`), then phase 2 → phase 3. Together with enrollment on phases 2 and 3, Student History and class attendance show those marks under the correct billing phases.

```bash
node scripts/repairKirstenMahinayPhaseEnrollmentAndPayments.js --dry-run
node scripts/repairKirstenMahinayPhaseEnrollmentAndPayments.js --apply
```

### `repairKirstenMahinayDetachOrphanInvoice1511.js`

Supplemental one-off if INV-**1511** was cancelled but still linked to profile **123** (Student History showed cancelled data on phase 1). Detaches the orphan and strips `TARGET_PHASE` from its remarks.

```bash
node scripts/repairKirstenMahinayDetachOrphanInvoice1511.js --dry-run
node scripts/repairKirstenMahinayDetachOrphanInvoice1511.js --apply
```

### `repairKirstenMahinayRestoreTargetPhases.js`

If Student History shows invoices shifted one slot early (phase 1 has INV-311, phase 4 empty), the phases API auto-repair may have rewritten `TARGET_PHASE` to 1/2/3. This script restores **2/3/4** on INV-311/571/1012. Requires the enrollment-aware gap fix in `installmentPhaseBillingSync.js` so the API does not re-shift on the next load.

```bash
node scripts/repairKirstenMahinayRestoreTargetPhases.js --dry-run
node scripts/repairKirstenMahinayRestoreTargetPhases.js --apply
```

### `repairKirstenMahinayRemovePhase1AugustInactive.js`

**Kirsten Celesse J. Mahinay** (`cherryjaodmd@gmail.com`, student **109**, profile **123**, class **47**). Student History is **Inactive** (Phase 6 overdue Aug 5) but Report → Student Status August was **active / re-enrolled**. Leftover Phase 1 CS **251** shifted paid Phase 5 onto August; lifecycle Inactive landed on September. The Inactive-exclusion report rule was already correct — August was a real re-enrolled cell.

Deletes Phase 1 only (invoices, payments, `phase_start`, `generated_count` unchanged). Target matrix: Apr P2 new → Jul P5 re-enrolled → **Aug Inactive**.

```bash
node backend/scripts/repairKirstenMahinayRemovePhase1AugustInactive.js --production
node backend/scripts/repairKirstenMahinayRemovePhase1AugustInactive.js --production --apply
```

### `diagnoseKirstenMahinayInstallmentProgress.js`

Read-only check for **Kirsten Celesse J. Mahinay** installment progress after late-start enrollment (class phase 2). Compares DB `generated_count`, list-page `paid_phases` / `generated_phases`, and Student History phase progress (complete / paid / generated).

```bash
node scripts/diagnoseKirstenMahinayInstallmentProgress.js
```

### `repairKirstenMahinayInstallmentProgressDisplay.js`

Ensures Kirsten's DB rows support **late-start** modal display: hide plan slot 1, progress **2/9 complete** and **3/10 paid** (downpayment + 2 paid phases). Pairs with phases API + `InstallmentPlanDetails` late_start_gap UI.

```bash
node scripts/repairKirstenMahinayInstallmentProgressDisplay.js --dry-run
node scripts/repairKirstenMahinayInstallmentProgressDisplay.js --apply
```

### `repairKirstenMahinayPhase34IssueDueDates.js`

Earlier date-only fix (Phase 3 issue/due). Superseded for enrollment/payment work by `repairKirstenMahinayPhaseEnrollmentAndPayments.js` above once Phase 3 dates are already correct.

```bash
node scripts/repairKirstenMahinayPhase34IssueDueDates.js --dry-run
node scripts/repairKirstenMahinayPhase34IssueDueDates.js --apply
```

### `repairMaverickManzanalPhase56IssueDueDates.js`

**Maverick Raziel Viola Manzanal** (`shaimanzanal@icloud.com`, profile `94`, Playgroup Plan 1) — correct Phase 5 & 6 issue/due dates (one month too late after drop/rejoin cadence). Clears late-penalty line items so the due-date job can re-apply.

- Phase 5 INV-1545 → issue `2026-04-25`, due `2026-05-05`
- Phase 6 INV-1589 → issue `2026-05-25`, due `2026-06-05`

```bash
node scripts/repairMaverickManzanalPhase56IssueDueDates.js
node scripts/repairMaverickManzanalPhase56IssueDueDates.js --apply
```

### `repairKeepFirstDroppedOnly.js`

For installment tracks with **multiple dropped phases**:

- **Keep** the first dropped phase (enrollment + its invoice)
- **Delete** later dropped enrollments (e.g. drops `2,3,4,5` → delete P3–P5)
- **Delete** unpaid invoices for those extra dropped phases (skips Paid / Partially Paid / invoices with payments)

Modes:

| Flag | Population |
|------|------------|
| (default) | No-rejoin / no-continue only — also clears later unpaid generated invoices and sets `generated_count` / `is_active=false` |
| `--include-continued` | All multi-drop tracks including rejoined |
| `--continued-only` | Only rejoined/continued tracks (e.g. Ianna, Lorrie, Lucas, Zein) — **does not** change `generated_count` / `is_active`; keeps rejoin invoices |

```bash
node scripts/repairKeepFirstDroppedOnly.js
node scripts/repairKeepFirstDroppedOnly.js --csv
node scripts/repairKeepFirstDroppedOnly.js --continued-only --csv
node scripts/repairKeepFirstDroppedOnly.js --include-continued
node scripts/repairKeepFirstDroppedOnly.js --profile-id=149
node scripts/repairKeepFirstDroppedOnly.js --continued-only --apply
```

### `repairMaverickManzanalRemovePhases5to7.js`

**Maverick Raziel Viola Manzanal** — after unpaid Phase 4 delinquency drop, remove incorrectly generated Playgroup invoices:

- DELETE INV-1545 (P5), INV-1589 (P6), INV-1812 (P7) — unpaid, no payments
- DELETE Phase 5–6 delinquency drop enrollment rows
- `generated_count` → `3`; profile stays inactive (Phase 4 INV-1480 remains unpaid/dropped)

```bash
node scripts/repairMaverickManzanalRemovePhases5to7.js
node scripts/repairMaverickManzanalRemovePhases5to7.js --apply
```

### `repairMaverickManzanalUndoPhase7Rejoin.js`

**Maverick Raziel Viola Manzanal** — undo accidental Phase 7 rejoin invoices and clear Phase 5–6 rejoin gap markers so those slots show as not enrolled (`-`):

- DELETE unpaid Phase 7 rejoin invoices (INV-1989, INV-1990)
- DELETE Phase 5–6 `dropped` gap marker classstudent rows (`System (Rejoin gap marker)`)
- `generated_count` → `3`; profile `is_active=false` (Phase 4 INV-1480 remains unpaid/dropped)

```bash
node scripts/repairMaverickManzanalUndoPhase7Rejoin.js
node scripts/repairMaverickManzanalUndoPhase7Rejoin.js --apply
```

### `repairMaverickManzanalPhase3PaidEnrollment.js`

**Maverick Raziel Viola Manzanal** — Playgroup Phase 3 (INV-275 Paid) had enrollment overwritten to `dropped` by delinquency. Restores `re_enrolled` and clears removal fields. Leaves Phase 4–6 drops unchanged.

```bash
node scripts/repairMaverickManzanalPhase3PaidEnrollment.js
node scripts/repairMaverickManzanalPhase3PaidEnrollment.js --apply
```

### `repairAndreiAtienzaPhase610IssueDueDates.js`

**Andrei Caleb Ethan V. Atienza** (`juliven_atienza@lifelinediag.com`, student `247`, profile `97`) — Nursery Phase 6–9 issue/due dates:

| Phase | Invoice | Issue | Due |
|-------|---------|-------|-----|
| 6 | INV-278 | 2026-02-22 | 2026-02-22 |
| 7 | INV-294 | 2026-03-25 | 2026-04-05 |
| 8 | INV-773 (+774 due) | 2026-04-25 | 2026-05-05 |
| 9 | INV-1201 | 2026-05-25 | 2026-06-05 |
| 10 | (not generated) | 2026-06-25 | 2026-07-05 |

Clears late-penalty markers on updated invoices. Phase 10 stays Not Generated until explicitly generated.

```bash
node scripts/repairAndreiAtienzaPhase610IssueDueDates.js
node scripts/repairAndreiAtienzaPhase610IssueDueDates.js --apply
```

### `repairAndreiAtienzaGeneratePhase10.js`

Same student — generate missing **Phase 10** (issue `2026-06-25`, due `2026-07-05`). Temporarily reactivates inactive class 58 for generation, then restores Inactive; marks profile complete.

```bash
node scripts/repairAndreiAtienzaGeneratePhase10.js
node scripts/repairAndreiAtienzaGeneratePhase10.js --apply
```

### `repairAnaiahMecijaPreKMatrixJuneJuly.js`

**Anaiah Cali Tan Mecija** (`student 249`, `maicahtan@gmail.com`) — Pre-K upsell on Nursery row:

- Profile `420` `first_billing_month` → `2026-06-01` (class start / phase 1 enrollment)
- Expected matrix: Apr completed → May `-` → Jun upsell → Jul re-enrolled → Aug Active
- Requires upsell merge fix in `enrollmentRateMetrics.js` (display start = later of handoff+1 vs higher first month)

```bash
node scripts/repairAnaiahMecijaPreKMatrixJuneJuly.js
node scripts/repairAnaiahMecijaPreKMatrixJuneJuly.js --apply
```

### `repairMaverickManzanalPlaygroupMatrixFebruary.js`

Same student / Plan 1 Playgroup (`class 57`, profile `94`) — align month matrix with invoice Enrollment:

- Phase 2 `enrolled_at` → `2026-02-02` so **new** lands in **February**
- Profile `first_billing_month` → `2026-02-01`
- Expected: Feb new → Mar–Jun dropped → Jul rejoin → Aug Active

(Requires paid-overlay fix in `enrollmentRateMetrics.js` so paid+dropped phases stay **dropped**.)

```bash
node scripts/repairMaverickManzanalPlaygroupMatrixFebruary.js
node scripts/repairMaverickManzanalPlaygroupMatrixFebruary.js --apply
```

### `reassignMaverickPlaygroupP7PaymentToNurseryP1.js`

Same student — payment **1460** was posted to **Playgroup Phase 7 (INV-1812)** but belongs on **Nursery Phase 1 (INV-1113)**.

- Reassigns payment → INV-1113; Playgroup P7 becomes Unpaid; Nursery P1 becomes Paid
- Voids Playgroup Phase 7 rejoin enrollment; promotes Nursery Phase 1 pending → enrolled

```bash
node scripts/reassignMaverickPlaygroupP7PaymentToNurseryP1.js
node scripts/reassignMaverickPlaygroupP7PaymentToNurseryP1.js --apply
```

### `repairKievZionSerranoHideBillingClassEnrollment.js`

**Kiev Zion Z. Serrano** (Pampanga, student `581`) — soft-drop ops-inserted enrollment on billing class **110** (VMM 2:30 PM) so Student History → Enrolled class only shows **120** (VMP 1:00 PM).

```bash
node scripts/repairKievZionSerranoHideBillingClassEnrollment.js
node scripts/repairKievZionSerranoHideBillingClassEnrollment.js --apply
```

### `repairJullaRojasDownpaymentPhase1Display.js`

**Julla Santos Rojas** (student `590`, profile `462`) — downpayment balance chain was mis-shown as Phase 1 Paid. Restores DP root INV-1773, remaps INV-1775 to unpaid Phase 1, `generated_count=1`, enrollment → `pending_enrollment`.

```bash
node scripts/repairJullaRojasDownpaymentPhase1Display.js
node scripts/repairJullaRojasDownpaymentPhase1Display.js --apply
```

### `setJaliyahAlmendrasInstallmentPhaseStart2.js`

Set **Jaliyah Callie Almendras** (`rinadeleon713@gmail.com`, profile `150`, class `47`) installment **`phase_start` → 2** so the plan begins at class Phase 2 (curriculum phase 1 is outside the plan grid).

- **`--apply`**: updates `installmentinvoiceprofilestbl.phase_start` and aligns `program_enrollment_status` (phase 1 `new`, phases 2–4 `re_enrolled`).
- **`--shift-attendance`**: optional with `--apply` — moves attendance rows phase 1→2, 2→3, 3→4 when present (dry-run previews shifts).

```bash
node scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js
node scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js --dry-run
node scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js --apply
node scripts/setJaliyahAlmendrasInstallmentPhaseStart2.js --apply --shift-attendance
```

### `repairJaliyahAlmendrasPhaseProgressDisplay.js`

Align **Installment Invoice Logs** phase progress with Kirsten (same class): **5 / 10** not **5 / 11**. Sets `phase_start` → `NULL` and `generated_count` → `5` when phase 5 invoice exists.

```bash
node backend/scripts/repairJaliyahAlmendrasPhaseProgressDisplay.js
node backend/scripts/repairJaliyahAlmendrasPhaseProgressDisplay.js --apply
```

### `repairJaliyahAlmendrasInstallmentIssueDueDates.js`

Correct **issue/due dates** and `TARGET_PHASE` remarks for Jaliyah Callie Almendras (`rinadeleon713@gmail.com`, profile **150**, class **47**) to match the same class billing cadence as Kirsten Mahinay (25th issue / 5th next-month due). Resets INV-1525 to **Unpaid** after moving phase 5 to Jun 25 / Jul 5.

```bash
node backend/scripts/repairJaliyahAlmendrasInstallmentIssueDueDates.js
node backend/scripts/repairJaliyahAlmendrasInstallmentIssueDueDates.js --apply
```

### `repairJaliyahAlmendrasInstallmentInvoiceSlots.js`

Swap installment invoice slots so **display Phase 4 = paid (INV-1043)** and **Phase 5 = overdue / Pay Now (INV-1525)**. Sets `TARGET_PHASE:4` on 1043 and `TARGET_PHASE:5` on 1525.

```bash
node scripts/repairJaliyahAlmendrasInstallmentInvoiceSlots.js
node scripts/repairJaliyahAlmendrasInstallmentInvoiceSlots.js --apply
```

### `repairMariashaPangilinPhase1EnrollmentAnchor.js`

Set phase 1 `classstudentstbl.enrolled_at` to the class Phase 1 start session so the month re-enrollment matrix shows **new** in **March** (not May when auto-enroll used a later payment date).

```bash
node scripts/repairMariashaPangilinPhase1EnrollmentAnchor.js
node scripts/repairMariashaPangilinPhase1EnrollmentAnchor.js --apply
```

When adding new scripts to this directory:

1. Follow the ES module syntax (import/export)
2. Include proper error handling
3. Add command-line argument parsing if needed
4. Include a `--help` option
5. Update this README with script documentation
6. Use descriptive console output with emojis for better readability

