const num = (value) => Number(value) || 0;

const sumDenominatorParts = (breakdown) =>
  num(breakdown?.new) +
  num(breakdown?.re_enrolled) +
  num(breakdown?.upsell) +
  num(breakdown?.rejoin);

const sumNumeratorParts = (breakdown) =>
  num(breakdown?.re_enrolled) + num(breakdown?.completed);

/**
 * @param {'month'|'phase'} periodType
 * @param {object} row - month_stats or phase_stats row from API
 */
export function formatReEnrollmentRateTooltip(periodType, row) {
  if (!row) return '';

  const isMonth = periodType === 'month';
  const currentLabel = isMonth ? row.month : row.phase;
  const priorLabel = row.prior_period_label || (isMonth ? 'prior month' : 'prior phase');
  const numerator = num(row.re_enrolled_count);
  const denominator = num(
    row.prior_month_enrolled_count ?? row.prior_phase_enrolled_count
  );
  const rate = row.re_enrollment_rate;

  const numBreakdown = row.numerator_breakdown || {
    re_enrolled: numerator,
    completed: 0,
    total: numerator,
  };
  const denBreakdown = row.denominator_breakdown || {
    new: 0,
    re_enrolled: 0,
    upsell: 0,
    rejoin: 0,
    total: denominator,
  };

  const numeratorTotal = num(numBreakdown.total) || sumNumeratorParts(numBreakdown) || numerator;
  const denominatorTotal = num(denBreakdown.total) || sumDenominatorParts(denBreakdown) || denominator;

  const periodWord = isMonth ? 'month' : 'phase';
  const priorWord = isMonth ? 'month' : 'phase';

  const lines = [
    `Rate: ${numeratorTotal}/${denominatorTotal}${
      rate != null ? ` (${Number(rate).toFixed(2)}%)` : ''
    }`,
    '',
    `Numerator — ${currentLabel} (${periodWord}): ${numeratorTotal}`,
    `• Re-enrolled: ${num(numBreakdown.re_enrolled)}`,
    `• Completed: ${num(numBreakdown.completed)}`,
    '',
    `Denominator — ${priorLabel} (previous ${priorWord}): ${denominatorTotal}`,
    `• New: ${num(denBreakdown.new)}`,
    `• Re-enrolled: ${num(denBreakdown.re_enrolled)}`,
    `• Upsell: ${num(denBreakdown.upsell)}`,
    `• Rejoin: ${num(denBreakdown.rejoin)}`,
    '',
    'Upsell counts in the denominator only, not the numerator.',
  ];

  return lines.join('\n');
}

export function formatReEnrollmentRateRowHeaderTooltip(periodType) {
  const periodWord = periodType === 'month' ? 'month' : 'phase';
  return (
    `Re-enrollment rate = numerator + denominator x 100.\n\n` +
    `Numerator: re-enrolled + completed cells in the current ${periodWord} column.\n\n` +
    `Denominator: new + re-enrolled + upsell + rejoin cells from the previous ${periodWord} only.\n\n` +
    `Hover each fraction (e.g. 18/20) for the full count breakdown.`
  );
}
