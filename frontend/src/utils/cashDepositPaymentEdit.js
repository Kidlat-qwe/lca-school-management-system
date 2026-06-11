import { isFinanceReturnedSummaryStatus } from './dailySummaryPaymentsParse';

const PAYMENT_METHOD_OPTIONS = ['Cash', 'Online Banking', 'Credit Card', 'E-wallets'];

export function getCashDepositPaymentMethodOptions(currentValue) {
  const c = String(currentValue || '').trim();
  if (!c) return PAYMENT_METHOD_OPTIONS;
  if (PAYMENT_METHOD_OPTIONS.includes(c)) return PAYMENT_METHOD_OPTIONS;
  return [c, ...PAYMENT_METHOD_OPTIONS];
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
