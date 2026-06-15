# Receipt preview components

- **`AcknowledgementReceiptStylePreview.jsx`** — HTML preview styled like the acknowledgement receipt PDF (header, student/class/date, DESCRIPTION / RATE / AMOUNT table, thank-you row, totals, signature lines). Line items (including **Tip/Payment Adjustment** and **Discount/Payment Adjustment**) are built with `frontend/src/utils/ackReceiptTableLineItems.js`, matching the downloadable PDF (`backend/utils/ackReceiptTableLineItems.js` + `backend/lib/ackReceiptPdfGenerator.js`).
- **`ArPairedReceiptSummaryBlocks.jsx`** — Downpayment + Phase 1 paired summary (AR#, description, amount) for resubmit review and similar flows.
- **`ArFinanceVerifyModal.jsx`** — Finance/Superfinance landscape review modal for verify, return, or reject. Shows created-by, reference, attachment, and downpayment/Phase 1 line table. Return/reject modes include a required notes field for Finance.
- **`AcknowledgementReceiptStatusLegend.jsx`** — Horizontal legend for all AR list statuses (Pending through Cancelled). Used on the Acknowledgement Receipts page; tones and descriptions live in `frontend/src/utils/acknowledgementReceiptStatus.js`.
