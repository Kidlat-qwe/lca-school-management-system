/**
 * Repair installment issue/due dates + queue for SOMO_JULY classes after
 * class start dates moved into July.
 *
 * Rules:
 *   - Paid / partially paid phase invoices: KEEP issue/due dates unchanged
 *   - Unpaid phase 1: align issue 2026-06-25, due 2026-07-05 (clear penalty)
 *   - Unpaid phase 2+: delete (premature; not generated yet)
 *   - Queue after phase 1 only (paid or unpaid): 2026-07-25 / 2026-08-01
 *   - Queue after phase 2 paid remains: 2026-08-25 / 2026-09-01
 *   - Restore phase-1 enrollments dropped for delinquency on pre-July due dates
 *
 * Batches:
 *   1 — SOMO_JULY MWF (start June 3 → July 1)
 *   2 — SOMO_JULY TTHS (start June 4 → July 2)
 *   3 — NC_Nursery_TTHS 4PM
 *
 * Run:
 *   node backend/scripts/repairSomoJulyClassInstallmentDates.js --batch 3
 *   node backend/scripts/repairSomoJulyClassInstallmentDates.js --batch 3 --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const BATCHES = {
  1: {
    label: 'MWF (June 3 → July 1)',
    note: 'Ops repair 2026-07-04 — SOMO_JULY MWF class start June 3→July 1 installment date realign',
    classes: [
      'SOMO_JULY_Nursery_MWF_11AM',
      'SOMO_JULY_Nursery_MWF 2:30 PM',
      'SOMO_JULY_Nursery_MWF_4:00-5:00PM',
      'SOMO_JULY_Pre-Kinder_MWF_9:30 AM',
      'SOMO_JULY_Pre-Kinder_MWF 11 AM',
      'SOMO_JULY_Pre-Kinder_MWF 1 PM',
      'SOMO_JULY_Pre-Kinder_MWF_2:30 PM',
    ],
  },
  2: {
    label: 'TTHS (June 4 → July 2)',
    note: 'Ops repair 2026-07-04 — SOMO_JULY TTHS class start June 4→July 2 installment date realign',
    classes: [
      'SOMO_JULY_Nursery_TTHS_9:30AM',
      'SOMO_JULY_Pre-Kinder_TThS_9:30 AM',
      'SOMO_JULY_Pre-Kinder_TThS_4:00 PM',
    ],
  },
  3: {
    label: 'NC_Nursery_TTHS 4PM',
    note: 'Ops repair 2026-07-04 — NC_Nursery_TTHS 4PM installment date realign',
    classes: ['NC_Nursery_TTHS 4PM'],
  },
};

const PHASE1_ISSUE = '2026-06-25';
const PHASE1_DUE = '2026-07-05';
const QUEUE_AFTER_P1 = { gen: '2026-07-25', month: '2026-08-01' };
const QUEUE_AFTER_P2 = { gen: '2026-08-25', month: '2026-09-01' };

function parseArgs() {
  const argv = process.argv.slice(2);
  let batch = 2;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') apply = true;
    else if (argv[i] === '--batch' && argv[i + 1]) {
      batch = Number(argv[++i]);
    }     else if (argv[i] === '--batch=1') batch = 1;
    else if (argv[i] === '--batch=2') batch = 2;
    else if (argv[i] === '--batch=3') batch = 3;
  }
  if (!BATCHES[batch]) {
    throw new Error(`Unknown batch ${batch}. Use --batch 1, 2, or 3.`);
  }
  return { batch, apply, config: BATCHES[batch] };
}

const { batch: BATCH_NUM, apply: isApply, config: BATCH } = parseArgs();
const CLASS_NAME_PATTERNS = BATCH.classes;
const REPAIR_NOTE = BATCH.note;

const ymd = (v) => (v == null ? '' : String(v).slice(0, 10));

async function clearInvoicePenalty(client, invoiceId) {
  const items = await client.query(
    `SELECT invoice_item_id, penalty_amount, amount
     FROM invoiceitemstbl
     WHERE invoice_id = $1 AND COALESCE(penalty_amount, 0) > 0`,
    [invoiceId]
  );
  for (const item of items.rows) {
    const penalty = Number(item.penalty_amount) || 0;
    const amount = Number(item.amount) || 0;
    await client.query(
      `UPDATE invoiceitemstbl
       SET amount = $1, penalty_amount = 0
       WHERE invoice_item_id = $2`,
      [Math.max(0, amount - penalty), item.invoice_item_id]
    );
  }
  if (items.rows.length) {
    const totals = await client.query(
      `SELECT COALESCE(SUM(amount), 0) - COALESCE(SUM(COALESCE(discount_amount, 0)), 0)
              + COALESCE(SUM(COALESCE(penalty_amount, 0)), 0) AS grand
       FROM invoiceitemstbl WHERE invoice_id = $1`,
      [invoiceId]
    );
    await client.query(
      `UPDATE invoicestbl
       SET amount = $1, late_penalty_applied_for_due_date = NULL
       WHERE invoice_id = $2`,
      [Number(totals.rows[0]?.grand || 0), invoiceId]
    );
  }
  return items.rows.length > 0;
}

async function deleteInvoiceCascade(client, invoiceId) {
  const payments = await client.query(
    `SELECT payment_id FROM paymenttbl WHERE invoice_id = $1`,
    [invoiceId]
  );
  if (payments.rows.length) {
    throw new Error(
      `Invoice ${invoiceId} has ${payments.rows.length} payment(s); refuse to delete`
    );
  }
  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(
    `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE balance_invoice_id = $1`,
    [invoiceId]
  );
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
}

async function loadClasses(client) {
  const classes = [];
  for (const name of CLASS_NAME_PATTERNS) {
    const res = await client.query(
      `SELECT class_id, class_name,
              TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd
       FROM classestbl
       WHERE REPLACE(LOWER(class_name), ' ', '') = REPLACE(LOWER($1), ' ', '')
          OR LOWER(class_name) = LOWER($1)
          OR LOWER(class_name) LIKE LOWER($2)
       ORDER BY class_id`,
      [name, `%${name.replace(/_/g, '%').replace(/ /g, '%')}%`]
    );
    if (!res.rows.length) {
      // Fuzzy: normalize underscores/spaces
      const fuzzy = await client.query(
        `SELECT class_id, class_name,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_ymd
         FROM classestbl
         WHERE LOWER(REGEXP_REPLACE(class_name, '[^a-z0-9]', '', 'g'))
             = LOWER(REGEXP_REPLACE($1, '[^a-z0-9]', '', 'g'))
         ORDER BY class_id`,
        [name]
      );
      if (fuzzy.rows.length) classes.push(...fuzzy.rows);
      else console.warn(`⚠ Class not found: ${name}`);
    } else {
      classes.push(...res.rows);
    }
  }
  // Dedupe by class_id
  const byId = new Map();
  for (const c of classes) byId.set(c.class_id, c);
  return [...byId.values()];
}

async function loadProfilesForClass(client, classId) {
  const res = await client.query(
    `SELECT ip.installmentinvoiceprofiles_id, ip.student_id, ip.generated_count, ip.is_active,
            ip.amount, ip.downpayment_invoice_id, ip.downpayment_paid,
            ii.installmentinvoicedtl_id,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_generation_date), 'YYYY-MM-DD') AS next_gen,
            TO_CHAR(TIMEZONE('Asia/Manila', ii.next_invoice_month), 'YYYY-MM-DD') AS next_month,
            u.full_name, u.email
     FROM installmentinvoiceprofilestbl ip
     INNER JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     INNER JOIN userstbl u ON u.user_id = ip.student_id
     WHERE ip.class_id = $1
     ORDER BY u.full_name, ip.installmentinvoiceprofiles_id`,
    [classId]
  );
  return res.rows;
}

async function loadPhaseInvoices(client, profileId) {
  const res = await client.query(
    `SELECT invoice_id, status, invoice_ar_number, amount, remarks,
            TO_CHAR(TIMEZONE('Asia/Manila', issue_date), 'YYYY-MM-DD') AS issue_ymd,
            TO_CHAR(TIMEZONE('Asia/Manila', due_date), 'YYYY-MM-DD') AS due_ymd
     FROM invoicestbl
     WHERE installmentinvoiceprofiles_id = $1
       AND remarks ILIKE '%TARGET_PHASE:%'
     ORDER BY invoice_id`,
    [profileId]
  );
  return res.rows.map((row) => ({
    ...row,
    phase: parseTargetPhase(row.remarks),
  }));
}

async function loadPhase1Enrollment(client, studentId, classId) {
  const res = await client.query(
    `SELECT classstudent_id, program_enrollment_status, removed_reason
     FROM classstudentstbl
     WHERE student_id = $1 AND class_id = $2 AND COALESCE(phase_number, 1) = 1
     ORDER BY classstudent_id
     LIMIT 1`,
    [studentId, classId]
  );
  return res.rows[0] || null;
}

function isSettledStatus(status) {
  // Any payment on the phase keeps historical issue/due dates.
  return status === 'Paid' || status === 'Partially Paid';
}

function planForProfile(profile, phaseInvoices, enrollment) {
  const phase1 = phaseInvoices.filter((i) => i.phase === 1);
  const phase2Plus = phaseInvoices.filter((i) => i.phase != null && i.phase >= 2);

  const changes = [];
  const deleteIds = [];

  // Paid phases: keep issue/due dates. Only align unpaid phase 1.
  for (const inv of phase1) {
    if (isSettledStatus(inv.status)) continue;
    const needIssue = inv.issue_ymd !== PHASE1_ISSUE;
    const needDue = inv.due_ymd !== PHASE1_DUE;
    if (needIssue || needDue) {
      changes.push({
        type: 'update_phase1_dates',
        invoice_id: inv.invoice_id,
        status: inv.status,
        from: `${inv.issue_ymd}/${inv.due_ymd}`,
        to: `${PHASE1_ISSUE}/${PHASE1_DUE}`,
        clear_penalty: true,
      });
    }
  }

  // Unpaid phase 2+: premature — delete. Paid phase 2+: keep dates.
  for (const inv of phase2Plus) {
    if (isSettledStatus(inv.status)) continue;
    deleteIds.push(inv.invoice_id);
    changes.push({
      type: 'delete_premature_phase',
      invoice_id: inv.invoice_id,
      phase: inv.phase,
      status: inv.status,
      from: `${inv.issue_ymd}/${inv.due_ymd}`,
      ar: inv.invoice_ar_number,
    });
  }

  // generated_count = highest remaining TARGET_PHASE (not row count).
  // e.g. only Phase 2 paid advance => generated_count 2, not 1.
  const remainingPhases = new Set(
    phaseInvoices
      .filter((i) => i.phase != null && !deleteIds.includes(i.invoice_id))
      .map((i) => i.phase)
  );
  const maxRemainingPhase = remainingPhases.size ? Math.max(...remainingPhases) : 0;
  const targetGenerated = maxRemainingPhase;
  const paidPhase2Remains = phase2Plus.some(
    (i) => isSettledStatus(i.status) && i.phase === 2 && !deleteIds.includes(i.invoice_id)
  );
  const targetQueue =
    maxRemainingPhase >= 2 && paidPhase2Remains ? QUEUE_AFTER_P2 : QUEUE_AFTER_P1;

  if (targetGenerated > 0 && Number(profile.generated_count) !== targetGenerated) {
    changes.push({
      type: 'set_generated_count',
      from: profile.generated_count,
      to: targetGenerated,
    });
  }
  if (profile.next_gen !== targetQueue.gen || profile.next_month !== targetQueue.month) {
    changes.push({
      type: 'set_queue',
      from: `${profile.next_gen || '—'} / ${profile.next_month || '—'}`,
      to: `${targetQueue.gen} / ${targetQueue.month}`,
    });
  }

  // Reactivate only when unpaid work remains (not fully generated).
  const hasUnpaidPhase1 = phase1.some((i) => !isSettledStatus(i.status));
  if (!profile.is_active && (hasUnpaidPhase1 || targetGenerated < (profile.total_phases || 10))) {
    changes.push({ type: 'reactivate_profile' });
  }

  const phase1Paid = phase1.some((i) => isSettledStatus(i.status));
  const phase1Unpaid = phase1.some((i) => !isSettledStatus(i.status));

  // Restore false delinquency drops.
  if (
    enrollment &&
    enrollment.program_enrollment_status === 'dropped' &&
    String(enrollment.removed_reason || '').includes('Installment delinquency')
  ) {
    changes.push({
      type: 'restore_enrollment',
      classstudent_id: enrollment.classstudent_id,
      to: phase1Paid ? 'new' : 'pending_enrollment',
      reason: enrollment.removed_reason,
    });
  }

  // Unpaid phase 1 with no enrollment row → pending_enrollment.
  if (!enrollment && phase1Unpaid && !phase1Paid) {
    changes.push({
      type: 'create_pending_enrollment',
    });
  }

  return { changes, deleteIds, targetGenerated, targetQueue };
}

async function main() {
  console.log(
    `\nSOMO_JULY installment date repair — batch ${BATCH_NUM} ${BATCH.label}${
      isApply ? ' (APPLY)' : ' (DRY RUN)'
    }\n`
  );
  console.log('Target alignment:');
  console.log('  Paid phases: KEEP issue/due dates');
  console.log(`  Unpaid phase 1: ${PHASE1_ISSUE} / ${PHASE1_DUE}`);
  console.log('  Unpaid phase 2+: DELETE (not generated yet)');
  console.log(`  Queue after phase 1 only: ${QUEUE_AFTER_P1.gen} / ${QUEUE_AFTER_P1.month}`);
  console.log(`  Queue after phase 2 paid: ${QUEUE_AFTER_P2.gen} / ${QUEUE_AFTER_P2.month}`);
  console.log('');

  const client = await getClient();
  try {
    const classes = await loadClasses(client);
    if (!classes.length) {
      throw new Error('No matching classes found');
    }

    console.log('Matched classes:');
    for (const c of classes) {
      const phase1Start = await client.query(
        `SELECT MIN(scheduled_date)::text AS d FROM classsessionstbl
         WHERE class_id = $1 AND phase_number = 1`,
        [c.class_id]
      );
      console.log(
        `  [${c.class_id}] ${c.class_name} | class.start_date=${c.start_ymd} | phase1 session start=${ymd(phase1Start.rows[0]?.d) || '—'}`
      );
    }
    console.log('');

    const allPlans = [];

    for (const cls of classes) {
      const profiles = await loadProfilesForClass(client, cls.class_id);
      for (const profile of profiles) {
        const phaseInvoices = await loadPhaseInvoices(
          client,
          profile.installmentinvoiceprofiles_id
        );
        const enrollment = await loadPhase1Enrollment(
          client,
          profile.student_id,
          cls.class_id
        );
        const plan = planForProfile(profile, phaseInvoices, enrollment);
        allPlans.push({ cls, profile, phaseInvoices, enrollment, plan });
      }
    }

    let profilesNeedingChange = 0;
    let changeCount = 0;

    for (const row of allPlans) {
      const { cls, profile, phaseInvoices, plan } = row;
      if (!plan.changes.length) continue;
      profilesNeedingChange += 1;
      changeCount += plan.changes.length;

      console.log('─'.repeat(72));
      console.log(
        `${profile.full_name} <${profile.email}> | profile ${profile.installmentinvoiceprofiles_id}`
      );
      console.log(`  Class: ${cls.class_name} (${cls.class_id})`);
      console.log(
        `  Profile: generated_count=${profile.generated_count} active=${profile.is_active} queue=${profile.next_gen || '—'} / ${profile.next_month || '—'}`
      );
      console.log('  Phase invoices:');
      for (const inv of phaseInvoices) {
        console.log(
          `    P${inv.phase} INV ${inv.invoice_id} AR ${inv.invoice_ar_number} ${inv.issue_ymd}/${inv.due_ymd} amt=${inv.amount} ${inv.status}`
        );
      }
      if (!phaseInvoices.length) console.log('    (none)');
      console.log('  Changes:');
      for (const ch of plan.changes) {
        if (ch.type === 'update_phase1_dates' || ch.type === 'update_phase2_dates') {
          console.log(
            `    • ${ch.type} INV ${ch.invoice_id} (${ch.status}): ${ch.from} → ${ch.to}${ch.clear_penalty ? ' [clear penalty]' : ''}`
          );
        } else if (ch.type === 'delete_premature_phase') {
          console.log(
            `    • DELETE INV ${ch.invoice_id} phase ${ch.phase} AR ${ch.ar} (${ch.status}) ${ch.from}`
          );
        } else if (ch.type === 'set_generated_count') {
          console.log(`    • generated_count: ${ch.from} → ${ch.to}`);
        } else if (ch.type === 'set_queue') {
          console.log(`    • queue: ${ch.from} → ${ch.to}`);
        } else if (ch.type === 'reactivate_profile') {
          console.log('    • is_active: false → true');
        } else if (ch.type === 'restore_enrollment') {
          console.log(
            `    • enrollment ${ch.classstudent_id}: dropped → ${ch.to} (was: ${ch.reason})`
          );
        } else if (ch.type === 'create_pending_enrollment') {
          console.log('    • create phase 1 enrollment: pending_enrollment');
        }
      }
    }

    console.log('\n' + '═'.repeat(72));
    console.log(
      `Summary: ${allPlans.length} profiles across ${classes.length} classes; ${profilesNeedingChange} need changes (${changeCount} actions)`
    );

    if (!isApply) {
      console.log('\nDRY RUN only — no changes written.');
      console.log(`Re-run with --batch ${BATCH_NUM} --apply to commit.`);
      return;
    }

    await client.query('BEGIN');
    let applied = 0;

    for (const row of allPlans) {
      const { cls, profile, plan } = row;
      if (!plan.changes.length) continue;

      for (const ch of plan.changes) {
        if (ch.type === 'update_phase1_dates' || ch.type === 'update_phase2_dates') {
          const [issue, due] = ch.to.split('/');
          if (ch.clear_penalty) {
            await clearInvoicePenalty(client, ch.invoice_id);
          }
          await client.query(
            `UPDATE invoicestbl
             SET issue_date = $1::date,
                 due_date = $2::date,
                 late_penalty_applied_for_due_date = NULL
             WHERE invoice_id = $3`,
            [issue, due, ch.invoice_id]
          );
          await syncProgramPaymentStatusForInvoice(client, ch.invoice_id);
        } else if (ch.type === 'delete_premature_phase') {
          await deleteInvoiceCascade(client, ch.invoice_id);
        } else if (ch.type === 'restore_enrollment') {
          await client.query(
            `UPDATE classstudentstbl
             SET program_enrollment_status = $1,
                 removed_at = NULL,
                 removed_reason = NULL,
                 removed_by = NULL,
                 enrolled_by = COALESCE(enrolled_by, $2)
             WHERE classstudent_id = $3`,
            [ch.to, REPAIR_NOTE, ch.classstudent_id]
          );
        } else if (ch.type === 'create_pending_enrollment') {
          await client.query(
            `INSERT INTO classstudentstbl (
               student_id, class_id, enrolled_by, phase_number,
               program_enrollment_status, enrolled_at
             ) VALUES ($1, $2, $3, 1, 'pending_enrollment', CURRENT_TIMESTAMP)`,
            [profile.student_id, cls.class_id, REPAIR_NOTE]
          );
        }
      }

      await client.query(
        `UPDATE installmentinvoiceprofilestbl
         SET generated_count = $1,
             is_active = true
         WHERE installmentinvoiceprofiles_id = $2`,
        [plan.targetGenerated, profile.installmentinvoiceprofiles_id]
      );

      await client.query(
        `UPDATE installmentinvoicestbl
         SET status = NULL,
             next_generation_date = $1::date,
             next_invoice_month = $2::date
         WHERE installmentinvoiceprofiles_id = $3`,
        [plan.targetQueue.gen, plan.targetQueue.month, profile.installmentinvoiceprofiles_id]
      );

      applied += 1;
      console.log(
        `✅ ${profile.full_name} profile ${profile.installmentinvoiceprofiles_id} (${cls.class_name})`
      );
    }

    await client.query('COMMIT');
    console.log(`\n✅ Applied ${applied} profile repair(s).`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
