export const MAX_CASH_DEPOSIT_ATTACHMENTS = 2;

/**
 * @param {{ deposit_attachment_url?: string|null, deposit_attachment_url_2?: string|null }|null|undefined} record
 * @returns {string[]}
 */
export function getCashDepositAttachmentUrls(record) {
  if (!record) return [];
  return [record.deposit_attachment_url, record.deposit_attachment_url_2]
    .map((url) => String(url || '').trim())
    .filter(Boolean)
    .slice(0, MAX_CASH_DEPOSIT_ATTACHMENTS);
}

/**
 * @param {string[]} attachments
 * @returns {{ deposit_attachment_url: string, deposit_attachment_url_2: string|null }}
 */
export function serializeCashDepositAttachments(attachments) {
  const urls = (Array.isArray(attachments) ? attachments : [])
    .map((url) => String(url || '').trim())
    .filter(Boolean)
    .slice(0, MAX_CASH_DEPOSIT_ATTACHMENTS);

  return {
    deposit_attachment_url: urls[0] || '',
    deposit_attachment_url_2: urls[1] || null,
  };
}
