import '../config/loadEnv.js';
import { query } from '../config/database.js';

const names = ['Gabriel Allen Balagtas', 'Lebron James', 'gabrielallen@gmail.com', 'lbj@gmail.com'];

const users = await query(
  `SELECT user_id, full_name, email FROM userstbl
   WHERE full_name ILIKE ANY($1::text[]) OR email ILIKE ANY($1::text[])`,
  [names.map((n) => `%${n.split('@')[0]}%`)]
);

console.log('USERS:', users.rows);

for (const u of users.rows) {
  const cs = await query(
    `SELECT cs.classstudent_id, cs.class_id, cs.phase_number, cs.program_enrollment_status,
            cs.enrolled_by, cs.enrolled_at, cs.removed_at, cs.removed_reason,
            c.class_name, c.level_tag
     FROM classstudentstbl cs
     LEFT JOIN classestbl c ON c.class_id = cs.class_id
     WHERE cs.student_id = $1
     ORDER BY cs.class_id, cs.phase_number, cs.removed_at NULLS FIRST`,
    [u.user_id]
  );
  console.log(`\n=== ${u.full_name} (${u.email}) classstudent rows ===`);
  console.log(JSON.stringify(cs.rows, null, 2));

  const inv = await query(
    `SELECT i.invoice_id, i.invoice_description, i.status, i.remarks, i.installmentinvoiceprofiles_id
     FROM invoicestbl i
     JOIN invoicestudentstbl ist ON ist.invoice_id = i.invoice_id
     WHERE ist.student_id = $1
     ORDER BY i.invoice_id`,
    [u.user_id]
  );
  console.log('INVOICES:', inv.rows.length);
  inv.rows.forEach((r) =>
    console.log(`  ${r.invoice_id} ${r.status} ${r.invoice_description?.slice(0, 50)} | ${r.remarks?.slice(0, 80)}`)
  );

  const ip = await query(
    `SELECT installmentinvoiceprofiles_id, class_id, phase_start, total_phases, generated_count,
            downpayment_paid, downpayment_invoice_id, is_active
     FROM installmentinvoiceprofilestbl WHERE student_id = $1 ORDER BY installmentinvoiceprofiles_id`,
    [u.user_id]
  );
  console.log('PROFILES:', ip.rows);
}

process.exit(0);
