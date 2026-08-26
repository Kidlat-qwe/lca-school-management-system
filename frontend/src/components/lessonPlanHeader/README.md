# Lesson plan header

DepEd letterhead for Teacher and Superadmin/Admin lesson plan UIs.

## Layout

**LCA seal (left)** · letterhead text (**center**) · **DepEd seal (right)** · underlined **LESSON PLAN** title below.

Center lines (match official format; gothic via `UnifrakturCook`):

1. Republika ng Pilipinas  
2. Department of Education  
3. `{REGION}` — from branch `deped_region` (e.g. `REGION III`)  
4. `SCHOOLS DIVISION OFFICE OF {DIVISION}` — from branch `deped_division`  
5. `LITTLE CHAMPIONS ACADEMY INC.` (fixed)

## Assets

| Asset | Path |
|-------|------|
| LCA logo | `/LCA-Icon.png` |
| DepEd seal | `/deped-seal.png` (copied from `HEIC Convert (4).png`) |

## Shared constants

- School ID `411093` remains an app constant (not shown on this letterhead).
- District is still stored per branch for settings/API but is not part of this letterhead layout.

Migration: `146_add_deped_meta_to_branchestbl.sql`
