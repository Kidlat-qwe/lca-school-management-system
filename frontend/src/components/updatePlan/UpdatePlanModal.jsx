import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiRequest } from '../../config/api';

const formatMoney = (value) =>
  `₱${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const isInstallmentLike = (pkg) =>
  pkg?.package_type === 'Installment' ||
  (pkg?.package_type === 'Phase' && pkg?.payment_option === 'Installment');

const packageDetailCount = (details = []) =>
  Array.isArray(details) ? details.length : 0;

/**
 * Multi-step Update Plan modal:
 * 1) Select package (enroll-style package cards)
 * 2) Promo code + plan change breakdown (payments credited) → confirm
 */
export default function UpdatePlanModal({
  open,
  student,
  sourceClass,
  packages = [],
  loadingPackages = false,
  selectedPackage = null,
  preview = null,
  loadingPreview = false,
  submitting = false,
  onClose,
  onSelectPackage,
  onBackToPackages,
  onConfirm,
}) {
  const [step, setStep] = useState('package-selection');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [validatedPromo, setValidatedPromo] = useState(null);
  const [promoError, setPromoError] = useState('');
  const [validatingPromo, setValidatingPromo] = useState(false);
  const promoTimeoutRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setStep('package-selection');
      setPromoCodeInput('');
      setValidatedPromo(null);
      setPromoError('');
      setValidatingPromo(false);
      if (promoTimeoutRef.current) {
        clearTimeout(promoTimeoutRef.current);
        promoTimeoutRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (promoTimeoutRef.current) clearTimeout(promoTimeoutRef.current);
    };
  }, []);

  const currentPackageId = Number(student?.current_package_id || 0);

  const selectablePackages = useMemo(
    () =>
      (packages || []).filter(
        (pkg) => !(currentPackageId > 0 && Number(pkg.package_id) === currentPackageId)
      ),
    [packages, currentPackageId]
  );

  const validatePromoCode = async (code, packageId, studentId) => {
    if (!code || !String(code).trim()) {
      setValidatedPromo(null);
      setPromoError('');
      if (selectedPackage) {
        onSelectPackage?.(selectedPackage, { promo_id: null, promo_code: null });
      }
      return;
    }
    if (!packageId) return;

    try {
      setValidatingPromo(true);
      setPromoError('');
      const payload = {
        promo_code: String(code).trim().toUpperCase(),
        package_id: packageId,
      };
      if (studentId) payload.student_id = studentId;

      const response = await apiRequest('/promos/validate-code', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (response.success && response.data) {
        setValidatedPromo(response.data);
        setPromoError('');
        onSelectPackage?.(selectedPackage, {
          promo_id: response.data.promo_id,
          promo_code: String(code).trim().toUpperCase(),
        });
      } else {
        setValidatedPromo(null);
        setPromoError(response.message || 'Invalid promo code');
        onSelectPackage?.(selectedPackage, { promo_id: null, promo_code: null });
      }
    } catch (err) {
      setValidatedPromo(null);
      setPromoError(err.message || 'Failed to validate promo code');
      onSelectPackage?.(selectedPackage, { promo_id: null, promo_code: null });
    } finally {
      setValidatingPromo(false);
    }
  };

  const handlePackageCardClick = (pkg) => {
    if (currentPackageId > 0 && Number(pkg.package_id) === currentPackageId) return;
    setPromoCodeInput('');
    setValidatedPromo(null);
    setPromoError('');
    setStep('breakdown');
    onSelectPackage?.(pkg, { promo_id: null, promo_code: null });
  };

  const handleBack = () => {
    setPromoCodeInput('');
    setValidatedPromo(null);
    setPromoError('');
    setStep('package-selection');
    onBackToPackages?.();
  };

  const handleConfirm = () => {
    onConfirm?.({
      promo_id: validatedPromo?.promo_id || null,
      promo_code: promoCodeInput.trim() ? promoCodeInput.trim().toUpperCase() : null,
    });
  };

  if (!open || !student || !sourceClass) return null;

  const confirmLabel = (() => {
    if (submitting) return 'Processing...';
    if (preview?.change_type === 'installment_to_fullpayment' && preview?.difference === 0) {
      return 'Convert to Full Payment';
    }
    if (preview?.change_type === 'installment_to_fullpayment') {
      return 'Create Conversion Invoice';
    }
    return 'Create Adjustment Invoice';
  })();

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/5 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Update Plan</h2>
            <p className="mt-1 text-sm text-gray-500">
              {step === 'package-selection'
                ? 'Select a target package. Prior payments (downpayment, reservation, phases) will be credited.'
                : 'Optional promo code, then review credits and the amount to invoice.'}
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs font-medium text-gray-500">
              <span
                    className={`rounded-full px-2.5 py-1 ${
                  step === 'package-selection'
                    ? 'bg-[#F7C844] text-gray-900'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                1. Select package
              </span>
              <span className="text-gray-300">→</span>
              <span
                className={`rounded-full px-2.5 py-1 ${
                  step === 'breakdown' ? 'bg-[#F7C844] text-gray-900' : 'bg-gray-100 text-gray-600'
                }`}
              >
                2. Promo &amp; breakdown
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 transition-colors hover:text-gray-500"
            aria-label="Close"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="text-sm text-gray-900">
              <span className="font-semibold">{student.full_name}</span>
              <span className="text-gray-500">
                {' '}
                · {sourceClass.class_name || sourceClass.level_tag}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Installment-to-installment updates recurring billing. Full payment conversion enrolls
              all target phases and stops installment invoices after settlement.
            </div>
          </div>

          {step === 'package-selection' && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="mb-1 text-lg font-bold text-gray-900">Select a Package</h3>
                <p className="text-sm text-gray-500">
                  Choose the installment or full payment package to switch to
                </p>
              </div>

              {loadingPackages ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
                </div>
              ) : selectablePackages.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-10 text-center">
                  <p className="text-sm font-medium text-gray-500">No packages available</p>
                  <p className="mt-1 text-xs text-gray-400">
                    No installment or full payment packages found for this branch/level.
                  </p>
                </div>
              ) : (
                <div
                  className="max-h-[420px] space-y-3 overflow-y-auto pr-2"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e0 #f7fafc' }}
                >
                  {selectablePackages.map((pkg) => (
                    <button
                      key={pkg.package_id}
                      type="button"
                      onClick={() => handlePackageCardClick(pkg)}
                      className="group w-full rounded-xl border-2 border-gray-200 bg-white p-5 text-left transition-all duration-200 hover:border-[#F7C844] hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#F7C844] focus:ring-offset-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex items-center space-x-2">
                            <div className="h-2 w-2 rounded-full bg-[#F7C844] opacity-0 transition-opacity group-hover:opacity-100" />
                            <h5 className="truncate text-base font-bold text-gray-900 transition-colors group-hover:text-[#F7C844]">
                              {pkg.package_name}
                            </h5>
                            {isInstallmentLike(pkg) && (
                              <span className="inline-flex items-center rounded border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                Installment
                              </span>
                            )}
                            {pkg.package_type === 'Fullpayment' && (
                              <span className="inline-flex items-center rounded border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                                Full payment
                              </span>
                            )}
                          </div>
                          {pkg.package_price != null && (
                            <div className="mb-2 flex flex-col space-y-1">
                              {isInstallmentLike(pkg) ? (
                                <>
                                  {pkg.downpayment_amount != null &&
                                    parseFloat(pkg.downpayment_amount) > 0 && (
                                      <div className="flex items-baseline space-x-2">
                                        <span className="text-sm text-gray-600">Down payment:</span>
                                        <span className="text-lg font-bold text-gray-900">
                                          {formatMoney(pkg.downpayment_amount)}
                                        </span>
                                      </div>
                                    )}
                                  <div className="flex items-baseline space-x-2">
                                    <span className="text-sm text-gray-600">Monthly:</span>
                                    <span className="text-lg font-bold text-gray-900">
                                      {formatMoney(pkg.package_price)}
                                    </span>
                                  </div>
                                </>
                              ) : (
                                <div className="flex items-baseline space-x-2">
                                  <span className="text-xl font-bold text-gray-900">
                                    {formatMoney(pkg.package_price)}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                          {pkg.level_tag ? (
                            <p className="text-xs text-gray-500">Level: {pkg.level_tag}</p>
                          ) : null}
                          {packageDetailCount(pkg.details) > 0 && (
                            <div className="mt-3 flex items-center space-x-2">
                              <svg
                                className="h-4 w-4 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                                />
                              </svg>
                              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
                                {packageDetailCount(pkg.details)} item
                                {packageDetailCount(pkg.details) !== 1 ? 's' : ''} included
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="ml-4 flex-shrink-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 transition-colors group-hover:bg-[#F7C844]">
                            <svg
                              className="h-5 w-5 text-gray-600 transition-colors group-hover:text-white"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'breakdown' && (
            <div className="space-y-4">
              {selectedPackage && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h4 className="text-sm font-semibold text-amber-900">Selected package</h4>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                      {selectedPackage.package_name}
                    </span>
                    <span className="inline-flex items-center rounded-md border border-amber-200 bg-white/80 px-2.5 py-1 text-xs font-medium text-amber-900">
                      {selectedPackage.package_type || 'Package'}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="update-plan-promo-code"
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Promo code <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <div className="relative">
                  <input
                    id="update-plan-promo-code"
                    type="text"
                    value={promoCodeInput}
                    disabled={!selectedPackage || loadingPreview || submitting}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase();
                      setPromoCodeInput(value);
                      if (promoTimeoutRef.current) clearTimeout(promoTimeoutRef.current);
                      if (!value.trim()) {
                        setValidatedPromo(null);
                        setPromoError('');
                        if (selectedPackage) {
                          onSelectPackage?.(selectedPackage, {
                            promo_id: null,
                            promo_code: null,
                          });
                        }
                        return;
                      }
                      promoTimeoutRef.current = setTimeout(() => {
                        validatePromoCode(
                          value,
                          selectedPackage?.package_id,
                          student?.user_id
                        );
                      }, 500);
                    }}
                    onBlur={() => {
                      if (promoCodeInput.trim()) {
                        validatePromoCode(
                          promoCodeInput,
                          selectedPackage?.package_id,
                          student?.user_id
                        );
                      }
                    }}
                    placeholder="Enter promo code"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase focus:border-[#F7C844] focus:outline-none focus:ring-2 focus:ring-[#F7C844]"
                  />
                  {validatingPromo && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#F7C844]" />
                    </div>
                  )}
                </div>
                {promoError ? <p className="mt-1 text-sm text-red-600">{promoError}</p> : null}
                {validatedPromo && !promoError ? (
                  <p className="mt-1 text-sm text-green-600">
                    Valid promo: {validatedPromo.promo_name}
                  </p>
                ) : null}
              </div>

              {loadingPreview && (
                <div className="flex items-center justify-center py-10">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500" />
                </div>
              )}

              {!loadingPreview && preview && (
                <div className="space-y-4">
                  <div
                    className={`rounded-lg border px-4 py-3 ${
                      preview.allowed
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-amber-200 bg-amber-50'
                    }`}
                  >
                    <p
                      className={`text-sm font-medium ${
                        preview.allowed ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {preview.message}
                    </p>
                  </div>

                  {preview.current_package && preview.target_package && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-lg border border-gray-200 p-4">
                        <h3 className="mb-3 text-sm font-semibold text-gray-900">Current package</h3>
                        <div className="space-y-2 text-sm text-gray-600">
                          <div className="flex items-center justify-between gap-4">
                            <span>Package</span>
                            <span className="text-right font-medium text-gray-900">
                              {preview.current_package.package_name}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span>Downpayment</span>
                            <span className="font-medium text-gray-900">
                              {formatMoney(preview.current_package.downpayment_amount)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span>Recurring amount</span>
                            <span className="font-medium text-gray-900">
                              {formatMoney(preview.current_package.recurring_amount)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-200 p-4">
                        <h3 className="mb-3 text-sm font-semibold text-gray-900">Target package</h3>
                        <div className="space-y-2 text-sm text-gray-600">
                          <div className="flex items-center justify-between gap-4">
                            <span>Package</span>
                            <span className="text-right font-medium text-gray-900">
                              {preview.target_package.package_name}
                            </span>
                          </div>
                          {preview.change_type === 'installment_to_fullpayment' ? (
                            <>
                              <div className="flex items-center justify-between gap-4">
                                <span>Full payment price</span>
                                <span className="font-medium text-gray-900">
                                  {formatMoney(preview.target_package.full_payment_price)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span>Enrollment after conversion</span>
                                <span className="text-right font-medium text-gray-900">
                                  Phases {preview.target_phase_start}–{preview.target_phase_end}
                                </span>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between gap-4">
                                <span>Downpayment</span>
                                <span className="font-medium text-gray-900">
                                  {formatMoney(preview.target_package.downpayment_amount)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-4">
                                <span>Recurring amount</span>
                                <span className="font-medium text-gray-900">
                                  {formatMoney(preview.target_package.recurring_amount)}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-gray-200 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-gray-900">
                      Update plan breakdown
                    </h3>
                    <div className="space-y-2 text-sm text-gray-600">
                      {preview.change_type === 'installment_to_fullpayment' ? (
                        <>
                          <div className="flex items-center justify-between gap-4">
                            <span>Current installment scope</span>
                            <span className="font-medium text-gray-900">
                              Phases {preview.current_phase_start}–{preview.current_phase_end}
                            </span>
                          </div>
                          {(preview.reservation_fee_credited ?? 0) > 0 && (
                            <div className="flex items-center justify-between gap-4">
                              <span>Reservation fee credited</span>
                              <span className="font-medium text-emerald-700">
                                −{formatMoney(preview.reservation_fee_credited)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-4">
                            <span>Downpayment &amp; phase payments credited</span>
                            <span className="font-medium text-emerald-700">
                              −
                              {formatMoney(
                                preview.installment_payments_credited ?? preview.credit_total
                              )}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4 border-t border-gray-100 pt-2">
                            <span className="font-medium text-gray-800">
                              Total payments credited
                            </span>
                            <span className="font-semibold text-emerald-700">
                              −{formatMoney(preview.credit_total)}
                            </span>
                          </div>
                          {(preview.penalty_paid_not_credited ?? 0) > 0 && (
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-gray-500">
                                Late penalties paid (not credited)
                              </span>
                              <span className="font-medium text-gray-500">
                                {formatMoney(preview.penalty_paid_not_credited)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-4">
                            <span>Full payment package price</span>
                            <span className="font-medium text-gray-900">
                              {formatMoney(preview.target_full_price)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-4">
                            <span>Paid recurring phases</span>
                            <span className="font-medium text-gray-900">
                              {preview.recurring_paid_count ?? 0}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span>Current payments credited</span>
                            <span className="font-medium text-emerald-700">
                              −{formatMoney(preview.current_paid_total)}
                            </span>
                          </div>
                          {(preview.penalty_paid_not_credited ?? 0) > 0 && (
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-gray-500">
                                Late penalties paid (not credited)
                              </span>
                              <span className="font-medium text-gray-500">
                                {formatMoney(preview.penalty_paid_not_credited)}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-4">
                            <span>Target package equivalent total</span>
                            <span className="font-medium text-gray-900">
                              {formatMoney(preview.target_equivalent_total)}
                            </span>
                          </div>
                        </>
                      )}

                      {(preview.promo_discount ?? 0) > 0 && (
                        <div className="flex items-center justify-between gap-4">
                          <span>
                            Promo discount
                            {preview.promo?.promo_name ? ` (${preview.promo.promo_name})` : ''}
                          </span>
                          <span className="font-medium text-emerald-700">
                            −{formatMoney(preview.promo_discount)}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-2">
                        <span className="font-semibold text-gray-900">
                          {preview.change_type === 'installment_to_fullpayment' &&
                          preview.difference === 0
                            ? 'Balance due'
                            : 'Additional amount to invoice'}
                        </span>
                        <span
                          className={`font-semibold ${
                            preview.difference > 0 ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {formatMoney(preview.difference)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
          {step === 'breakdown' ? (
            <button
              type="button"
              onClick={handleBack}
              disabled={submitting}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
            >
              Close
            </button>
          )}

          {step === 'breakdown' && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!preview?.allowed || !selectedPackage || submitting || validatingPromo}
              className="rounded-lg bg-[#F7C844] px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-[#F5B82E] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
