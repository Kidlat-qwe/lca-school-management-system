import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { buildPhaseInstallmentSchedule } from '../utils/phaseInstallmentUtils.js';

const EMAIL = 'aelia%'; // broaden search
const NAME = 'Pelito';

const client = await getClient();
try {
  const users = await client.query(
    `SELECT user_id, full_name, email FROM userstbl
     WHERE full_name ILIKE $1 OR email ILIKE $2`,
    [`%${NAME}%`, '%pelito%']
  );
  console.log('Users:', users.rows);

  for (const u of users.rows) {
    const profiles = await client.query(
      `SELECT ip.*, ii.next_generation_date, ii.next_invoice_month, ii.status AS ii_status,
              c.class_name
       FROM installmentinvoiceprofilestbl ip
       LEFT JOIN installmentinvoicestbl ii ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       LEFT JOIN classestbl c ON c.class_id = ip.class_id
       WHERE ip.student_id = $1`,
      [u.user_id]
    );
    console.log('\nProfiles for', u.full_name);
    for (const p of profiles.rows) {
      console.log({
        profile_id: p.installmentinvoiceprofiles_id,
        class: p.class_name,
        class_id: p.class_id,
        phase_start: p.phase_start,
        total_phases: p.total_phases,
        generated_count: p.generated_count,
        is_active: p.is_active,
        queue: {
          gen: p.next_generation_date,
          month: p.next_invoice_month,
          status: p.ii_status,
        },
      });

      const inv = await client.query(
        `SELECT invoice_id, invoice_ar_number, status,
                TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
                TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd,
                remarks
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY issue_date ASC`,
        [p.installmentinvoiceprofiles_id]
      );
      console.log('Invoices:', inv.rows);

      const enroll = await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status, removed_at, removed_reason
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number, classstudent_id`,
        [u.user_id, p.class_id]
      );
      console.log('Enrollment:', enroll.rows);

      const sched = await buildPhaseInstallmentSchedule({
        db: client,
        profile: p,
        generatedCountOverride: parseInt(p.generated_count || 0, 10),
      });
      console.log('Canonical next:', {
        phase: sched?.current_phase_number,
        gen: sched?.current_generation_date,
        month: sched?.current_invoice_month,
      });
    }
  }
} finally {
  client.release();
}
