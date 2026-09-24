/**
 * UpsellLowerChoiceStep
 *
 * Enroll-wizard step shown when a student being enrolled into a higher-level
 * class already has an active enrollment in a lower-level class with an
 * installment plan.
 *
 * Staff choose per student:
 *   - Continue lower billing   (default — nothing changes in the lower class)
 *   - Stop lower billing + unenroll (unenrolls, deactivates plan, cancels pending invoices)
 *
 * Used by superadmin/Classes.jsx and admin/adminClasses.jsx.
 */

import React from 'react';

/**
 * @typedef {{ class_id: number, class_name: string, level_tag: string, has_installment: boolean }} LowerClass
 *
 * @param {{
 *   students: Array<{ user_id: number, full_name: string }>,
 *   lowerProgramMap: Record<number, LowerClass[]>,
 *   choices: Record<number, 'continue' | 'stop'>,
 *   onChoiceChange: (studentId: number, value: 'continue' | 'stop') => void,
 *   onBack: () => void,
 *   onContinue: () => void,
 * }} props
 */
export default function UpsellLowerChoiceStep({
  students = [],
  lowerProgramMap = {},
  choices = {},
  onChoiceChange,
  onBack,
  onContinue,
}) {
  // Only show rows for students that actually have lower-program data
  const relevantStudents = students.filter(
    (s) => (lowerProgramMap[s.user_id] ?? []).length > 0
  );

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* ---- Header ---- */}
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-gray-800">
          Lower-Program Enrollment Detected
        </h3>
        <p className="text-sm text-gray-500">
          The student(s) below are currently enrolled in a lower-level class.
          Choose whether to keep that enrollment and billing active, or stop it
          as part of this upsell.
        </p>
      </div>

      {/* ---- Student cards ---- */}
      <div className="flex flex-col gap-3">
        {relevantStudents.map((student) => {
          const lowerClasses = lowerProgramMap[student.user_id] ?? [];
          const choice = choices[student.user_id] ?? 'continue';

          return (
            <div
              key={student.user_id}
              className="rounded-lg border border-gray-200 bg-white overflow-hidden"
            >
              {/* Student name bar */}
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
                <p className="text-sm font-medium text-gray-700">{student.full_name}</p>
              </div>

              {/* Lower-class table */}
              <div
                className="overflow-x-auto"
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#cbd5e0 #f7fafc',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <table style={{ width: '100%', minWidth: '420px' }} className="text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                      <th className="px-4 py-2 text-left font-semibold">Current Class</th>
                      <th className="px-4 py-2 text-left font-semibold">Level</th>
                      <th className="px-4 py-2 text-center font-semibold">Installment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowerClasses.map((lc) => (
                      <tr key={lc.class_id} className="border-t border-gray-100">
                        <td className="px-4 py-2 text-gray-800">{lc.class_name}</td>
                        <td className="px-4 py-2 text-gray-600">{lc.level_tag}</td>
                        <td className="px-4 py-2 text-center">
                          {lc.has_installment ? (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                              Active plan
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                              None
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Choice buttons */}
              <div className="px-4 py-3 flex flex-col sm:flex-row gap-2">
                {/* Continue */}
                <button
                  type="button"
                  onClick={() => onChoiceChange(student.user_id, 'continue')}
                  className={`flex-1 flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus:outline-none ${
                    choice === 'continue'
                      ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-400'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      choice === 'continue'
                        ? 'border-emerald-500'
                        : 'border-gray-300'
                    }`}
                  >
                    {choice === 'continue' && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    )}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-gray-800">
                      Continue{' '}
                      {lowerClasses.length === 1 ? lowerClasses[0].level_tag : 'lower-level'} billing
                    </span>
                    <span className="text-xs text-gray-500 mt-0.5">
                      Student remains enrolled in the lower-level class. All billing stays active.
                    </span>
                  </span>
                </button>

                {/* Stop */}
                <button
                  type="button"
                  onClick={() => onChoiceChange(student.user_id, 'stop')}
                  className={`flex-1 flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus:outline-none ${
                    choice === 'stop'
                      ? 'border-red-400 bg-red-50 ring-1 ring-red-400'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      choice === 'stop' ? 'border-red-500' : 'border-gray-300'
                    }`}
                  >
                    {choice === 'stop' && (
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                    )}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-gray-800">
                      Stop{' '}
                      {lowerClasses.length === 1 ? lowerClasses[0].level_tag : 'lower-level'} billing + unenroll
                    </span>
                    <span className="text-xs text-gray-500 mt-0.5">
                      Student will be unenrolled from the lower-level class. Future installment
                      invoices will be stopped and pending unpaid invoices will be cancelled.
                    </span>
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- Navigation ---- */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
