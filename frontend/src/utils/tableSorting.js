export const toggleSortConfig = (currentSort, key) => {
  if (!currentSort || currentSort.key !== key) {
    return { key, direction: 'asc' };
  }

  return {
    key,
    direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
  };
};

const getPathValue = (row, path) =>
  String(path)
    .split('.')
    .reduce((value, part) => (value == null ? value : value[part]), row);

const normalizeSortValue = (value, type) => {
  if (value == null) return '';

  if (type === 'date') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (type === 'number') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return String(value).trim().toLowerCase();
};

export const sortRows = (rows, sortConfig, sortAccessors = {}) => {
  if (!sortConfig?.key) return rows;

  const sortMeta = sortAccessors[sortConfig.key] || sortConfig.key;
  const accessor = typeof sortMeta === 'function' ? sortMeta : sortMeta.accessor || sortConfig.key;
  const type = typeof sortMeta === 'object' && sortMeta.type ? sortMeta.type : 'string';
  const directionMultiplier = sortConfig.direction === 'desc' ? -1 : 1;

  return [...rows].sort((a, b) => {
    const aRaw = typeof accessor === 'function' ? accessor(a) : getPathValue(a, accessor);
    const bRaw = typeof accessor === 'function' ? accessor(b) : getPathValue(b, accessor);
    const aValue = normalizeSortValue(aRaw, type);
    const bValue = normalizeSortValue(bRaw, type);

    if (aValue < bValue) return -1 * directionMultiplier;
    if (aValue > bValue) return 1 * directionMultiplier;
    return 0;
  });
};
