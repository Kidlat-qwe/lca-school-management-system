import { query } from '../config/database.js';
import { canUserCreateAnnouncement } from '../lib/announcementCreators/index.js';

/**
 * Requires the current user to be allowed to create/manage board announcements
 * per Superadmin Settings (Superadmin always passes).
 */
export async function requireAnnouncementCreator(req, res, next) {
  try {
    const allowed = await canUserCreateAnnouncement(query, req.user);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message:
          'You do not have permission to create or manage announcements. Contact your Superadmin.',
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}
