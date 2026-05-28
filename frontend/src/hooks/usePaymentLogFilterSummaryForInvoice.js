import { useEffect, useMemo, useState } from 'react';
import { DATE_FILTER_MODES } from '../utils/dateFilterModes';
import { issueDateRangeFromManilaMonth } from '../utils/dateUtils';
import { fetchPaymentLogFilterSummary } from '../utils/fetchPaymentLogFilterSummary';

/**
 * Align Invoice header totals with Payment Logs when filtering by payment date
 * (Month picker or Payment date from/to — both use payment_date_from/to on the API).
 */
export function usePaymentLogFilterSummaryForInvoice({
  dateFilterMode,
  filterBranch,
  filterIssueMonth,
  filterPaymentDateFrom,
  filterPaymentDateTo,
}) {
  const [paymentLogSummary, setPaymentLogSummary] = useState(null);

  const isPaymentDateScope =
    dateFilterMode === DATE_FILTER_MODES.PAYMENT_DATE ||
    dateFilterMode === DATE_FILTER_MODES.MONTH;

  const paymentDateRange = useMemo(() => {
    if (dateFilterMode === DATE_FILTER_MODES.MONTH) {
      return issueDateRangeFromManilaMonth(filterIssueMonth);
    }
    if (dateFilterMode === DATE_FILTER_MODES.PAYMENT_DATE) {
      return {
        from: filterPaymentDateFrom || '',
        to: filterPaymentDateTo || '',
      };
    }
    return { from: '', to: '' };
  }, [dateFilterMode, filterIssueMonth, filterPaymentDateFrom, filterPaymentDateTo]);

  useEffect(() => {
    if (!isPaymentDateScope) {
      setPaymentLogSummary(null);
      return undefined;
    }

    const { from: paymentDateFrom, to: paymentDateTo } = paymentDateRange;
    if (!paymentDateFrom && !paymentDateTo) {
      setPaymentLogSummary(null);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const summary = await fetchPaymentLogFilterSummary({
          branchId: filterBranch,
          paymentDateFrom,
          paymentDateTo,
        });
        if (!cancelled) setPaymentLogSummary(summary);
      } catch {
        if (!cancelled) setPaymentLogSummary(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPaymentDateScope, filterBranch, paymentDateRange]);

  return { isPaymentDateScope, paymentLogSummary };
}
