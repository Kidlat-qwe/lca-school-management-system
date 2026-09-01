# Package merchandise swap adjustment

When a student swaps a package-included freebie for a **more expensive** CMS item at
enrollment, the positive price difference is added to the invoice total.

## Rules

- Compare replacement SKU price vs the included package item price (from package detail / catalog).
- **Only charge positive differences** — cheaper replacements do not reduce the package price.
- Invoice line: `Merchandise swap adjustment: {original} → {replacement}`.

## Usage

`classes.js` enroll route calls `computePackageMerchSwapInvoiceAdjustments` after
merchandise lines are collected and before the invoice total is finalized.
