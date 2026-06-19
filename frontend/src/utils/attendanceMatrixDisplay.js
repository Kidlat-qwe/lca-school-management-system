/** Symbols and styles for phase attendance matrix cells. */

export const ATTENDANCE_MATRIX_STATUSES = [
  'Present',
  'Absent',
  'Late',
  'Excused',
  'Leave Early',
];

export const ATTENDANCE_MATRIX_LEGEND = [
  { status: 'Present', symbol: '✓', label: 'Present', className: 'text-green-700 bg-green-50' },
  { status: 'Absent', symbol: '✗', label: 'Absent', className: 'text-red-700 bg-red-50' },
  { status: 'Late', symbol: 'L', label: 'Late', className: 'text-amber-700 bg-amber-50' },
  { status: 'Excused', symbol: 'E', label: 'Excused', className: 'text-blue-700 bg-blue-50' },
  {
    status: 'Leave Early',
    symbol: '↘',
    label: 'Leave Early',
    className: 'text-purple-700 bg-purple-50',
  },
  { status: null, symbol: '—', label: 'Not marked', className: 'text-gray-400 bg-gray-50' },
];

const SYMBOL_BY_STATUS = ATTENDANCE_MATRIX_LEGEND.reduce((acc, item) => {
  if (item.status) acc[item.status] = item;
  return acc;
}, {});

export const getAttendanceMatrixSymbol = (status) => {
  if (!status) return SYMBOL_BY_STATUS[null] || ATTENDANCE_MATRIX_LEGEND.at(-1);
  return SYMBOL_BY_STATUS[status] || { symbol: '?', className: 'text-gray-600 bg-gray-100', label: status };
};
