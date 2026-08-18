import { query } from '../../config/database.js';
import {
  isEmailConfigured,
  normalizeNotificationRecipients,
  sendSystemNotificationEmailToEach,
} from '../../utils/emailService.js';
import {
  escapeHtml,
  wrapBrandedEmailHtml,
} from '../../utils/templateRenderService.js';
import { resolveAnnouncementImageSrcForEmail } from './fetchAnnouncementImageForEmail.js';
import { isAnnouncementImageUrl } from './isAnnouncementImageUrl.js';

const USER_TYPE_BY_RECIPIENT_GROUP = {
  Students: 'Student',
  Teachers: 'Teacher',
  Admin: 'Admin',
  Finance: 'Finance',
  Superadmin: 'Superadmin',
  Superfinance: 'Superfinance',
};

const ALL_BOARD_RECIPIENT_GROUPS = [
  'Students',
  'Teachers',
  'Admin',
  'Finance',
  'Superadmin',
  'Superfinance',
  'Guardians',
];

const NETWORK_WIDE_USER_TYPES = new Set(['Superadmin', 'Superfinance']);

/**
 * Expand "All" into concrete board recipient groups.
 */
export const expandAnnouncementRecipientGroups = (recipientGroups = []) => {
  const normalized = Array.isArray(recipientGroups) ? recipientGroups : [];
  if (normalized.includes('All')) {
    return [...ALL_BOARD_RECIPIENT_GROUPS];
  }
  return normalized.filter((group) => ALL_BOARD_RECIPIENT_GROUPS.includes(group));
};

/**
 * Resolve distinct email addresses for announcement recipient groups.
 * Guardians use guardianstbl.email (linked through their student branch).
 */
export const resolveAnnouncementRecipientEmails = async ({
  recipientGroups = [],
  branchId = null,
}) => {
  const groups = expandAnnouncementRecipientGroups(recipientGroups);
  const emails = [];

  for (const group of groups) {
    if (group === 'Guardians') {
      const guardianEmails = await fetchGuardianEmails(branchId);
      emails.push(...guardianEmails);
      continue;
    }

    const userType = USER_TYPE_BY_RECIPIENT_GROUP[group];
    if (!userType) continue;

    const userEmails = await fetchUserEmailsForType(userType, branchId);
    emails.push(...userEmails);
  }

  return normalizeNotificationRecipients(emails);
};

async function fetchUserEmailsForType(userType, branchId) {
  const params = [userType];
  let sql = `
    SELECT DISTINCT u.email
    FROM userstbl u
    WHERE u.email IS NOT NULL
      AND BTRIM(u.email) <> ''
      AND u.user_type = $1
  `;

  if (branchId != null && !NETWORK_WIDE_USER_TYPES.has(userType)) {
    params.push(branchId);
    if (userType === 'Finance') {
      sql += ` AND (u.branch_id = $2 OR u.branch_id IS NULL)`;
    } else {
      sql += ` AND u.branch_id = $2`;
    }
  }

  const result = await query(sql, params);
  return result.rows.map((row) => row.email);
}

async function fetchGuardianEmails(branchId) {
  const params = [];
  let sql = `
    SELECT DISTINCT g.email
    FROM guardianstbl g
    INNER JOIN userstbl u ON u.user_id = g.student_id
    WHERE g.email IS NOT NULL
      AND BTRIM(g.email) <> ''
  `;

  if (branchId != null) {
    params.push(branchId);
    sql += ` AND u.branch_id = $1`;
  }

  const result = await query(sql, params);
  return result.rows.map((row) => row.email);
}

const formatBodyHtml = (body) => {
  const html = escapeHtml(String(body || ''))
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '<br />');
  return `<p style="margin:0;color:#111827;font-size:16px;line-height:1.6;">${html}</p>`;
};

/**
 * Build branded HTML for announcement notification emails.
 * Layout matches a marketing-style post: hero image first, then the message.
 */
export const buildAnnouncementEmailHtml = ({
  title,
  body,
  attachmentUrl,
  imageSrc = null,
}) => {
  const showHeroImage = Boolean(imageSrc);
  const isImage = isAnnouncementImageUrl(attachmentUrl);
  const fileLink =
    attachmentUrl && !isImage
      ? `<p style="margin:16px 0 0 0"><strong>Attachment:</strong> <a href="${escapeHtml(
          attachmentUrl
        )}">View attachment</a></p>`
      : '';

  const heroImage = showHeroImage
    ? `
      <div style="margin:-30px -30px 20px -30px;line-height:0;">
        <img
          src="${escapeHtml(imageSrc)}"
          alt="${escapeHtml(title || 'Announcement')}"
          width="600"
          style="width:100%;max-width:100%;height:auto;display:block;border:0;outline:none;text-decoration:none;"
        />
      </div>`
    : '';

  const inner = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937">
      ${heroImage}
      ${formatBodyHtml(body)}
      ${fileLink}
    </div>
  `;

  return wrapBrandedEmailHtml(inner);
};

/**
 * Send announcement emails to resolved recipient groups.
 * Skips quietly when email is not configured or status is not Active.
 */
export const sendAnnouncementCreatedEmails = async ({
  announcement,
  branchName = '',
}) => {
  if (!announcement || String(announcement.status || '') !== 'Active') {
    return { skipped: true, reason: 'inactive_or_draft' };
  }

  if (!isEmailConfigured()) {
    console.warn('[announcementRecipientEmails] Email not configured; skipping announcement emails.');
    return { skipped: true, reason: 'email_not_configured' };
  }

  const recipientGroups = announcement.recipient_groups || [];
  const branchId =
    announcement.branch_id != null && announcement.branch_id !== ''
      ? Number(announcement.branch_id)
      : null;

  const recipients = await resolveAnnouncementRecipientEmails({
    recipientGroups,
    branchId: Number.isFinite(branchId) ? branchId : null,
  });

  if (recipients.length === 0) {
    return { skipped: true, reason: 'no_recipients', attempted: 0, sent: 0, failed: 0 };
  }

  const customSubject = String(announcement.email_subject || '').trim();
  const title = String(announcement.title || '').trim();
  const subject = customSubject || (title ? `[Announcement] ${title}` : 'New announcement');

  const attachmentUrl = announcement.attachment_url || '';
  const imageSrc = await resolveAnnouncementImageSrcForEmail(attachmentUrl);

  const html = buildAnnouncementEmailHtml({
    title: announcement.title,
    body: announcement.body,
    attachmentUrl,
    imageSrc,
  });

  const summary = await sendSystemNotificationEmailToEach({
    recipients,
    subject,
    html,
  });

  console.log('[announcementRecipientEmails] Announcement email dispatch complete:', {
    announcementId: announcement.announcement_id,
    ...summary,
  });

  return summary;
};
