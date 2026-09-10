/**
 * Lewis Marcus Lacorte Medina (daryllanne.medina@gmail.com, user 8) —
 * Align Phase 2–7 issue/due dates + enrollment statuses.
 *
 * Profile 44 · Class 25 SOMO_Nursery_MWF_9:30-10:30AM · Branch 3
 *
 * Target:
 *   P1 CS 147 new (unchanged dates)
 *   P2 INV-217  Mar 25 / Apr 5  · re_enrolled
 *   P3 INV-620  Apr 25 / May 5  · re_enrolled
 *   P4 INV-1058 May 25 / Jun 5  · re_enrolled
 *   P5 INV-1339/1340/1910 Jun 25 / Jul 5 · re_enrolled
 *   P6 INV-1911/1912 Jul 25 / Aug 5 · re_enrolled
 *   P7 INV-2283 Aug 25 / Sep 5 · Unpaid (clear 10% penalty → ₱4,236); no enrollment (blank)
 *   Profile is_active true; generated_count 7; queue Sep 25 / Oct 01
 *
 * Run (from backend/):
 *   node scripts/repairLewisMedinaPhaseDatesEnrollment.js --production
 *   node scripts/repairLewisMedinaPhaseDatesEnrollment.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 8;
const STUDENT_EMAIL = 'daryllanne.medina@gmail.com';
const CLASS_ID = 25;
const PROFILE_ID = 44;
const PHASE_FEE = 4236;

const EXPECTED_GENERATED_COUNT = 7;
const NEXT_GEN = '2026-09-25';
const NEXT_MONTH = '2026-10-01';

const REPAIR_NOTE =
  'Ops repair 2026-09-08 — Lewis Medina Phase 2–7 dates + P2–6 re_enrolled; P7 clear penalty, no enrollment';

/** @type {{ phase: number, invoiceIds: number[], issue: string, due: string, enrollmentStatus: string|null, classstudentId: number|null, enrolledAt: string|null, clearPenalty?: boolean, removeEnrollment?: boolean }[]} */
const PHASE_FIXES = [
  {
    phase: 2,
    invoiceIds: [217],
    issue: '2026-03-25',
    due: '2026-04-05',
    enrollmentStatus: 're_enrolled',
    classstudentId: 293,
    enrolledAt: '2026-03-25',
  },
  {
    phase: 3,
    invoiceIds: [620],
    issue: '2026-04-25',
    due: '2026-05-05',
    enrollmentStatus: 're_enrolled',
    classstudentId: 691,
    enrolledAt: '2026-04-25',
  },
  {
    phase: 4,
    invoiceIds: [1058],
    issue: '2026-05-25',
    due: '2026-06-05',
    enrollmentStatus: 're_enrolled',
    classstudentId: 1171,
    enrolledAt: '2026-05-25',
  },
  {
    phase: 5,
    invoiceIds: [1339, 1340, 1910],
    issue: '2026-06-25',
    due: '2026-07-05',
    enrollmentStatus: 're_enrolled',
    classstudentId: 1677,
    enrolledAt: '2026-06-25',
  },
  {
    phase: 6,
    invoiceIds: [1911, 1912],
    issue: '2026-07-25',
    due: '2026-08-05',
    enrollmentStatus: 're_enrolled',
    classstudentId: 1679,
    enrolledAt: '2026-07-25',
  },
  {
    phase: 7,
    invoiceIds: [2283],
    issue: '2026-08-25',
    due: '2026-09-05',
    enrollmentStatus: null,
    classstudentId: 2621,
    enrolledAt: null,
    clearPenalty: true,
    removeEnrollment: true,
  },
];

const isApply = process.argv.includes('--apply');

function appendNote(existing, note, maxLen = 2000) {
  const cur = String(existing || '').trim();
  const add = String(note || '').trim();
  if (!add) return cur || null;
  if (cur.toLowerCase().includes(add.toLowerCase())) return cur;
  if (!cur) return add.length <= maxLen ? add : add.slice(0, maxLen);
  const joined = `${cur};${add}`;
  if (joined.length <= maxLen) return joined;
  return cur.length <= maxLen ? cur : cur.slice(0, maxLen);
}

