const num = (value) => Number(value) || 0;

const sumDenominatorParts = (breakdown) =>
  num(breakdown?.new) +
  num(breakdown?.re_enrolled) +
  num(breakdown?.upsell) +
  num(breakdown?.rejoin) +
  num(breakdown?.completed);

const sumNumeratorParts = (breakdown) =>
  num(breakdown?.re_enrolled) + num(breakdown?.completed) + num(breakdown?.active);

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
    active: 0,
    total: numerator,
  };
  const denBreakdown = row.denominator_breakdown || {
    new: 0,
    re_enrolled: 0,
    upsell: 0,
    rejoin: 0,
    completed: 0,
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
    `• Active: ${num(numBreakdown.active)}`,
    `• Completed (with prior new/re-enrolled/rejoin): ${num(numBreakdown.completed)}`,
    '',
    `Denominator — ${priorLabel} (previous ${priorWord}): ${denominatorTotal}`,
    `• New: ${num(denBreakdown.new)}`,
    `• Re-enrolled: ${num(denBreakdown.re_enrolled)}`,
    `• Upsell: ${num(denBreakdown.upsell)}`,
    `• Rejoin: ${num(denBreakdown.rejoin)}`,
    `• Completed (with prior new/re-enrolled/rejoin): ${num(denBreakdown.completed)}`,
    '',
    'Active counts in the numerator; Inactive does not. Completed counts in either side only when that same student already had a prior new, re-enrolled, or rejoin cell — standalone completed is excluded.',
  ];

  return lines.join('\n');
}

export function formatReEnrollmentRateRowHeaderTooltip(periodType) {
  const periodWord = periodType === 'month' ? 'month' : 'phase';
  return (
    `Re-enrollment rate = numerator ÷ denominator × 100.\n\n` +
    `Numerator: re-enrolled + Active + completed (completed only when that student already had a prior new, re-enrolled, or rejoin) in the current ${periodWord} column. Inactive is excluded.\n\n` +
    `Denominator: new + re-enrolled + upsell + rejoin + completed (completed only with a prior new, re-enrolled, or rejoin) cells from the previous ${periodWord} only.\n\n` +
    `Hover each fraction (e.g. 18/20) for the full count breakdown.`
  );
}
