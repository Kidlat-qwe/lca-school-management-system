# Leadershipboard — Overall Branch Ranking

This document explains how **Overall** is computed on the Leadershipboard dashboard  
(`/superadmin/leadershipboard`, `/superfinance/leadershipboard`, `/admin/leadershipboard`).

Metric values come from the same source as the **Monthly Operational Dashboard**:

| Column | Source |
|--------|--------|
| Invoice Sales | Completed payments by issue date (`daily_sales_amount`), excluding Returned / Rejected |
| New | Month Re-enrollment matrix — new |
| Re-enrolled | Month Re-enrollment matrix — re-enrolled |
| Rejoin | Month Re-enrollment matrix — rejoin |
| Upsell | Month Re-enrollment matrix — upsell |
| Active | Display only: New + Re-enrolled + Rejoin + Upsell (**not used in Overall**) |

---

## Overall = weighted criteria score

Overall is a **rubric**: each criterion is graded `0–1` against peer branches for the selected month, then mixed with fixed weights.

### Criteria & weights

| Criteria | Weight | Used in Overall? |
|----------|--------|------------------|
| Invoice Sales | **40%** | Yes |
| New | **20%** | Yes |
| Re-enrolled | **20%** | Yes |
| Rejoin | **10%** | Yes |
| Upsell | **10%** | Yes |
| Active Students | — | **No** (shown in the table only) |

**Why Active is excluded:** Active is already the sum of New + Re-enrolled + Rejoin + Upsell. Including it again would double-count enrollment.

**Tie-breakers** (if Overall is equal):

1. Higher Invoice Sales  
2. Branch name A → Z  

---

## Formula

### 1. Min–max normalize each criterion across all branches

```
normalized = (value − min) / (max − min)
```

- Best branch on that criterion → `1`  
- Worst → `0`  
- If every branch has the same value → `1` if value > 0, else `0`  

### 2. Apply weights

```
Overall =
  (n_sales      × 0.40
 + n_new        × 0.20
 + n_reenrolled × 0.20
 + n_rejoin     × 0.10
 + n_upsell     × 0.10) × 100
```

Rounded to **1 decimal place** (e.g. `74.8`).

### 3. Rank

Sort by Overall descending → Rank #1, #2, …

Selecting another compare metric (Invoice Sales, New, etc.) **re-sorts** the table by that column alone. Only **Overall** uses the weighted formula above.

---

## Sample computation (current-month style)

Illustrative numbers matching a typical Leadershipboard month (four branches).

### Raw data

| Branch | Invoice Sales | New | Re-enrolled | Rejoin | Upsell | Active* |
|--------|---------------|-----|-------------|--------|--------|---------|
| LCA Cavite | 669,096.08 | 45 | 56 | 2 | 0 | 103 |
| LCA Malolos | 477,986.61 | 16 | 76 | 1 | 9 | 102 |
| LCA Pampanga | 209,389.08 | 6 | 43 | 9 | 0 | 58 |
| LCA Guiguinto | 152,634.00 | 13 | 22 | 0 | 2 | 37 |

\*Active is display-only.

### Min / max

| Criteria | Min | Max |
|----------|-----|-----|
| Invoice Sales | 152,634.00 | 669,096.08 |
| New | 6 | 45 |
| Re-enrolled | 22 | 76 |
| Rejoin | 0 | 9 |
| Upsell | 0 | 9 |

### Normalize (examples)

**Cavite**

```
Sales:       (669,096.08 − 152,634) / (669,096.08 − 152,634) = 1.000
New:         (45 − 6) / (45 − 6) = 1.000
Re-enrolled: (56 − 22) / (76 − 22) = 34/54 ≈ 0.630
Rejoin:      2/9 ≈ 0.222
Upsell:      0/9 = 0.000
```

**Malolos**

```
Sales:       (477,986.61 − 152,634) / 516,462.08 ≈ 0.630
New:         (16 − 6) / 39 ≈ 0.256
Re-enrolled: (76 − 22) / 54 = 1.000
Rejoin:      1/9 ≈ 0.111
Upsell:      9/9 = 1.000
```

### Weighted Overall

**Cavite**

```
= (1.000×0.40 + 1.000×0.20 + 0.630×0.20 + 0.222×0.10 + 0.000×0.10) × 100
= (0.400 + 0.200 + 0.126 + 0.022 + 0.000) × 100
≈ 74.8
```

**Malolos**

```
= (0.630×0.40 + 0.256×0.20 + 1.000×0.20 + 0.111×0.10 + 1.000×0.10) × 100
= (0.252 + 0.051 + 0.200 + 0.011 + 0.100) × 100
≈ 61.4
```

### Result

| Rank | Branch | Approx. Overall | Why |
|------|--------|-----------------|-----|
| 1 | LCA Cavite | ~74.8 | Leads Invoice Sales (40%) and New (20%) |
| 2 | LCA Malolos | ~61.4 | Strong Re-enrolled + Upsell, lower Sales/New weight |

---

## Admin privacy mode

Branch **Admin** users get a **competitive standing** layout (not a blanked copy of the Superadmin table):

| UI area | Behavior |
|---------|----------|
| Standing hero | Large **place** (`#N of M`), coaching headline, own Overall / Sales / Active |
| Network race | Name + medal / place only — no encrypted peer cells |
| Your month snapshot | Own KPIs + strongest / climb-opportunity callouts |
| How Overall is built | Own weight breakdown (normalized vs peers; raw peer numbers stay private) |
| Sales trend | Own branch only |

Privacy remains API-enforced (`privacy_mode`, null peer metrics, `weight_breakdown` only on own row).

### Superadmin / Superfinance branch filter (focus mode)

When the global branch filter selects a branch, the API keeps **all** branches (full numbers) and sets `focus_mode` / `is_focus_branch`. The UI switches to a **stacked landscape** compare:

| Section | Content |
|---------|---------|
| Top | Selected branch snapshot (KPI row + Overall breakdown) — full width |
| Below | Full network ranking table — full width |

| Helper | Location |
|--------|----------|
| `focusBranchId` | `backend/lib/leadershipboardData.js` |
| Focus UI | `frontend/src/components/dashboard/BranchFocusStandingView.jsx` |

---

## Implementation

| Layer | Location |
|-------|----------|
| Scoring logic | `backend/lib/leadershipboardData.js` — `OVERALL_WEIGHTS`, `computeWeightedOverall` |
| API | `GET /api/v1/dashboard/leadershipboard?summary_month=YYYY-MM` (+ optional `branch_id` focus) |
| UI (full) | `frontend/src/components/dashboard/LeadershipboardView.jsx` |
| UI (branch focus) | `frontend/src/components/dashboard/BranchFocusStandingView.jsx` |
| UI (Admin) | `frontend/src/components/dashboard/AdminStandingView.jsx` |
| Short tooltips | `frontend/src/constants/dashboardDescriptions.js` → `LEADERSHIPBOARD` |

To change business weights, edit `OVERALL_WEIGHTS` in `leadershipboardData.js` (weights must sum to `1.0`).
