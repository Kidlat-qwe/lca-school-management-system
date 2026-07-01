const SortIcon = ({ active, direction }) => {
  const isAsc = active && direction === 'asc';
  const isDesc = active && direction === 'desc';

  return (
    <span className="ml-1 inline-flex flex-col items-center justify-center leading-none text-[9px]" aria-hidden="true">
      <span className={isAsc ? 'text-gray-700' : 'text-gray-400'}>▲</span>
      <span className={isDesc ? 'text-gray-700' : 'text-gray-400'}>▼</span>
    </span>
  );
};

export { SortIcon };

const SortableHeader = ({
  label,
  sortKey,
  sortConfig,
  onSort,
  className = '',
  style,
  align = 'left',
  children,
}) => {
  const active = sortConfig?.key === sortKey;
  const justifyClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  const ariaSort = active ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th className={className} style={style} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex w-full items-center gap-1 text-left uppercase ${justifyClass}`}
      >
        <span>{children || label}</span>
        <SortIcon active={active} direction={sortConfig?.direction} />
      </button>
    </th>
  );
};

export default SortableHeader;
