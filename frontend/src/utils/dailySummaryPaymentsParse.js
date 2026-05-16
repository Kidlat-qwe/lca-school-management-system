/** Superadmin/Finance "reject" stores Returned (legacy rows may still be Rejected until migrated). */
export const isFinanceReturnedSummaryStatus = (s) => s === 'Returned' || s === 'Rejected';

/** Normalize GET /daily-summary-sales/:id/payments (object with payments + AR + totals). */
export const parseDailySummaryPaymentsResponse = (res) => {
  const d = res?.data;
  if (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.payments)) {
    return {
      summary: d.summary || null,
      payments: d.payments || [],
      arReceipts: d.ar_receipts || [],
      totals: d.totals || null,
      submittedSnapshot: d.submitted_snapshot || null,
    };
  }
  if (Array.isArray(d)) {
    return {
      payments: d,
      arReceipts: [],
      totals: null,
      submittedSnapshot: null,
    };
  }
  return {
    summary: null,
    payments: [],
    arReceipts: [],
    totals: null,
    submittedSnapshot: null,
  };
};

/** Normalize GET /cash-deposit-summaries/:id/payments (payments + live totals + submitted snapshot). */
export const parseCashDepositPaymentsResponse = (res) => {
  const d = res?.data;
  if (d && typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.payments)) {
    return {
      summary: d.summary || null,
      payments: d.payments || [],
      totals: d.totals || null,
      submittedSnapshot: d.submitted_snapshot || null,
    };
  }
  if (Array.isArray(d)) {
    return { payments: d, totals: null, submittedSnapshot: null };
  }
  return { summary: null, payments: [], totals: null, submittedSnapshot: null };
};
