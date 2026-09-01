/**
 * Default Settings → Templates values for the first-enrollment onboarding sequence.
 * Placeholders use {curlyBraces} — substituted at send time.
 */

export const FIRST_ENROLLMENT_TEMPLATE_KEYS = Object.freeze({
  onboarding: 'template_first_enrollment_onboarding',
  class_schedule: 'template_first_enrollment_class_schedule',
  things_to_prepare: 'template_first_enrollment_things_to_prepare',
  important_reminders: 'template_first_enrollment_important_reminders',
  stay_connected: 'template_first_enrollment_stay_connected',
});

export const FIRST_ENROLLMENT_TEMPLATE_DEFAULTS = Object.freeze({
  [FIRST_ENROLLMENT_TEMPLATE_KEYS.onboarding]: {
    title: 'Welcome to Little Champions Academy!',
    subject: 'Welcome to Little Champions Academy!',
    body:
      'Congratulations!\n\n' +
      'We are pleased to inform you that your child is officially enrolled at Little Champions Academy Inc. for Academic Year {academicYear}.\n\n' +
      'We are delighted to welcome you to the Little Champions family! We look forward to partnering with you in creating a meaningful and exciting learning journey filled with opportunities to play, learn, and succeed.\n\n' +
      'Thank you for choosing Little Champions Academy. We are excited to have you with us!\n\n' +
      'Welcome to Little Champions Academy!\n' +
      '{arAttachmentNote}\n\n' +
      'Best Regards,\n' +
      'Little Champions Academy Inc.\n' +
      'Play . Learn . Succeed',
    enabled: true,
  },
  [FIRST_ENROLLMENT_TEMPLATE_KEYS.class_schedule]: {
    title: 'Your Class Schedule',
    subject: 'Your Class Schedule – Little Champions Academy',
    body:
      'FIRST DAY OF SCHOOL\n\n' +
      'Date: {classStartDate}\n\n' +
      'Class Schedule: {classSchedule}\n\n' +
      'Important: Please arrive at least 10 minutes before your scheduled class time to allow your child sufficient time to settle in and prepare for class.\n\n' +
      'For dismissal, parents or authorized guardians are requested to arrive 10 minutes before the scheduled end of class to ensure a smooth and orderly pick-up.\n\n' +
      'Best Regards,\n' +
      'Little Champions Academy Inc.\n' +
      'Play . Learn . Succeed',
    enabled: true,
  },
  [FIRST_ENROLLMENT_TEMPLATE_KEYS.things_to_prepare]: {
    title: 'Things to Prepare for Class',
    subject: 'Things to Prepare for Class – Little Champions Academy',
    body:
      'Please ensure that your child brings the following:\n\n' +
      '1. Extra set of clothes\n\n' +
      '2. Hygiene Kit (Wet wipes, alcohol, tissue, soap)\n\n' +
      '3. Dry, healthy, and nutritious snack\n\n' +
      '4. A refillable and sealed water bottle labeled with your child’s complete name\n\n' +
      'Best Regards,\n' +
      'Little Champions Academy Inc.\n' +
      'Play . Learn . Succeed',
    enabled: true,
  },
  [FIRST_ENROLLMENT_TEMPLATE_KEYS.important_reminders]: {
    title: 'Important Reminders',
    subject: 'Important Reminders – Little Champions Academy',
    body:
      'IMPORTANT REMINDERS\n\n' +
      '• Please ensure that your child arrives at least 10 minutes before the scheduled class time.\n\n' +
      '• Please prepare all necessary school items before leaving home to avoid delays.\n\n' +
      '• Kindly label all personal belongings with your child’s complete name.\n\n' +
      '• Please ensure that your child is well-rested and prepared to participate in class.\n\n' +
      '• Please regularly check the official class group chat for announcements, reminders, and other important information.\n\n' +
      '• Kindly complete the required onboarding requirements before your child’s first day of school.\n\n' +
      'Best Regards,\n' +
      'Little Champions Academy Inc.\n' +
      'Play . Learn . Succeed',
    enabled: true,
  },
  [FIRST_ENROLLMENT_TEMPLATE_KEYS.stay_connected]: {
    title: 'Stay Connected',
    subject: 'Stay Connected – Little Champions Academy',
    body:
      'STAY CONNECTED\n\n' +
      'For the latest updates, you can also follow and message our official Facebook page and group chat:\n\n' +
      'Facebook page link: Little Champions Academy Inc. ({facebookUrl})\n\n' +
      '{groupChatLine}\n\n' +
      'Once again, welcome to Little Champions Academy, Inc. We look forward to partnering with you throughout the academic year and supporting your child’s continued learning and development.\n\n' +
      'Sincerely,\n\n' +
      'Little Champions Academy, Inc.\n\n' +
      'Play. Learn. Succeed.',
    enabled: true,
  },
});
