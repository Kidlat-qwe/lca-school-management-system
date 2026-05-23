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
    'Unique students who enrolled on this date — first-time (new) or returning / level-up (re-enrollment).',
  droppedRejoin:
    'Unique students who left a class on this date (dropped) or came back after a gap (rejoin).',
  invoiceSales:
    'Total from completed invoice payments on this date (amount due + tips). Returned and rejected payments are excluded.',
  arSales: (receiptCount) =>
    `${receiptCount} acknowledgement receipt(s) on this date — matches the main Acknowledgement Receipt list for the same day.`,
  merchandise: (txnCount) =>
    `${txnCount} paid merchandise sale(s). Quantity is total items released.`,
  enrollmentRate: (enrolled, total) =>
    `${enrolled} of ${total} phase enrollments on this date are still active. Rate is by program phase, not the same as “new enrollees” above.`,
  payApproved: (amount, date) =>
    `${amount} — completed payments finance has approved · ${date}`,
  payPending: (amount, date) =>
    `${amount} — completed but waiting for finance approval · ${date}`,
  arVerified: (amount, date) =>
    `${amount} — package acknowledgement receipts verified or applied · ${date}`,
  arUnverified: (amount, date) =>
    `${amount} — package acknowledgement receipts not verified yet · ${date}`,
  verificationSection: 'Finance checks for the selected date',
  branchTable: 'Each column uses the same calendar day you selected above.',
  salesGuide:
    'Invoice Sales uses payment issue date. Acknowledgement Receipt Sales matches the AR page total for that day. Verification cards count package ARs by issue date and approval status.',
  chartBranchActivity: 'Compare branches: enrollments, drops, rejoins, and merchandise for this date.',
  chartInvoiceByBranch: 'Invoice and acknowledgement receipt totals by branch for this date.',
  chartSalesTrend: 'Completed invoice payments over the last 7 days.',
  chartActivityMix: 'How today’s enrollment and merchandise activity is split (excluding cash sales).',
};

export const MONTHLY_OPERATIONAL = {
  pageIntro:
    'Same metrics as the daily dashboard, added up for the month you select.',
  newEnrolleesReenroll:
    'Unique students whose enrollment date falls in this month — first-time (new) or returning / level-up.',
  droppedRejoin:
    'Dropped: students removed from a class this month. Rejoin: students who re-entered after a gap this month.',
  invoiceSales:
    'Completed invoice payments in this month (amount due + tips). Returned and rejected are excluded.',
  arSales: (receiptCount) =>
    `${receiptCount} acknowledgement receipt(s) in this month — matches the main AR list for the same month.`,
  merchandise: (txnCount) => `${txnCount} paid merchandise sale(s) in this month.`,
  enrollmentSnapshot:
    'Students with activity this month: active / inactive counts and overall phase enrollment rate (see Enrollment Dashboard for details).',
  payApproved: (amount) => `${amount} — approved completed payments in this month`,
  payPending: (amount) => `${amount} — completed, pending finance approval, in this month`,
  arVerified: (amount) => `${amount} — verified or applied package ARs in this month`,
  arUnverified: (amount) => `${amount} — package ARs awaiting verification in this month`,
  verificationSection: 'Finance checks for the selected month',
  branchTable: 'All columns use the selected calendar month.',
  salesGuide:
    'Invoice Sales uses payment issue date in the month. AR Sales matches the AR page for that month. Verification cards use package AR issue dates in the same range.',
  chartBranchActivity: 'Monthly totals by branch: enrollments, drops, rejoins, and merchandise.',
  chartInvoiceByBranch: 'Invoice and acknowledgement receipt totals by branch for this month.',
  chartSalesTrend: 'Completed invoice payments for the last six months (ends with your selected month).',
  chartActivityMix: 'Share of this month’s enrollment and merchandise activity (excluding cash sales).',
};

export const ENROLLMENT_DASHBOARD = {
  pageIntro:
    'Track who joined, who left, who is active, and how enrollment rate changes over time.',
  monthFilterNote:
    'The month picker updates active/inactive, new & re-enrollment, dropped, rejoin, charts, and the phase table (unless you turn on Overall for the table). Reserved students always show today’s count.',
  activeInactive:
    'Students with an enrollment date in this month. Active = currently in class (new, returning, level-up, or rejoin). Inactive = dropped, finished, or not in an active status.',
  newReenroll:
    'First-time enrollments (new) and returning or level-up enrollments (re-enrollment) in this month.',
  droppedRejoin:
    'Students who unenrolled this month (by removal date) or rejoined after a gap (by enrollment date).',
  enrollmentRate: (enrolled, total, scope) =>
    `${enrolled} of ${total} phase slots in ${scope} are in an active enrollment status. One student in two phases counts twice.`,
  enrollmentRateLoading: 'Loading enrollment rate…',
  reserved: 'Students on a waiting list (reserved) right now — not filtered by month.',
  phaseTableIntro:
    'For each program phase: how many enrollments are active vs total for the month. Click a row to see names.',
  phaseTableOverall: 'All enrollment records (any date).',
  phaseTableMonth: 'Only enrollments whose date falls in the selected month.',
  phaseTableClick: 'Click a phase row to open the student list.',
  chartNewVsReenroll: 'Split of first-time vs returning / level-up students in the selected month.',
  chartRateByMonth: 'Enrollment rate % by month for the last six months.',
  chartActiveByBranch: 'Active vs inactive students in the selected month, grouped by branch.',
};

export const FINANCIAL_DASHBOARD = {
  pageIntroSuperadmin:
    'School-wide money and enrollment overview. Pick a month to align payment totals with Payment Logs.',
  pageIntroAdmin: (branchName) => `Money and enrollment overview for ${branchName}.`,
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

export const PLACEHOLDER_DASHBOARD = {
  student: 'Your classes, schedule, and account details will appear here soon.',
  teacher: 'Your classes, students, and schedule tools will appear here soon.',
};
