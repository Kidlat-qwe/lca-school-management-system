/**
 * Format currency in PHP (Philippine Peso) format
 * @param {number|string} amount - The amount to format
 * @param {Object} options - Formatting options
 * @param {boolean} options.showDecimals - Whether to show decimal places (default: true)
 * @param {number} options.minDecimals - Minimum decimal places (default: 2)
 * @param {number} options.maxDecimals - Maximum decimal places (default: 2)
 * @returns {string} Formatted currency string with ₱ symbol
 */
export const formatCurrency = (amount, options = {}) => {
  const {
    showDecimals = true,
    minDecimals = 2,
    maxDecimals = 2,
  } = options;

  if (amount === null || amount === undefined || amount === '') {
    return '-';
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount)) {
    return '-';
  }

  if (showDecimals) {
    return `₱${numAmount.toLocaleString('en-US', {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
    })}`;
  }

  return `₱${numAmount.toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })}`;
};

/**
 * Format currency with fixed 2 decimal places (common use case)
 * @param {number|string} amount - The amount to format
 * @returns {string} Formatted currency string with ₱ symbol
 */
export const formatCurrencyFixed = (amount) => {
  return formatCurrency(amount, { showDecimals: true, minDecimals: 2, maxDecimals: 2 });
};
