/**
 * Lesson Plans UI feature flag.
 * Hidden by default — set VITE_LESSON_PLANS_ENABLED=true in frontend env to show.
 */
export const LESSON_PLANS_ENABLED =
  String(import.meta.env.VITE_LESSON_PLANS_ENABLED || '').toLowerCase() === 'true';
