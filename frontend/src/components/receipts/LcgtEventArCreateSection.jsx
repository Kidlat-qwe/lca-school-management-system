import PaymentMethodSelect from '../common/PaymentMethodSelect';
import PaymentReferenceNumberField from '../common/PaymentReferenceNumberField';
import { PaymentDiscountField } from '../common/PaymentAdjustmentFields';
import {
  LCGT_EVENT_NAME,
  LCGT_EVENT_PARTICIPANT_TYPES,
  LCGT_EVENT_PAYMENT_METHODS,
  LCGT_EVENT_TICKET_PRICE,
} from '../../constants/lcgtEventAr';
import { isCashPaymentMethod } from '../../constants/paymentFormLabels';

const LEVEL_TAG_OPTIONS = ['Playgroup', 'Nursery', 'Pre-Kindergarten', 'Kindergarten', 'Grade School'];

/**
 * Create-modal fields for Little Champions Got Talent event AR (Superadmin / Admin).
 */
export default function LcgtEventArCreateSection({
  eventParticipantType,
  onParticipantTypeChange,
  createFormData,
  createFormErrors,
  handleCreateInputChange,
  handleAttachmentChange,
  attachmentUploading,
  creating,
  openAttachmentViewer,
  clearAttachment,
}) {
  const isStudent = eventParticipantType === LCGT_EVENT_PARTICIPANT_TYPES.STUDENT;
  const isCash = isCashPaymentMethod(createFormData.payment_method);
  const attachmentRequired = !isCash;

  return (
    <>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-gray-900">{LCGT_EVENT_NAME}</p>
        <p className="mt-1 text-xs text-gray-600">
          Event ticket — ₱{LCGT_EVENT_TICKET_PRICE.toLocaleString('en-PH', { minimumFractionDigits: 2 })} per participant.
        </p>
      </div>

      <div>
        <span className="label-field text-xs">
          Participant Type <span className="text-red-500">*</span>
        </span>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
            <input
              type="radio"
              name="event_participant_type"
              value={LCGT_EVENT_PARTICIPANT_TYPES.STUDENT}
              checked={eventParticipantType === LCGT_EVENT_PARTICIPANT_TYPES.STUDENT}
              onChange={() => onParticipantTypeChange(LCGT_EVENT_PARTICIPANT_TYPES.STUDENT)}
              disabled={creating}
              className="text-amber-600 focus:ring-amber-500"
            />
            Student
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
            <input
              type="radio"
              name="event_participant_type"
              value={LCGT_EVENT_PARTICIPANT_TYPES.OUTSIDER}
              checked={eventParticipantType === LCGT_EVENT_PARTICIPANT_TYPES.OUTSIDER}
              onChange={() => onParticipantTypeChange(LCGT_EVENT_PARTICIPANT_TYPES.OUTSIDER)}
              disabled={creating}
              className="text-amber-600 focus:ring-amber-500"
            />
            Outsider
          </label>
        </div>
        {createFormErrors.event_participant_type && (
          <p className="text-xs text-red-500 mt-1">{createFormErrors.event_participant_type}</p>
        )}
      </div>

      {isStudent ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-field text-xs">
                Student Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="prospect_student_name"
                value={createFormData.prospect_student_name}
                onChange={handleCreateInputChange}
                className={`input-field text-sm ${createFormErrors.prospect_student_name ? 'border-red-500' : ''}`}
                disabled={creating}
              />
              {createFormErrors.prospect_student_name && (
                <p className="text-xs text-red-500 mt-1">{createFormErrors.prospect_student_name}</p>
              )}
            </div>
            <div>
              <label className="label-field text-xs">
                Level Tag <span className="text-red-500">*</span>
              </label>
              <select
                name="level_tag"
                value={createFormData.level_tag}
                onChange={handleCreateInputChange}
                className={`input-field text-sm ${createFormErrors.level_tag ? 'border-red-500' : ''}`}
                disabled={creating}
              >
                <option value="">Select level tag...</option>
                {LEVEL_TAG_OPTIONS.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
              {createFormErrors.level_tag && (
                <p className="text-xs text-red-500 mt-1">{createFormErrors.level_tag}</p>
              )}
            </div>
          </div>
          <div>
            <label className="label-field text-xs">
              Parent Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              name="prospect_student_email"
              value={createFormData.prospect_student_email}
              onChange={handleCreateInputChange}
              className={`input-field text-sm ${createFormErrors.prospect_student_email ? 'border-red-500' : ''}`}
              placeholder="parent@example.com"
              disabled={creating}
            />
            {createFormErrors.prospect_student_email && (
              <p className="text-xs text-red-500 mt-1">{createFormErrors.prospect_student_email}</p>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-600 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          Outsider ticket — enter payment details below. No student information is required.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label-field text-xs">
            Payment Date <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            name="issue_date"
            value={createFormData.issue_date}
            onChange={handleCreateInputChange}
            className={`input-field text-sm ${createFormErrors.issue_date ? 'border-red-500' : ''}`}
            required
            disabled={creating}
          />
          {createFormErrors.issue_date && (
            <p className="mt-1 text-xs text-red-500">{createFormErrors.issue_date}</p>
          )}
        </div>
        <div>
          <label className="label-field text-xs">Ticket Amount</label>
          <input
            type="text"
            readOnly
            value={`₱${LCGT_EVENT_TICKET_PRICE.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            className="input-field text-sm bg-gray-100 cursor-not-allowed"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label-field text-xs">Tip/Payment Adjustment</label>
          <input
            type="number"
            min="0"
            step="0.01"
            name="tip_amount"
            value={createFormData.tip_amount}
            onChange={handleCreateInputChange}
            placeholder="0.00"
            className={`input-field text-sm ${createFormErrors.tip_amount ? 'border-red-500' : ''}`}
            disabled={creating}
          />
          {createFormErrors.tip_amount && (
            <p className="text-xs text-red-500 mt-1">{createFormErrors.tip_amount}</p>
          )}
        </div>
        <PaymentDiscountField
          hintVariant="ar"
          value={createFormData.discount_amount}
          onChange={handleCreateInputChange}
          error={createFormErrors.discount_amount}
          payableAmount={LCGT_EVENT_TICKET_PRICE}
          disabled={creating}
        />
      </div>

      <div>
        <label className="label-field text-xs">
          Payment Method <span className="text-red-500">*</span>
        </label>
        <PaymentMethodSelect
          name="payment_method"
          value={createFormData.payment_method}
          onChange={handleCreateInputChange}
          error={createFormErrors.payment_method}
          disabled={creating}
          options={LCGT_EVENT_PAYMENT_METHODS}
        />
        {createFormErrors.payment_method && (
          <p className="text-xs text-red-500 mt-1">{createFormErrors.payment_method}</p>
        )}
        {isCash ? (
          <p className="text-xs text-emerald-600 mt-1">
            Cash event tickets are auto-verified on the AR page when issued. Reference number and attachment are optional for Cash.
          </p>
        ) : (
          <p className="text-xs text-amber-600 mt-1">
            Non-cash payments require a reference number and attachment. Finance must verify on the AR page.
          </p>
        )}
      </div>

      <PaymentReferenceNumberField
        paymentMethod={createFormData.payment_method}
        name="reference_number"
        value={createFormData.reference_number}
        onChange={handleCreateInputChange}
        disabled={creating}
        placeholder="e.g. GCash transaction ID, bank ref"
      />
      {createFormErrors.reference_number && (
        <p className="text-xs text-red-500">{createFormErrors.reference_number}</p>
      )}

      <div>
        <label className="label-field text-xs">
          Attachment (image){attachmentRequired ? <span className="text-red-600"> *</span> : null}
        </label>
        <p className="text-xs text-gray-500 mb-1">
          {attachmentRequired
            ? 'Required for non-cash payments (JPEG, PNG, WebP, GIF – max 50 MB)'
            : 'Optional for Cash payments (JPEG, PNG, WebP, GIF – max 50 MB)'}
        </p>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleAttachmentChange}
          disabled={attachmentUploading || creating}
          className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
        />
        {attachmentUploading && <p className="text-xs text-amber-600 mt-1">Uploading…</p>}
        {createFormErrors.payment_attachment_url && (
          <p className="mt-1 text-xs text-red-500">{createFormErrors.payment_attachment_url}</p>
        )}
        {createFormData.payment_attachment_url && !attachmentUploading && (
          <div className="mt-2">
            <img
              src={createFormData.payment_attachment_url}
              alt="Preview"
              className="max-h-48 w-auto rounded-lg border border-gray-200 object-contain bg-gray-50"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => openAttachmentViewer(createFormData.payment_attachment_url)}
                className="text-sm text-blue-600 hover:underline"
              >
                View
              </button>
              <button type="button" onClick={clearAttachment} className="text-xs text-red-600 hover:text-red-700">
                Remove
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
