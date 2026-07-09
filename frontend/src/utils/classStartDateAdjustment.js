/**
 * Helpers for class start date adjustment (edit-class inline flow).
 */

export const classNeedsStartDateWizard = (classItem) =>
  Number(classItem?.enrolled_students ?? 0) > 0 ||
  Boolean(classItem?.has_installment_billing);

export const isStartDateChanged = (originalStartDate, nextStartDate) => {
  const original = originalStartDate ? String(originalStartDate).slice(0, 10) : '';
  const next = nextStartDate ? String(nextStartDate).slice(0, 10) : '';
  return Boolean(original && next && original !== next);
};
