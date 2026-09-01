/**
 * Clear first-enrollment onboarding idempotency logs (no billing/class changes).
 *
 * Use after hard-delete if emails still skip with reason "already_sent", or to
 * re-test the 5-email sequence without wiping enrollment again.
 *
 *   node backend/scripts/clearFirstEnrollmentOnboardingLogs.js --email=student@example.com
 *   node backend/scripts/clearFirstEnrollmentOnboardingLogs.js --development --email=student@example.com
 */

import '../config/loadEnv.js';
import { query } from '../config/database.js';
import { clearOnboardingEmailLogsForStudents } from '../utils/firstEnrollmentWelcomeEmail/index.js';

function resolveEmail(argv) {
  const explicit = argv.find((a) => a.startsWith('--email='));
  if (explicit) return explicit.slice('--email='.length).trim().toLowerCase();
  const dashed = argv.find((a) => /^--[^=]+@[^=]+$/.test(a));
  if (dashed) return dashed.slice(2).trim().toLowerCase();
  const bare = argv.find((a) => a.includes('@') && !a.startsWith('--'));
  if (bare) return bare.trim().toLowerCase();
  return 'it.kier@little-champion.com';
}

async function main() {
  const email = resolveEmail(process.argv);
  const studentRes = await query(
    `SELECT user_id, full_name, email
     FROM userstbl
     WHERE user_type = 'Student'
       AND LOWER(TRIM(email)) = $1
     LIMIT 1`,
    [email]
  );

  if (!studentRes.rows[0]) {
    throw new Error(`No student found for ${email}`);
  }

  const student = studentRes.rows[0];
  const cleared = await clearOnboardingEmailLogsForStudents([student.user_id]);
  console.log(
    `Cleared ${cleared} onboarding log(s) for ${student.full_name} <${student.email}> (id=${student.user_id})`
  );
  console.log(
    'Next: re-enroll the student, or run sendTestFirstEnrollmentWelcomeEmail.js --force-sequence'
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
