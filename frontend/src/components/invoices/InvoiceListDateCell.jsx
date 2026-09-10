/**
 * Invoice list date cell with ellipsis when the formatted date is wider than the column.
 * Full value remains available via native title tooltip on hover.
 */
export default function InvoiceListDateCell({
  text,
  className = 'px-6 py-4 align-middle overflow-hidden',
  style = { width: '120px', minWidth: '120px', maxWidth: '120px' },
}) {
  const display = text == null || text === '' ? '-' : String(text);
  const showTitle = display !== '-' && display !== '—';

  return (
    <td className={className} style={style}>
      <div
        className="text-sm text-gray-900 truncate tabular-nums"
        title={showTitle ? display : undefined}
      >
        {display}
      </div>
    </td>
  );
}
