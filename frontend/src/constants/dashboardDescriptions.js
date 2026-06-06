/**
 * Short, user-friendly helper text for dashboard stat cards and charts.
 * Wording is shared across role-specific dashboard pages where metrics match.
 */

export const DASHBOARD_DATE_NOTE = 'Dates use Philippine time (Asia/Manila).';

export const DAILY_OPERATIONAL = {
  pageIntro:
    'A snapshot of one day: new enrollments, drops, sales, merchandise, and finance checks for the date you pick.',
  branchHintSuperadmin: 'Pick a branch from the menu at the top to see one location only.',
  branchHintAdmin: 'Numbers are limited to your assigned branch.',
  newEnrolleesReenroll:
    'Each completed class-related invoice payment on this date (payment issue date). Full-payment invoices count once per enrolled phase (same rules as the month matrix): e.g. full pay phases 1–5 → 1 new, 3 re-enrolled, 1 completed. Installment phase-events count only when the invoice is Paid (partial payments on Partially Paid invoices are excluded until settled). New enrollees = first phase only when truly first-time. Re-enrollment KPI includes re_enrolled, upsell, and multi-phase completed (single-phase completed counts only under Completed).',
  droppedRejoin:
    'Rejoin = completed class payments on this date with program_enrollment_status rejoin. Dropped / unenrolled = students removed on this date (removed_at), status dropped on classstudentstbl.',
  reservedUpsell:
    'Reserved = reservation-fee payments on this date with program_enrollment_status reserved. Upsell = class payments with status upsell (level-up / package change).',
  completedEnrollment:
    'Completed = terminal phase on a multi-phase full payment (e.g. phase 5 on full pay 1–5), a completed phase row, or a single-phase class (1 phase only) whose package is fully paid on this date. Retention base = student+class tracks with enrolled class payments on the previous calendar day (payment issue date).',
  completedRetentionCombined:
    'Completed counts terminal/single-phase-finished payments on this date. Retention base is the prior-day cohort (tracks with new, re_enrolled, upsell, rejoin, or completed payments yesterday) — same idea as the month matrix rate denominator.',
  merchandiseSection: 'Merchandise releases for the selected date',
  recentMerchandiseReleases:
    'Stock release log lines for this date (package first payment + merchandise AR). Shows three rows at a time; scroll for more.',
  financialSection: 'Sales summary for the selected date',
  invoiceSales:
    'Total from completed invoice payments on this date (amount due + tips). Returned and rejected payments are excluded.',
  arSales: (receiptCount) =>
    `${receiptCount} acknowledgement receipt(s) on this date — matches the main Acknowledgement Receipt list for the same day.`,
  combinedSales:
    'Invoice sales use payment issue date. AR sales match the Acknowledgement Receipt list for the same day.',
  totalPayments:
    'Invoice sales plus acknowledgement receipt sales for this date (same scope as the two lines above).',
  merchandise: (txnCount) =>
    `${txnCount} release event(s) (merchandise AR + package items on first payment). Quantity is total units (e.g. uniform top + bottom = 2). Re-enroll does not count again.`,
  enrollmentRate: (enrolled, total) =>
    `${enrolled} active phase enrollments across phases ÷ ${total} cohort student(s) on this date × 100. Rate is by program phase (not the same as “new enrollees” above).`,
  reEnrollmentRate: (retained, prior, scopeLabel = 'this date') =>
    `Re-enrollment rate for ${scopeLabel}: ${retained} Re-enrollment KPI count (same as the card) ÷ ${prior} retention base (student+class tracks with enrolled payments yesterday) × 100.`,
  salesPaymentsCard:
    'Invoice sales (completed payments, payment issue date), acknowledgement receipt sales for this date, and total payments (invoice + AR).',
  recentInvoicePayments:
    'Completed invoice payments for this date (newest first), with package/item resolved the same way as Payment Logs. Shows three rows at a time; scroll for more. Same scope as invoice sales — excludes returned and rejected.',
  payVerified: (amount, date) =>
    `${amount} — completed payments finance has verified · ${date}`,
  payNotVerifiedYet: (amount, date) =>
    `${amount} — completed but not verified yet · ${date}`,
  arVerified: (amount, date) =>
    `${amount} — package acknowledgement receipts verified or applied · ${date}`,
  arUnverified: (amount, date) =>
    `${amount} — package acknowledgement receipts not verified yet · ${date}`,
  verificationSection: 'Finance checks for the selected date',
  branchTable: 'Each column uses the same calendar day you selected above.',
  salesGuide:
    'Invoice Sales uses payment issue date. Acknowledgement Receipt Sales matches the AR page total for that day. Verification cards count package ARs by issue date and verification status.',
  chartBranchActivity: 'Compare branches: enrollments, drops, rejoins, and merchandise for this date.',
  chartInvoiceByBranch: 'Invoice and acknowledgement receipt totals by branch for this date.',
  chartSalesTrend: 'Completed invoice payments over the last 7 days.',
  chartActivityMix:
    'How today’s enrollment and merchandise activity is split. Merchandise = units issued (AR sales + package releases).',
};

