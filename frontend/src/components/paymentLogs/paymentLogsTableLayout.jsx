/**
 * Fixed column widths for payment log tables (responsive horizontal scroll on container only).
 */

export const PAYMENT_LOGS_TABLE_MIN_WIDTH_PX = 2080;

/** Issue date, payment date, updated at — wide enough for "February 28, 2026" + two-line updated at. */
const DATE_COL = 142;
const UPDATED_AT_COL = 158;

/** @type {Record<'main' | 'return', number[]>} */
export const PAYMENT_LOGS_COL_WIDTHS = {
  main: [
    120, // Invoice
    150, // Branch
    DATE_COL, // Issue Date
    DATE_COL, // Payment Date
    UPDATED_AT_COL, // Updated At
    200, // Student Name
    180, // package/item
    130, // Level Tag
    145, // Payment Method
    120, // Amount
    130, // Total Amount
    170, // Status
    160, // Reference
    150, // Acknowledgement Receipt#
    170, // Issued By
  ],
  return: [
    120,
    150,
    DATE_COL,
    DATE_COL,
    UPDATED_AT_COL,
    200,
    180,
    130,
    145,
    120,
    130,
    170, // Status
    145, // Returned/Rejected by
    160, // Reference
    150, // Acknowledgement Receipt#
    170, // Issued By
  ],
};

/**
 * @param {{ variant?: 'main' | 'return' }} props
 */
export function PaymentLogsTableColgroup({ variant = 'main' }) {
  const widths = PAYMENT_LOGS_COL_WIDTHS[variant] || PAYMENT_LOGS_COL_WIDTHS.main;
  return (
    <colgroup>
      {widths.map((width, index) => (
        <col key={index} style={{ width: `${width}px` }} />
      ))}
    </colgroup>
  );
}
