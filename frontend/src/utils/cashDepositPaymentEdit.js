import { resolvePaymentMethodOptions } from '../constants/paymentFormLabels';
import { isFinanceReturnedSummaryStatus } from './dailySummaryPaymentsParse';

/** @deprecated Use resolvePaymentMethodOptions from paymentFormLabels */
export function getCashDepositPaymentMethodOptions(currentValue) {
  return resolvePaymentMethodOptions(currentValue);
}

/** Branch Admin / Superadmin may fix payment lines while a cash deposit is returned. */
export function canEditCashDepositPayments({ userType, depositStatus }) {
  if (!isFinanceReturnedSummaryStatus(depositStatus)) return false;
  const ut = String(userType || '').trim();
  return ut === 'Admin' || ut === 'Superadmin';
}

export function canEditCashDepositPaymentLine({ userType, depositStatus, payment }) {
  if (!payment?.payment_id || !payment?.invoice_id) return false;
  return canEditCashDepositPayments({ userType, depositStatus });
}