export const MONTHLY_OPERATIONAL = {
  pageIntro:
    'Same metrics as the daily dashboard, added up for the month you select.',
  newEnrolleesReenroll:
    'Sum of daily operational rules for this month. Full-payment invoices count once per enrolled phase (matrix-aligned). Installment phase-events count only when the invoice is Paid (partial payments on Partially Paid invoices are excluded until settled). New enrollees = first phase when truly first-time. Re-enrollment KPI includes re_enrolled, upsell, and multi-phase completed (single-phase completed counts only under Completed).',
  droppedRejoin:
    'Rejoin: class payments in the month with status rejoin. Dropped / unenrolled: students removed in the month (removed_at, Asia/Manila).',
  reservedUpsell:
    'Reserved = reservation-fee payments in the month with program_enrollment_status reserved. Upsell = class payments with status upsell.',
  completedEnrollment:
    'Completed = terminal phase on multi-phase full payment, completed phase row, or single-phase class (1 phase only) fully paid in the month. Retention base = student+class tracks with enrolled class payments in the previous calendar month.',
  completedRetentionCombined:
    'Completed counts terminal/single-phase-finished payments in this month. Retention base is the prior-month cohort (tracks with enrolled class payments last month) — aligns with the Month Re-enrollment matrix retention base.',
  merchandiseSection: 'Merchandise releases for the selected month',
  recentMerchandiseReleases:
    'Stock release log lines for this month (package first payment + merchandise AR). Shows three rows at a time; scroll for more.',
  financialSection: 'Sales summary for the selected month',
  invoiceSales:
    'Completed invoice payments in this month (amount due + tips). Returned and rejected are excluded.',
  arSales: (receiptCount) =>
    `${receiptCount} acknowledgement receipt(s) in this month — matches the main AR list for the same month.`,
  combinedSales:
    'Invoice sales use payment issue date in the month. AR sales match the AR list for the same month.',
  totalPayments:
    'Matches Payment Logs total for this month: completed payment lines only (verified + not verified yet), excluding returned and rejected.',
  merchandise: (txnCount) =>
    `${txnCount} release event(s) this month (merchandise AR + package items on first payment). Re-enroll does not count again.`,
  enrollmentSnapshot:
    'Students with activity this month: active / inactive counts and overall phase re-enrollment rate (see Re-enrollment Dashboard for details).',
  reEnrollmentSnapshot: (retained, prior) =>
    `Re-enrollment rate for this month: ${retained} Re-enrollment KPI count (same as the card) ÷ ${prior} retention base (student+class tracks with enrolled payments in the previous calendar month) × 100.`,
  salesPaymentsCard:
    'Invoice sales (completed payments in month), acknowledgement receipt sales for the month, and total payments (matches Payment Logs: verified + not verified yet).',
  recentInvoicePayments:
    'Completed invoice payments in this month (newest first), with package/item resolved the same way as Payment Logs. Shows three rows at a time; scroll for more. Same scope as invoice sales — excludes returned and rejected.',
  payVerified: (amount) => `${amount} — verified completed payments in this month`,
  payNotVerifiedYet: (amount) => `${amount} — completed, not verified yet, in this month`,
  arVerified: (amount) => `${amount} — verified or applied package ARs in this month`,
  arUnverified: (amount) => `${amount} — package ARs awaiting verification in this month`,
  verificationSection: 'Finance checks for the selected month',
  branchTable: 'All columns use the selected calendar month.',
  salesGuide:
    'Invoice Sales uses payment issue date in the month. AR Sales matches the AR page for that month. Verification cards use package AR and payment verification status in the same range.',
  chartBranchActivity: 'Monthly totals by branch: enrollments, drops, rejoins, and merchandise.',
  chartInvoiceByBranch: 'Invoice and acknowledgement receipt totals by branch for this month.',
  chartSalesTrend: 'Completed invoice payments for the last six months (ends with your selected month).',
  chartActivityMix:
    'Share of this month’s enrollment and merchandise activity. Merchandise = units issued (AR + package enroll).',
};

