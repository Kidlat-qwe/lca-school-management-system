/**
 * Short, user-friendly helper text for dashboard stat cards and charts.
 * Wording is shared across role-specific dashboard pages where metrics match.
 */

export const DASHBOARD_DATE_NOTE = 'Dates use Philippine time (Asia/Manila).';

export const OPERATIONAL_ATTENDANCE = {
  dailyIntro:
    'Uses the same class session row as Class Details (earliest scheduled date per phase/session). Attendance is completed only when that session status is Completed — matching the class attendance modal.',
  monthlyIntro:
    'Same rules as Class Details attendance: one session per phase/session slot, status Completed means attendance was saved. Summary counts cover the full selected month.',
  dailySubtitle: (periodLabel, pendingCount, takenCount = 0, totalCount = 0) =>
    `${pendingCount} need attendance · ${takenCount} already taken · ${totalCount} total for ${periodLabel}.`,
  monthlySubtitle: (periodLabel, pendingCount, takenCount = 0, totalCount = 0) =>
    `${pendingCount} need attendance · ${takenCount} already taken · ${totalCount} total in ${periodLabel}.`,
  emptyDaily: (periodLabel) => `No class sessions scheduled for ${periodLabel}.`,
  emptyMonthly: (periodLabel) => `No class sessions found for ${periodLabel}.`,
};

