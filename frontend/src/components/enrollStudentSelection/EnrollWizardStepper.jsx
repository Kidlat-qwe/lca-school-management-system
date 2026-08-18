const STEPS = [
  { id: 'student-selection', label: 'Select students' },
  { id: 'merchandise-config', label: 'Configure items' },
  { id: 'review', label: 'Review' },
];

function stepIndex(currentStep) {
  if (currentStep === 'review') return 2;
  if (currentStep === 'merchandise-config') return 1;
  return 0;
}

/**
 * Horizontal 1–2–3 progress for the package enroll wizard.
 */
export default function EnrollWizardStepper({ currentStep, includeConfigure = true }) {
  const steps = includeConfigure ? STEPS : STEPS.filter((s) => s.id !== 'merchandise-config');
  const current = includeConfigure
    ? stepIndex(currentStep)
    : currentStep === 'review'
      ? 1
      : 0;

  return (
    <ol className="flex items-center justify-center gap-2 sm:gap-3 min-w-0">
      {steps.map((step, index) => {
        const complete = index < current;
        const active = index === current;
        return (
          <li key={step.id} className="flex items-center min-w-0">
            {index > 0 ? (
              <span
                className={`hidden sm:block w-8 h-px mr-2 sm:mr-3 ${
                  complete || active ? 'bg-emerald-500' : 'bg-gray-200'
                }`}
              />
            ) : null}
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold flex-shrink-0 ${
                  complete
                    ? 'bg-emerald-500 text-white'
                    : active
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-600'
                }`}
              >
                {complete ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={`hidden md:inline text-xs font-medium truncate ${
                  active ? 'text-gray-900' : complete ? 'text-emerald-700' : 'text-gray-500'
                }`}
              >
                {step.label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