export const ENROLLMENT_DASHBOARD = {
  pageIntro:
    'Track who joined, who left, who is active, and how enrollment rate changes over time.',
  monthFilterNote:
    'The month picker updates active/inactive, new & re-enrollment, dropped, rejoin, and charts. Use Overall on the phase matrix to see all-time data.',
  yearFilterNote:
    'The year picker updates matrix cohort, new & re-enrollment, dropped, rejoin, and the phase matrix for that calendar year.',
  activeInactive:
    'Students with an enrollment date in this month. Active = currently in class (new, returning, level-up, or rejoin). Inactive = dropped, finished, or not in an active status.',
  newReenroll:
    'First-time enrollments (new) and returning or level-up enrollments (re-enrollment) in this month.',
  droppedRejoin:
    'Students who unenrolled this month (by removal date) or rejoined after a gap (by enrollment date).',
  enrollmentRate: (enrolledSum, cohortSize, scope) =>
    `Sum of phase enrollments (${enrolledSum.toLocaleString()}) ÷ ${cohortSize.toLocaleString()} students in ${scope} × 100. Each phase uses the same cohort as denominator.`,
  enrollmentRateLoading: 'Loading enrollment rate…',
  reserved:
    'Students with a paid reservation fee (Fee Paid, or Reserved with a paid reservation invoice). Unpaid reservation slots are excluded. Also shows upgraded students awaiting package payment (class enrollment status reserved). Respects branch and class filters.',
  phaseTableIntro:
    'For each program phase: how many enrollments are active vs total for the month. Click a row to see names.',
  phaseTableOverall: 'All enrollment records (any date).',
  phaseTableMonth: 'Only enrollments whose date falls in the selected month.',
  phaseTableClick: 'Click a phase row to open the student list.',
  chartNewVsReenroll: 'Split of first-time vs returning / level-up students in the selected month.',
  chartRateByMonth:
    "Each student's enrollment per phase (1 = active or completed, - = not enrolled). Default: selected month only. Turn on Overall for all-time data.",
  phaseMatrixScopeMonth: (month) => `Showing enrollments in ${month}.`,
  phaseMatrixScopeYear: (year) => `Showing enrollments in ${year}.`,
  phaseMatrixScopeOverall: 'Showing all-time enrollment data.',
  chartActiveByBranch: 'Active vs inactive students in the selected month, grouped by branch.',
};

