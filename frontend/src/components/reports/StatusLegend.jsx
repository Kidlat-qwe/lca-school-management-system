import { PROGRAM_ENROLLMENT_STATUS_ITEMS } from '../../utils/programEnrollmentStatus';

const TAB_STUDENT_STATUS = 'student_status';
const TAB_PROGRAM_PAYMENT_STATUS = 'program_payment_status';
const TAB_PROGRAM_ENROLLMENT_STATUS = 'program_enrollment_status';

const LEGEND_BY_TAB = {
  [TAB_STUDENT_STATUS]: [
    {
      key: 'active',
      label: 'Active',
      tone: 'bg-green-100 text-green-800',
      description: 'Student currently has an active class enrollment.',
    },
    {
      key: 'inactive',
      label: 'Inactive',
      tone: 'bg-gray-100 text-gray-800',
      description: 'Student account exists but has no active enrollment.',
    },
  ],
  [TAB_PROGRAM_PAYMENT_STATUS]: [
    {
      key: 'wait_for_payment',
      label: 'Wait for payment',
      tone: 'bg-amber-100 text-amber-800',
      description: 'Invoice is posted and waiting for any payment.',
    },
    {
      key: 'under_grace_period',
      label: 'Under grace period',
      tone: 'bg-amber-100 text-amber-800',
      description: 'Past due date but still inside allowed grace period.',
    },
    {
      key: 'due_date',
      label: 'Due date',
      tone: 'bg-gray-100 text-gray-800',
      description: 'Invoice is due now and needs immediate payment action.',
    },
    {
      key: 'paid',
      label: 'Paid',
      tone: 'bg-green-100 text-green-800',
      description: 'Invoice has been fully paid.',
    },
  ],
  [TAB_PROGRAM_ENROLLMENT_STATUS]: PROGRAM_ENROLLMENT_STATUS_ITEMS,
};

const StatusLegend = ({ tab }) => {
  const items = LEGEND_BY_TAB[tab] || [];
  if (!items.length) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Status Legend</h2>
        <span className="text-xs text-gray-500">Quick guide</span>
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {items.map((item) => (
          <div key={item.key} className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${item.tone}`}>
                {item.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-600">{item.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StatusLegend;