async function loadInvoice(client, invoiceId) {
  const res = await client.query(
    `SELECT invoice_id, status, remarks, amount::text,
            installmentinvoiceprofiles_id,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due
     FROM invoicestbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );
  return res.rows[0] || null;
}

async function main() {
  console.log(
    `\nLewis Medina — Phase 2–7 dates + enrollment${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log(`Note: ${REPAIR_NOTE}`);
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);
  if (process.env.DB_NAME !== 'psms_production') {
    console.warn('⚠️ Expected psms_production. Pass --production.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const student = (
      await client.query(
        `SELECT user_id, full_name, email
         FROM userstbl
         WHERE user_id = $1
           AND LOWER(TRIM(email)) = LOWER(TRIM($2))
           AND user_type = 'Student'`,
        [STUDENT_ID, STUDENT_EMAIL]
      )
    ).rows[0];
    if (!student) throw new Error('Student not found');
    console.log(`Student: ${student.full_name} (${student.email})`);

    const profile = (
      await client.query(
        `SELECT ip.installmentinvoiceprofiles_id, ip.class_id, ip.generated_count, ip.is_active,
                ii.installmentinvoicedtl_id,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1
           AND ip.student_id = $2
           AND ip.class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    console.log('Profile before:', profile);

    const p1 = (
      await client.query(
        `SELECT classstudent_id, program_enrollment_status
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 1`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!p1 || String(p1.program_enrollment_status) !== 'new') {
      throw new Error(`Phase 1 enrollment expected new, got ${p1?.program_enrollment_status}`);
    }
    console.log(`Phase 1 CS ${p1.classstudent_id}: new (keep)`);

    console.log('\nBefore:');
    for (const fix of PHASE_FIXES) {
      for (const invId of fix.invoiceIds) {
        const inv = await loadInvoice(client, invId);
        if (!inv) throw new Error(`INV-${invId} missing`);
        if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
          throw new Error(`INV-${invId} not on profile ${PROFILE_ID}`);
        }
        const tp = parseTargetPhase(inv.remarks);
        if (tp != null && Number(tp) !== fix.phase) {
          throw new Error(`INV-${invId} TARGET_PHASE=${tp}, expected ${fix.phase}`);
        }
        console.log(
          `  P${fix.phase} INV-${invId}: ${inv.issue}/${inv.due} ${inv.status} amount ${inv.amount}`
        );
      }
      if (fix.classstudentId) {
        const cs = (
          await client.query(
            `SELECT classstudent_id, program_enrollment_status, removed_at IS NOT NULL AS removed
             FROM classstudentstbl
             WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3`,
            [fix.classstudentId, STUDENT_ID, CLASS_ID]
          )
        ).rows[0];
        if (!cs) throw new Error(`Missing CS ${fix.classstudentId}`);
        console.log(
          `  P${fix.phase} CS ${cs.classstudent_id}: ${cs.program_enrollment_status}` +
            (cs.removed ? ' (removed)' : '')
        );
      }
    }

    const phase7Inv = await loadInvoice(client, 2283);
    if (!phase7Inv) throw new Error('Phase 7 INV-2283 missing');
    if (String(phase7Inv.status) === 'Paid') {
      console.log('  · Phase 7 already Paid — will still blank enrollment; skip penalty/date writes if already correct');
    } else {
      const p7Pays = (
        await client.query(
          `SELECT payment_id FROM paymenttbl
           WHERE invoice_id = 2283 AND status = 'Completed'`
        )
      ).rows;
      if (p7Pays.length) {
        throw new Error('Phase 7 has completed payments but status is not Paid — abort');
      }
    }

    console.log('\nPlanned:');
    for (const fix of PHASE_FIXES) {
      console.log(
        `  P${fix.phase}: invoices ${fix.invoiceIds.join(',')} → ${fix.issue}/${fix.due}` +
          (fix.removeEnrollment
            ? '; enrollment → blank (delete)'
            : fix.enrollmentStatus
              ? `; enrollment → ${fix.enrollmentStatus}`
              : '') +
          (fix.clearPenalty ? '; clear 10% penalty → ₱4236' : '')
      );
    }
    console.log(
      `  Profile is_active=true; generated_count=${EXPECTED_GENERATED_COUNT}; queue ${NEXT_GEN}/${NEXT_MONTH}`
    );

    for (const fix of PHASE_FIXES) {
      for (const invId of fix.invoiceIds) {
        const inv = await loadInvoice(client, invId);
        const datesAlreadyOk = inv.issue === fix.issue && inv.due === fix.due;
        const skipPenaltyClear =
          fix.clearPenalty &&
          (String(inv.status) === 'Paid' || Number(inv.amount) === PHASE_FEE);

        if (fix.clearPenalty && !skipPenaltyClear) {
          await client.query(
            `DELETE FROM invoiceitemstbl
             WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
            [invId]
          );
          await client.query(
            `UPDATE invoiceitemstbl
             SET amount = $1, penalty_amount = 0
             WHERE invoice_id = $2
               AND description ILIKE 'Installment plan%'`,
            [PHASE_FEE, invId]
          );
          const itemCount = (
            await client.query(
              `SELECT COUNT(*)::int AS n FROM invoiceitemstbl WHERE invoice_id = $1`,
              [invId]
            )
          ).rows[0].n;
          if (itemCount === 0) {
            await client.query(
              `INSERT INTO invoiceitemstbl
                 (invoice_id, description, amount, tax_item, tax_percentage, discount_amount, penalty_amount)
               VALUES ($1, $2, $3, NULL, 0, 0, 0)`,
              [
                invId,
                'Installment plan for Lewis Marcus Lacorte Medina - Nursery',
                PHASE_FEE,
              ]
            );
          }
        }

        if (datesAlreadyOk && (skipPenaltyClear || !fix.clearPenalty)) {
          console.log(`  · INV-${invId} already ${fix.issue}/${fix.due}`);
        } else {
          await client.query(
            `UPDATE invoicestbl
             SET issue_date = ($1::date + TIME '12:00'),
                 due_date = ($2::date + TIME '12:00'),
                 late_penalty_applied_for_due_date = NULL,
                 amount = CASE WHEN $4::boolean THEN $5::numeric ELSE amount END,
                 remarks = $3
             WHERE invoice_id = $6`,
            [
              fix.issue,
              fix.due,
              appendNote(inv.remarks, REPAIR_NOTE),
              Boolean(fix.clearPenalty) && !skipPenaltyClear,
              PHASE_FEE,
              invId,
            ]
          );
          try {
            await syncProgramPaymentStatusForInvoice(client, invId);
          } catch (e) {
            console.warn(`⚠ syncProgramPaymentStatus INV-${invId}:`, e.message);
          }
          console.log(
            `→ INV-${invId}: ${fix.issue}/${fix.due}` +
              (fix.clearPenalty && !skipPenaltyClear ? ` amount ₱${PHASE_FEE}` : '')
          );
        }
      }

      if (fix.removeEnrollment) {
        const p7Enrolls = (
          await client.query(
            `SELECT classstudent_id
             FROM classstudentstbl
             WHERE student_id = $1 AND class_id = $2 AND phase_number = $3`,
            [STUDENT_ID, CLASS_ID, fix.phase]
          )
        ).rows;
        for (const row of p7Enrolls) {
          await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
            row.classstudent_id,
          ]);
          console.log(`→ DELETE Phase ${fix.phase} CS ${row.classstudent_id} (blank enrollment)`);
        }
        if (!p7Enrolls.length) {
          console.log(`  · No Phase ${fix.phase} enrollment rows (already blank)`);
        }
      } else if (fix.classstudentId && fix.enrollmentStatus) {
        await client.query(
          `UPDATE classstudentstbl
           SET program_enrollment_status = $1,
               enrolled_at = COALESCE($2::timestamp, enrolled_at),
               removed_at = NULL,
               removed_reason = NULL,
               removed_by = NULL
           WHERE classstudent_id = $3
             AND student_id = $4
             AND class_id = $5`,
          [
            fix.enrollmentStatus,
            fix.enrolledAt ? `${fix.enrolledAt} 12:00:00` : null,
            fix.classstudentId,
            STUDENT_ID,
            CLASS_ID,
          ]
        );
        console.log(
          `→ CS ${fix.classstudentId}: → ${fix.enrollmentStatus}` +
            (fix.enrolledAt ? ` enrolled_at ${fix.enrolledAt}` : '')
        );
      }
    }

    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET generated_count = $1,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $2
         AND student_id = $3`,
      [EXPECTED_GENERATED_COUNT, PROFILE_ID, STUDENT_ID]
    );

    if (!profile.installmentinvoicedtl_id) {
      throw new Error('No installment queue row');
    }
    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = NULL,
           next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = $1::date
       WHERE installmentinvoicedtl_id = $3
         AND installmentinvoiceprofiles_id = $4`,
      [NEXT_GEN, NEXT_MONTH, profile.installmentinvoicedtl_id, PROFILE_ID]
    );
    console.log(
      `→ Profile active, generated_count=${EXPECTED_GENERATED_COUNT}, queue ${NEXT_GEN}/${NEXT_MONTH}`
    );

    console.log('\nAfter (in transaction):');
    for (const fix of PHASE_FIXES) {
      for (const invId of fix.invoiceIds) {
        const inv = await loadInvoice(client, invId);
        console.log(
          `  P${fix.phase} INV-${invId}: ${inv.issue}/${inv.due} ${inv.status} amount ${inv.amount}`
        );
        if (inv.issue !== fix.issue || inv.due !== fix.due) {
          throw new Error(`INV-${invId} date validation failed`);
        }
        if (fix.clearPenalty && String(inv.status) !== 'Paid' && Number(inv.amount) !== PHASE_FEE) {
          throw new Error(`INV-${invId} amount expected ${PHASE_FEE}, got ${inv.amount}`);
        }
      }
      if (fix.removeEnrollment) {
        const left = (
          await client.query(
            `SELECT classstudent_id FROM classstudentstbl
             WHERE student_id = $1 AND class_id = $2 AND phase_number = $3`,
            [STUDENT_ID, CLASS_ID, fix.phase]
          )
        ).rows;
        console.log(
          `  P${fix.phase} enrollment: ${left.length ? left.map((r) => r.classstudent_id).join(',') : 'blank'}`
        );
        if (left.length) {
          throw new Error(`Phase ${fix.phase} enrollment should be blank`);
        }
      } else if (fix.classstudentId) {
        const cs = (
          await client.query(
            `SELECT program_enrollment_status, removed_at IS NOT NULL AS removed,
                    TO_CHAR(TIMEZONE('Asia/Manila', enrolled_at), 'YYYY-MM-DD') AS enrolled
             FROM classstudentstbl WHERE classstudent_id = $1`,
            [fix.classstudentId]
          )
        ).rows[0];
        console.log(
          `  P${fix.phase} CS ${fix.classstudentId}: ${cs.program_enrollment_status} enrolled ${cs.enrolled}`
        );
        if (cs.program_enrollment_status !== fix.enrollmentStatus || cs.removed) {
          throw new Error(`CS ${fix.classstudentId} enrollment validation failed`);
        }
      }
    }

    const p1After = (
      await client.query(
        `SELECT program_enrollment_status FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2 AND phase_number = 1`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (p1After.program_enrollment_status !== 'new') {
      throw new Error('Phase 1 must remain new');
    }

    const profileAfter = (
      await client.query(
        `SELECT ip.generated_count, ip.is_active,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
                TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month
         FROM installmentinvoiceprofilestbl ip
         LEFT JOIN installmentinvoicestbl ii
           ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
         WHERE ip.installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    console.log('Profile/queue:', profileAfter);
    if (
      Number(profileAfter.generated_count) !== EXPECTED_GENERATED_COUNT ||
      profileAfter.is_active !== true ||
      profileAfter.next_gen !== NEXT_GEN ||
      profileAfter.next_month !== NEXT_MONTH
    ) {
      throw new Error('profile/queue validation failed');
    }

    console.log('\n✅ Repair verified.');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\n✅ Applied.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — rolled back. Re-run with --apply to commit.');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\nFailed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