export const FINANCIAL_DASHBOARD = {
  pageIntroSuperadmin:
    'School-wide money and enrollment overview. Pick a month to align payment totals with Payment Logs.',
  pageIntroAdmin: (branchName) => `Money and enrollment overview for ${branchName}.`,
  branchesStudents:
    'Branches in scope for your filter (all schools or one branch from the header). Students = users with student role in that scope.',
  branchesStudentsAdmin: (branchName) =>
    `Your assigned branch (${branchName}) and student count for that branch.`,
  totalPaymentsCount:
    'Number of completed payment lines in the selected month (payment issue date). Returned and rejected are excluded.',
  totalPaymentsAmount:
    'Sum of payable amount plus tips for completed payments in the selected month. Matches Payment Logs total for the same month.',
  totalPaymentsTrend: (amount) => `${amount} from completed payments in the selected month (amount due + tips)`,
  paymentVerificationIntro:
    'Completed payments only. With a month selected, amounts use each payment’s issue date in that month. Verified = finance approved. Unverified = completed but not approved yet (not returned or rejected).',
  arVerificationIntro:
    'Package acknowledgement receipts. Verified = Verified or Applied. Unverified = still waiting for finance (e.g. Submitted or Pending).',
  chartEnrollment: 'New class enrollments over the last 6 months.',
  chartRevenue: 'Invoice totals (including tips from completed payments) by month.',
  chartStudentsByBranch: 'How many students are assigned to each branch today.',
  chartInvoiceStatus: 'How many invoices are paid, partial, unpaid, etc.',
  chartReservations: 'Students holding a reserved slot (not yet fully enrolled).',
  crossingAlert: (count) =>
    `${count} student(s) are enrolled in classes at a different branch than their home branch.`,
};

export const FINANCE_ROLE_DASHBOARD = {
  pageIntroBranch: 'Payment and acknowledgement receipt totals for your branch. Use the date filter to change the range.',
  pageIntroAllBranches: 'Payment and acknowledgement receipt totals across all branches.',
  totalRevenue: 'Money collected from completed payments in your date range (amount due + tips).',
  completedPayments: 'Number of completed payment records in the range.',
  arSales: (count) => `${count} acknowledgement receipt(s) in the selected date range.`,
  verifiedPayments: (amount) => `${amount} — finance has approved these payments`,
  unverifiedPayments: (amount) => `${amount} — completed, waiting for finance approval`,
  verifiedAr: (amount) => `${amount} — package AR verified or applied`,
  unverifiedAr: (amount) => `${amount} — package AR not verified yet`,
  recentInvoices: 'Newest invoices that match your date filter.',
  recentPayments: 'Newest completed payments that match your date filter.',
  revenueByBranch: 'Completed payment totals by branch for the current filter.',
};

export const OPERATIONAL_DASHBOARD = {
  pageIntro:
    'See how many students stay enrolled over time (cohort retention) and how classes, teachers, and rooms are used.',
  filtersTitle: 'Narrow results by teacher, room, or program after you choose a branch.',
  cohortTooltip:
    'Students are grouped by the month they first enrolled. The table shows what percentage of that same group enrolled again in each later month.',
};

export const PHASE_ENROLLMENT_DASHBOARD = {
  kpiCardsAlignWithMonthYear: (year) =>
    `KPI cards for ${year} match the Month Re-enrollment dashboard (Jan–Dec billing-month matrix). The phase table below is for phase-by-phase analysis only — its rate row may differ.`,
  matrixCohortYear: (year) =>
    `For ${year}: Retention base = sum of prior-phase enrolled counts from the rate header row (denominators only). Same total used in Total Re-enrollment Rate — not unique students; a track can count in multiple phases. Students = unique students in the matrix. Respects program/class filters.`,
  pageIntro: (year) =>
    `Track student re-enrollment by program phase and retention for ${year}. Year KPI cards align with Month Re-enrollment.`,
  newReenrollYear: (year) =>
    `For ${year}: New enrollees = every green "new" cell in the phase matrix. Re-enrollment KPI = sum of rate-header numerators (re-enrolled, upsell, and multi-phase completed cells; single-phase completed excluded).`,
  reservedUpsellYear: (year) =>
    `For ${year}: Reserved = amber "reserved" cells; Upsell = teal "upsell" cells — each counted once per matrix cell in the table.`,
  droppedRejoinYear: (year) =>
    `For ${year}: Dropped = pink "dropped/unenrolled" cells; Rejoin = orange "rejoin" cells — summed from labeled cells in the phase matrix.`,
  reEnrollmentRate: (retainedSum, priorPhaseSum, scope) =>
    `Total re-enrollment rate (${scope}): ${retainedSum.toLocaleString()} ÷ ${priorPhaseSum.toLocaleString()} × 100. The numerator matches the Re-enrollment KPI card (sum of rate-header numerators). Denominator = sum of prior-phase enrolled counts where a fraction is shown. Phase 1 is N/A.`,
  matrixLegend:
    '1 = enrolled for that phase. Labels: new (first phase only), re-enrolled, reserved, or completed. Dash = not enrolled. Hover "new" for Previous reserved when applicable.',
  matrixRateTooltip:
    'Re-enrollment rate row: Re-enrollment KPI cells in this phase (re-enrolled, upsell, multi-phase completed) for students enrolled in the previous phase ÷ students enrolled in the previous phase. Phase 1 has no prior phase (—). Hover "new" for Previous reserved when enrollment followed a paid reservation.',
};