export const DAILY_OPERATIONAL = {
  pageIntro:
    'A snapshot of one day: new enrollments, drops, sales, merchandise, and finance checks for the date you pick.',
  branchHintSuperadmin: 'Pick a branch from the menu at the top to see one location only.',
  branchHintAdmin: 'Numbers are limited to your assigned branch.',
  newEnrolleesReenroll:
    'Counts use completed class payments on this date (payment issue date, Asia/Manila). New enrollees = distinct students classified as New. Re-enrollment = distinct students classified as re_enrolled. Installment phase payments count only when the invoice is Paid.',
  droppedRejoin:
    'Rejoin = distinct students with a class payment on this date classified as rejoin. Dropped / unenrolled = distinct students removed on this date (removed_at, Asia/Manila) with status dropped.',
  reservedUpsell:
    'Reserved = distinct students with a reservation-fee payment on this date (status reserved). Upsell = distinct students with a class payment on this date classified as upsell (level-up / package change).',
  completedEnrollment:
    'Completed = terminal phase on a multi-phase full payment (e.g. phase 5 on full pay 1–5), a completed phase row, or a single-phase class (1 phase only) whose package is fully paid on this date. Retention base = student+class tracks with enrolled class payments on the previous calendar day (payment issue date).',
  completedRetentionCombined:
    'Completed counts terminal/single-phase-finished payments on this date. Retention base is the prior-day cohort (tracks with new, re_enrolled, upsell, rejoin, or completed payments yesterday).',
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
  totalActiveStudents:
    'Sum of new enrollees + re-enrollment + rejoin for the selected date (same payment-issue rules as the KPI cards above). Counts phase-events, not unique students — one student in two classes counts twice.',
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
  reEnrollmentRateBreakdown:
    'Rate uses re-enrollment KPI phase-events ÷ prior-period retention base. The Students re-enrolled column dedupes: full payment = 1, one student = 1 per branch. Click a branch to open the student list.',
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
    'Counts from the Month Re-enrollment matrix for the selected month (billing month column). New = green "new" cells. Re-enrollment = purple "re-enrolled" cells only (same badge count as the Month Re-enrollment matrix). Completed cells are on the Completed card, not here.',
  totalActiveStudents:
    'Sum of new enrollees + re-enrollment + rejoin + upsell + qualifying completed for the selected month (Month Re-enrollment matrix column). Completed counts only when the same track already had a prior new, re-enrolled, or rejoin cell (standalone completed is excluded). Single-phase completed (e.g. Active Champs) is also excluded. Counts matrix cells, not unique students — one student in two classes counts twice.',
  droppedRejoin:
    'Dropped / unenrolled = pink cells in the matrix month column. Rejoin = orange "rejoin" cells in that column.',
  reservedUpsell:
    'Reserved = amber "reserved" cells. Upsell = teal "upsell" cells — same labels as the Re-enrollment matrix table.',
  completedEnrollment:
    'Completed = orange "completed" cells in the matrix month column that already had a prior new, re-enrolled, or rejoin on the same track. Standalone completed (no prior enrollment cell) is not shown. Retention base = prior-month new + re-enrolled + rejoin + upsell (rate-row denominator).',
  completedRetentionCombined:
    'Completed uses the Month Re-enrollment matrix for the selected month, excluding standalone completed (no prior new / re-enrolled / rejoin). Retention base uses the rate-row denominator rules.',
  merchandiseSection: 'Merchandise releases for the selected month',
  recentMerchandiseReleases:
    'Stock release log lines for this month (package first payment + merchandise AR). Shows three rows at a time; scroll for more.',
  financialSection: 'Sales and Attendance summary for the selected month',
  invoiceSales:
    'Completed invoice payments in this month (amount due + tips). Returned and rejected are excluded.',
  arSales: (receiptCount) =>
    `${receiptCount} acknowledgement receipt(s) in this month — matches Financial Dashboard All AR (Verified + Unverified + Rejected).`,
  combinedSales:
    'Invoice sales use payment issue date in the month. AR sales match Financial Dashboard All AR for the same month.',
  totalPayments:
    'Net completed invoice payment lines in this month (payment date, payable + tips). Returned and rejected lines in the month are deducted; settled payments count again when approved or re-recorded.',
  merchandise: (txnCount) =>
    `${txnCount} release event(s) this month (merchandise AR + package items on first payment). Re-enroll does not count again.`,
  enrollmentSnapshot:
    'Students with activity this month: active / inactive counts and overall phase re-enrollment rate (see Re-enrollment Dashboard for details).',
  reEnrollmentSnapshot: (retained, prior) =>
    `Re-enrollment rate for this month: ${retained} ÷ ${prior} retention base × 100 — same numerator as the Re-enrollment KPI card and the Month Re-enrollment matrix rate row (purple re-enrolled cells only).`,
  salesPaymentsCard:
    'Invoice sales (completed payments by payment date in month), acknowledgement receipt sales for the month, and total payments (same amount as Invoice month total).',
  recentInvoicePayments:
    'Completed invoice payments in this month (newest first), with package/item resolved the same way as Payment Logs. Shows three rows at a time; scroll for more. Same scope as invoice sales — excludes returned and rejected.',
  payVerified: (amount) => `${amount} — verified completed payments in this month`,
  payNotVerifiedYet: (amount) => `${amount} — completed, not verified yet, in this month`,
  arVerified: (amount) => `${amount} — verified or applied package ARs in this month`,
  arUnverified: (amount) => `${amount} — package ARs awaiting verification in this month`,
  verificationSection: 'Finance checks for the selected month',
  branchTable: 'All columns use the selected calendar month.',
  reEnrollmentRateBreakdown:
    'Rate matches the Month Re-enrollment matrix rate row for this month. The Students re-enrolled column may still list payment-based drill-down students.',
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
    'Net completed invoice payment lines for the selected month (payment date), after deducting returned and rejected lines in that period. Updates when a returned payment is resubmitted/approved or a new payment settles a rejection.',
  totalPaymentsAmount:
    'Net payable + tips for the same scope. Returned and rejected payment lines with payment date in the month are deducted; settled payments count again when approved.',
  totalPaymentsTrend: (amount) => `${amount} from completed invoice payments in the selected month (amount due + tips)`,
  paidInvoicePenalties:
    'Late-payment penalty ₱ on Paid invoices in the selected month (by payment date). Click to open Invoice list.',
  paymentVerificationIntro:
    'Payment issue date in the selected month. Verified = finance approved. Unverified = completed but not approved yet (not returned or rejected). Invoice payment lines only — unapplied package AR is on AR verification below.',
  arVerificationIntro:
    'Matches Acknowledgement Receipts for the selected month. Verified (Applied) and Unverified only — returned queue is on the Returned tab. Click a card to open the matching status filter.',
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
  paidInvoicePenalties:
    'Late-payment penalty ₱ on Paid invoices in your date range (by payment date). Click to open Invoice list.',
  arSales: (count) => `${count} acknowledgement receipt(s) in the selected date range.`,
  verifiedPayments: (amount) => `${amount} — finance has approved these payments`,
  unverifiedPayments: (amount) => `${amount} — completed, waiting for finance approval`,
  verifiedAr: (amount) => `${amount} — verified or applied acknowledgement receipts`,
  unverifiedAr: (amount) => `${amount} — awaiting finance verification`,
  arVerificationIntro:
    'Matches Acknowledgement Receipts for your date filter. Verified (Applied) and Unverified — returned items use the Return tab on the AR page. Click a card to open the matching status filter.',
  allAr: (amount) => `${amount} — all acknowledgement receipts in scope (excludes returned queue)`,
  rejectedAr: (amount) => `${amount} — permanently rejected acknowledgement receipts`,
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

export const LEADERSHIPBOARD = {
  pageIntro:
    'Compare every branch side by side using the same numbers as the Monthly Operational Dashboard: invoice sales, new enrollees, re-enrollment, rejoin, upsell, and active students.',
  adminPageIntro:
    'See where your branch places among the network. Peer names and ranks stay visible; only your branch shows performance numbers — with a personal standing and climb guide.',
  focusPageIntro:
    'Stacked compare view: selected branch details on top, then the full network ranking below — both full width.',
  focusSelectedPanel:
    'Full-width snapshot and Overall breakdown for the branch chosen in the global branch filter.',
  focusNetworkPanel:
    'Full-width network ranking with metrics so you can compare the selected branch against peers.',
  focusNetworkHint:
    'Gold, silver, and bronze mark the top three. The focused branch row is highlighted.',
  adminNetworkRace:
    'All branches appear in Overall place order. Peer metric totals stay hidden — only names, medals, and your highlighted row are shown.',
  adminNetworkRaceHint:
    'Who is ahead of you is clear. Their sales and enrollment numbers are not.',
  adminOwnSnapshot:
    'Your Monthly Operational metrics for the selected month. Use these to drive your Overall score.',
  adminWeightStory:
    'Each bar is how you rank on that criterion versus other branches (lowest → highest). Absolute peer numbers are never shown.',
  adminChartSalesTrend:
    'Your branch invoice sales for the last six months (peer series omitted for privacy).',
  compositeScore:
    'Overall = weighted score: Invoice Sales 40%, New 20%, Re-enrolled 20%, Rejoin 10%, Upsell 10%. Each metric is scaled 0–1 vs other branches, then weighted. Active is shown in the table but not used in Overall (avoids double-counting). Ties break on Invoice Sales, then name.',
  metricToggle:
    'Ranks by the selected metric. Overall = weighted sales + growth + retention (Active excluded). Invoice Sales = Monthly Operational payments. New / Re-enrolled / Rejoin / Upsell from the matrix; Active = sum of those four (display only for Overall).',
  chartSalesTrend:
    'Invoice sales by branch for the last six months (completed payments by payment date, excluding returned and rejected) — same definition as Monthly Operational invoice sales.',
  chartBranchShare:
    'Share of the selected metric across branches. Sales use Monthly Operational invoice sales; enrollment counts use the Month Re-enrollment matrix.',
  topBranch:
    'Branch leading for the active compare metric. Overall uses the weighted score; other toggles use that metric’s highest value.',
  rankingTable:
    'Branches re-rank when you change the compare metric. Gold, silver, and bronze badges mark the top three for the active metric.',
  invoiceSales:
    'Same as Monthly Operational Invoice Sales / completed payment Total Payments for the month: payable + tips on Completed payments by issue date, excluding Returned and Rejected. Does not include Acknowledgement Receipt sales.',
  activeStudents:
    'Same as Monthly Operational Total Active Students: New + Re-enrollment + Rejoin + Upsell + qualifying completed for the selected month (Month Re-enrollment matrix). Completed needs a prior new / re-enrolled / rejoin on the track; standalone completed and lifecycle Inactive do not count. Unpaid partial phases (Enrollment blank until Paid) do not count.',
};

export const PHASE_ENROLLMENT_DASHBOARD = {
  kpiCardsAlignWithMonthYear: (year) =>
    `KPI cards for ${year} match the Month Re-enrollment dashboard (Jan–Dec billing-month matrix). The phase table below is for phase-by-phase analysis only — its rate row may differ.`,
  matrixCohortYear: (year) =>
    `For ${year}: Retention base = sum of prior-phase enrolled counts from the rate header row (denominators only). Same total used in Total Re-enrollment Rate — not unique students; a track can count in multiple phases. Students = unique students in the matrix. Respects program/class filters.`,
  pageIntro: (year) =>
    `Track student re-enrollment by program phase and retention for ${year}.`,
  newReenrollYear: (year) =>
    `For ${year}: New enrollees = every green "new" cell in the phase matrix. Re-enrollment KPI = every purple "re-enrolled" cell (completed cells are not included).`,
  reservedUpsellYear: (year) =>
    `For ${year}: Reserved = amber "reserved" cells; Upsell = teal "upsell" cells — each counted once per matrix cell in the table.`,
  droppedRejoinYear: (year) =>
    `For ${year}: Dropped = pink "dropped/unenrolled" cells; Rejoin = orange "rejoin" cells — summed from labeled cells in the phase matrix.`,
  reEnrollmentRate: (retainedSum, priorPhaseSum, scope) =>
    `Total re-enrollment rate (${scope}): ${retainedSum.toLocaleString()} ÷ ${priorPhaseSum.toLocaleString()} × 100. The numerator matches the Re-enrollment KPI card (sum of rate-header numerators). Denominator = sum of prior-phase enrolled counts where a fraction is shown. Phase 1 is N/A.`,
};

export const MONTHLY_ENROLLMENT_DASHBOARD = {
  matrixCohortYear: (year) =>
    `For ${year}: Retention base = sum of prior-month enrolled counts from the rate header row (denominators only). Same total used in Total Re-enrollment Rate — not unique students; a track can count in multiple months. Students = unique students in the matrix. Respects year, branch, program, and class filters.`,
  pageIntro: (year) =>
    `Track each student's re-enrollment across Jan – Dec ${year} and monthly retention.`,
  newReenrollYear: (year) =>
    `For ${year}: New enrollees = every green "new" cell in the matrix. Re-enrollment KPI = every purple "re-enrolled" cell (completed cells are not included — they have their own Completed count).`,
  reservedUpsellYear: (year) =>
    `For ${year}: Reserved = amber "reserved" cells; Upsell = teal "upsell" cells — each counted once per matrix cell in the table. Hover "new" for Previous reserved when enrollment followed a paid reservation.`,
  droppedRejoinYear: (year) =>
    `For ${year}: Dropped = pink "dropped/unenrolled" cells; Rejoin = orange "rejoin" cells — summed from labeled cells in the matrix table.`,
  reEnrollmentRate: (retainedSum, priorMonthSum, year) =>
    `Total re-enrollment rate for ${year}: ${retainedSum.toLocaleString()} ÷ ${priorMonthSum.toLocaleString()} × 100. Numerator = sum of purple re-enrolled cells (same as the Re-enrollment KPI). Denominator = sum of prior-month new, re-enrolled, rejoin, and upsell cells.`,
  matrixTitleTooltip: (year) =>
    `Columns are Jan through Dec ${year}. Each cell is the billing month the phase covers — not the payment date.\n\n` +
    'Re-enrollment rate row: Numerator = re-enrolled + Active (✓) + completed (including standalone) in this month column. Denominator = prior-month cells labeled new, re-enrolled, rejoin, or upsell, plus completed only with a prior new/re-enrolled/rejoin. ' +
    `January compares to December ${Number(year) - 1} when viewing a calendar year. ` +
    'Reserved cells show paid reservation fee before enrollment. Hover a "new" cell for Previous reserved when enrollment followed a reservation.\n\n' +
    'Installment: invoice generated on the 25th of each month; due on the 5th of the following month. ' +
    'Billing months follow payment timing (early or advance payments map to the correct future month).\n\n' +
    'Full-payment: Phase 1 aligns to the class start date; each following phase maps to the next calendar month. ' +
    'The last enrolled month shows as completed. Middle months show as re-enrolled.',
};

export const PLACEHOLDER_DASHBOARD = {
  student: 'Your classes, schedule, and account details will appear here soon.',
  teacher: 'Your classes, students, and schedule tools will appear here soon.',
};

export const TEACHER_DASHBOARD = {
  pageIntro:
    'Your classes, today’s sessions, and attendance in one place. Take or view attendance without leaving the dashboard.',
  branchHint: 'Only classes and sessions assigned to you are shown.',
  myClassesStat: 'Active classes where you are the assigned teacher.',
  sessionsStat: 'Class sessions scheduled on the selected date (same rules as Class Details attendance).',
  pendingStat: 'Sessions on the selected date that still need attendance (status not Completed).',
  takenStat: 'Sessions on the selected date where attendance was saved (status Completed).',
  dailySectionTitle: (periodLabel) => `Class sessions — ${periodLabel}`,
  dailySectionSubtitle: (pending, taken, total, upcoming) =>
    `${pending} need attendance · ${taken} already taken · ${upcoming} upcoming · ${total} total.`,
  myClassesSection: 'Classes where you are listed as teacher. Open Classes for schedules, sessions, and full details.',
  myClassesSubtitle: (count) =>
    count === 1 ? '1 class assigned to you.' : `${count} classes assigned to you.`,
  noClasses: 'No classes assigned to you yet.',
  monthlySection:
    'Pending and completed attendance for your assigned classes in the selected month. Same data as Class Details.',
  monthlySectionSubtitle: (monthLabel, pending, taken, total) =>
    `${pending} need attendance · ${taken} already taken · ${total} total in ${monthLabel}.`,
};

export const ATTENDANCE_DASHBOARD = {
  dailyPageTitle: 'Daily Attendance Dashboard',
  monthlyPageTitle: 'Monthly Attendance Dashboard',
  dailyIntro:
    'Session attendance for the selected date — summary counts, student mark rates, and take or update attendance in place (same data as Class Details).',
  monthlyIntro:
    'Attendance across the selected month — session completion, student mark breakdown, daily trends, and full session list with take/update actions.',
  sessionCompletionRate:
    'Share of due sessions (excluding future dates) where attendance was saved (session status Completed).',
  markCoverageRate:
    'Student attendance marks recorded vs enrolled slots on sessions already marked complete.',
  presentRate: 'Present marks as a share of all attendance marks recorded in this period.',
  absentRate: 'Absent marks as a share of all attendance marks recorded in this period.',
  dailyRateSummaryIntro:
    'Student attendance rates for the selected day, grouped by teacher, program, or class. Rates use recorded marks (Present, Absent, Late, Excused, Leave Early).',
  monthlyRateSummaryIntro:
    'Student attendance rates for the selected month, grouped by teacher, program, or class. Rates use recorded marks (Present, Absent, Late, Excused, Leave Early).',
  markDistribution: 'Breakdown of student attendance marks (Present, Absent, Late, Excused, Leave Early).',
  dailyTrend: 'Sessions taken vs still pending for each day in the month.',
  teacherScopeNote: 'Only classes and sessions assigned to you are included.',
  adminScopeNote: 'Sessions for your branch only.',
  superadminScopeNote:
    'Use the branch filter in the header to narrow results, or leave unset for all branches. Superadmin can view attendance only — take or update attendance is limited to branch admins and teachers.',
};
