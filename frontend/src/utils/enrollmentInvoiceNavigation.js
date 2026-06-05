import { appConfirm } from './appAlert';

/**
 * After successful class enrollment, ask whether to open the Invoice page.
 *
 * @param {{
 *   invoices: Array<{ student?: object, invoice?: { invoice_id?: number } }>,
 *   invoiceRoute: string,
 *   navigate: (to: string) => void,
 * }} options
 * @returns {Promise<void>}
 */
export async function promptNavigateToEnrollmentInvoice({ invoices, invoiceRoute, navigate }) {
  const created = (invoices || []).filter((item) => item?.invoice?.invoice_id);
  if (!created.length || !invoiceRoute || typeof navigate !== 'function') {
    return;
  }

  const firstId = created[0].invoice.invoice_id;
  const count = created.length;
  const message =
    count === 1
      ? `Enrollment was successful. Invoice INV-${firstId} has been generated. Would you like to go to the Invoice page now?`
      : `Enrollment was successful. ${count} invoice(s) were generated. Would you like to go to the Invoice page now?`;

  const go = await appConfirm({
    title: 'Go to invoice',
    message,
    confirmLabel: 'Yes',
    cancelLabel: 'No',
    variant: 'success',
  });

  if (go) {
    navigate(`${invoiceRoute}?invoice_id=${firstId}`);
  }
}
