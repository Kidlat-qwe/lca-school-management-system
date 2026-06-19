/**
 * Rate header cell: fraction and percentage only (breakdown tooltip lives on row label).
 */
const ReEnrollmentRateMatrixCell = ({ row }) => {
  const denominator = Number(
    row?.prior_month_enrolled_count ?? row?.prior_phase_enrolled_count ?? 0
  );
  const numerator = Number(row?.re_enrolled_count ?? 0);
  const hasPrior = Boolean(row?.has_prior_month || row?.has_prior_phase);

  if (!hasPrior) {
    return <div className="text-[11px] tabular-nums text-gray-500">—</div>;
  }

  if (denominator > 0) {
    return (
      <>
        <div className="text-[11px] font-semibold tabular-nums text-gray-900">
          {numerator}/{denominator}
        </div>
        <div className="text-[11px] tabular-nums text-amber-800">
          {Number(row.re_enrollment_rate ?? 0).toFixed(2)}%
        </div>
      </>
    );
  }

  if (numerator > 0) {
    return (
      <div className="text-[11px] font-semibold tabular-nums text-gray-900">
        {numerator}/—
      </div>
    );
  }

  return <div className="text-[11px] tabular-nums text-gray-500">—</div>;
};

export default ReEnrollmentRateMatrixCell;
