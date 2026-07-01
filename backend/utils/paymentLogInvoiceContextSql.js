/**
 * Extra invoice fields for payment log list/detail queries (partial-payment context).
 * @module utils/paymentLogInvoiceContextSql
 */

/** SELECT fragment — append after i.invoice_description (and invoice_status when present). */
export const PAYMENT_LOG_INVOICE_CONTEXT_SELECT = `
                        i.parent_invoice_id,
                        i.balance_invoice_id,
                        i.remarks AS invoice_remarks,
                        i.installmentinvoiceprofiles_id,
                        ip.description AS installment_profile_description,
                        ip.downpayment_invoice_id AS installment_downpayment_invoice_id`;

/** Use when the query does not already select i.status AS invoice_status. */
export const PAYMENT_LOG_INVOICE_STATUS_SELECT = `i.status AS invoice_status,`;

/** JOIN fragment — after LEFT JOIN invoicestbl i. */
export const PAYMENT_LOG_INVOICE_CONTEXT_JOIN = `
                 LEFT JOIN installmentinvoiceprofilestbl ip ON i.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id`;
