import React from 'react';

export const getPaginationRange = (page, totalItems, itemsPerPage) => {
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const startItem = totalItems === 0 ? 0 : (safePage - 1) * itemsPerPage + 1;
  const endItem = Math.min(safePage * itemsPerPage, totalItems);
  return { startItem, endItem, safePage };
};

export const TablePaginationSummary = ({
  page,
  totalItems,
  itemsPerPage,
  itemLabel = 'items',
  className = '',
}) => {
  if (!totalItems) return null;

  const { startItem, endItem } = getPaginationRange(page, totalItems, itemsPerPage);

  return (
    <div className={`text-xs sm:text-sm text-gray-600 ${className}`.trim()}>
      Showing{' '}
      <span className="font-medium">
        {startItem.toLocaleString()} - {endItem.toLocaleString()}
      </span>{' '}
      of{' '}
      <span className="font-medium">{totalItems.toLocaleString()}</span>{' '}
      {itemLabel}
    </div>
  );
};

const FixedTablePagination = ({
  page,
  totalPages,
  totalItems,
  itemsPerPage,
  itemLabel = 'items',
  onPageChange,
}) => {
  const { safePage } = getPaginationRange(page, totalItems, itemsPerPage);
  const safeTotalPages = Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1;

  const handleChangePage = (nextPage) => {
    const clamped = Math.min(Math.max(nextPage, 1), safeTotalPages);
    if (clamped !== safePage && typeof onPageChange === 'function') {
      onPageChange(clamped);
    }
  };

  if (!totalItems || safeTotalPages <= 1) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
      <TablePaginationSummary
        page={safePage}
        totalItems={totalItems}
        itemsPerPage={itemsPerPage}
        itemLabel={itemLabel}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleChangePage(safePage - 1)}
          disabled={safePage <= 1}
          className="px-2.5 py-1.5 text-xs sm:text-sm rounded-md border border-gray-300 bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Previous
        </button>
        <span className="text-xs sm:text-sm text-gray-700">
          Page{' '}
          <span className="font-semibold">
            {safePage}
          </span>{' '}
          of{' '}
          <span className="font-semibold">
            {safeTotalPages}
          </span>
        </span>
        <button
          type="button"
          onClick={() => handleChangePage(safePage + 1)}
          disabled={safePage >= safeTotalPages}
          className="px-2.5 py-1.5 text-xs sm:text-sm rounded-md border border-gray-300 bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default FixedTablePagination;