export const MONTHLY_ENROLLMENT_DASHBOARD = {
  matrixCohortYear: (year) =>
    `For ${year}: Retention base = sum of prior-month enrolled counts from the rate header row (denominators only). Same total used in Total Re-enrollment Rate — not unique students; a track can count in multiple months. Students = unique students in the matrix. Respects year, branch, program, and class filters.`,
  pageIntro: (year) =>
    `Track each student's re-enrollment across Jan – Dec ${year} and monthly retention.`,
  newReenrollYear: (year) =>
    `For ${year}: New enrollees = every green "new" cell in the matrix. Re-enrollment KPI = sum of rate-header numerators (re-enrolled, upsell, and multi-phase completed cells; single-phase completed excluded).`,
  reservedUpsellYear: (year) =>
    `For ${year}: Reserved = amber "reserved" cells; Upsell = teal "upsell" cells — each counted once per matrix cell in the table. Hover "new" for Previous reserved when enrollment followed a paid reservation.`,
  droppedRejoinYear: (year) =>
    `For ${year}: Dropped = pink "dropped/unenrolled" cells; Rejoin = orange "rejoin" cells — summed from labeled cells in the matrix table.`,
  reEnrollmentRate: (retainedSum, priorMonthSum, year) =>
    `Total re-enrollment rate for ${year}: ${retainedSum.toLocaleString()} ÷ ${priorMonthSum.toLocaleString()} × 100. The numerator matches the Re-enrollment KPI card (sum of rate-header numerators). Denominator = sum of prior-month enrolled counts where a fraction is shown.`,
  matrixTitleTooltip: (year) =>
    `Columns are Jan through Dec ${year}. Each cell is the billing month the phase covers — not the payment date.\n\n` +
    'Re-enrollment rate row: Re-enrollment KPI cells this month (re-enrolled, upsell, multi-phase completed) for students who were enrolled last month ÷ students enrolled in the previous month. ' +
    `January compares to December ${Number(year) - 1} when viewing a calendar year. ` +
    'Reserved cells show paid reservation fee before enrollment. Hover a "new" cell for Previous reserved when enrollment followed a reservation.\n\n' +
    'Installment: invoice generated on the 25th of each month; due on the 5th of the following month. ' +
    'Billing months follow payment timing (early or advance payments map to the correct future month).\n\n' +
    'Full-payment: Phase 1 aligns to the class start date; each following phase maps to the next calendar month. ' +
    'The last enrolled month shows as completed. Middle months show as re-enrolled.',
  matrixLegend:
    '1 = enrolled for that billing month. Labels: new (first enroll only), re-enrolled, reserved, or completed. Dash = not enrolled. Hover "new" for Previous reserved when applicable.',
};

export const PLACEHOLDER_DASHBOARD = {
  student: 'Your classes, schedule, and account details will appear here soon.',
  teacher: 'Your classes, students, and schedule tools will appear here soon.',
};
