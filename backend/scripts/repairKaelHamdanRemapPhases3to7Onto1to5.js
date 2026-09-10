/**
 * Kael Devin Burayag Hamdan (myrna01@gmail.com, user 524) —
 * Remap late-start Phase 3–7 → Phase 1–5 (plan starts at Phase 1).
 *
 * Class 91 VMM_Playgroup_SS 9:30 AM · Profile 307 · Malolos
 *
 * Current: phase_start=3, total_phases=8, generated 5 (absolute 3–7)
 * Target:  phase_start=1, total_phases=10, generated 5 (absolute 1–5)
 *
 * | Old | New | Issue        | Due          | Status      |
 * |-----|-----|--------------|--------------|-------------|
 * | 3   | 1   | 2026-04-06   | 2026-04-10   | new         |
 * | 4   | 2   | 2026-04-25   | 2026-05-05   | re_enrolled |
 * | 5   | 3   | 2026-05-25   | 2026-06-05   | re_enrolled |
 * | 6   | 4   | 2026-06-25   | 2026-07-05   | re_enrolled |
 * | 7   | 5   | 2026-07-25   | 2026-08-05   | re_enrolled |
 *
 * Uses temp phase numbers (90+) to avoid unique collisions, then final remap.
 * Queue → next Phase 6: 2026-08-25 / 2026-09-01
 *
 * Run (from backend/):
 *   node scripts/repairKaelHamdanRemapPhases3to7Onto1to5.js --production
 *   node scripts/repairKaelHamdanRemapPhases3to7Onto1to5.js --production --apply
 */

import '../config/loadEnv.js';
import { getClient } from '../config/database.js';
import { rewriteTargetPhaseInRemarks } from '../utils/installmentPhaseBillingSync.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { syncProgramPaymentStatusForInvoice } from '../utils/programPaymentStatusService.js';

const STUDENT_ID = 524;
const STUDENT_EMAIL = 'myrna01@gmail.com';
const CLASS_ID = 91;
const PROFILE_ID = 307;

const NEW_PHASE_START = 1;
const NEW_TOTAL_PHASES = 10;
const NEW_GENERATED_COUNT = 5;
const FIRST_BILLING_MONTH = '2026-04-01';
const NEXT_GEN = '2026-08-25';
const NEXT_MONTH = '2026-09-01';

/** old absolute → new absolute + dates + enrollment */
const PHASE_MAP = [
  {
    oldPhase: 3,
    newPhase: 1,
    classstudentId: 626,
    invoiceId: 753,
    issue: '2026-04-06',
    due: '2026-04-10',
    status: 'new',
    enrolledAt: '2026-04-06 12:00:00',
  },
  {
    oldPhase: 4,
    newPhase: 2,
    classstudentId: 627,
    invoiceId: 754,
    issue: '2026-04-25',
    due: '2026-05-05',
    status: 're_enrolled',
    enrolledAt: '2026-04-25 12:00:00',
  },
  {
    oldPhase: 5,
    newPhase: 3,
    classstudentId: 1031,
    invoiceId: 1216,
    issue: '2026-05-25',
    due: '2026-06-05',
    status: 're_enrolled',
    enrolledAt: '2026-05-25 12:00:00',
  },
  {
    oldPhase: 6,
    newPhase: 4,
    classstudentId: 1589,
    invoiceId: 1889,
    issue: '2026-06-25',
    due: '2026-07-05',
    status: 're_enrolled',
    enrolledAt: '2026-06-25 12:00:00',
  },
  {
    oldPhase: 7,
    newPhase: 5,
    classstudentId: 2016,
    invoiceId: 2392,
    issue: '2026-07-25',
    due: '2026-08-05',
    status: 're_enrolled',
    enrolledAt: '2026-07-25 12:00:00',
  },
];

const TEMP_BASE = 90;

const REPAIR_NOTE =
  'Ops repair 2026-09-08 — Kael Hamdan remap P3–7 → P1–5 (start at phase 1)';

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

function rewritePhaseLabels(remarks, absolutePhase) {
  let text = rewriteTargetPhaseInRemarks(remarks, absolutePhase);
  if (/Advance payment\s*[—\-]\s*Phase\s*\d+/i.test(text)) {
    text = text.replace(
      /Advance payment\s*[—\-]\s*Phase\s*\d+/i,
      `Advance payment — Phase ${absolutePhase}`
    );
  }
  return text;
}

async function main() {
  console.log(
    `\nKael Hamdan — remap P3–7 → P1–5${isApply ? ' (APPLY)' : ' (DRY RUN)'}\n`
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
        `SELECT installmentinvoiceprofiles_id, class_id, phase_start, total_phases,
                generated_count, is_active, first_billing_month::text
         FROM installmentinvoiceprofilestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND student_id = $2
           AND class_id = $3`,
        [PROFILE_ID, STUDENT_ID, CLASS_ID]
      )
    ).rows[0];
    if (!profile) throw new Error(`Profile ${PROFILE_ID} not found`);
    console.log('Profile before:', profile);
    if (Number(profile.phase_start) !== 3) {
      throw new Error(`Expected phase_start=3, got ${profile.phase_start}`);
    }

    // Validate rows
    for (const row of PHASE_MAP) {
      const cs = (
        await client.query(
          `SELECT classstudent_id, phase_number, program_enrollment_status
           FROM classstudentstbl
           WHERE classstudent_id = $1 AND student_id = $2 AND class_id = $3`,
          [row.classstudentId, STUDENT_ID, CLASS_ID]
        )
      ).rows[0];
      if (!cs) throw new Error(`Missing CS ${row.classstudentId}`);
      if (Number(cs.phase_number) !== row.oldPhase) {
        throw new Error(
          `CS ${row.classstudentId} phase ${cs.phase_number} != ${row.oldPhase}`
        );
      }

      const inv = (
        await client.query(
          `SELECT invoice_id, remarks, installmentinvoiceprofiles_id, status,
                  TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                  TO_CHAR(due_date,'YYYY-MM-DD') AS due
           FROM invoicestbl WHERE invoice_id = $1`,
          [row.invoiceId]
        )
      ).rows[0];
      if (!inv) throw new Error(`Missing INV-${row.invoiceId}`);
      if (Number(inv.installmentinvoiceprofiles_id) !== PROFILE_ID) {
        throw new Error(`INV-${row.invoiceId} wrong profile`);
      }
      if (parseTargetPhase(inv.remarks) !== row.oldPhase) {
        throw new Error(
          `INV-${row.invoiceId} TARGET_PHASE ${parseTargetPhase(inv.remarks)} != ${row.oldPhase}`
        );
      }
      const linked = (
        await client.query(
          `SELECT 1 FROM invoicestudentstbl WHERE invoice_id = $1 AND student_id = $2`,
          [row.invoiceId, STUDENT_ID]
        )
      ).rows[0];
      if (!linked) throw new Error(`INV-${row.invoiceId} not linked to student`);

      console.log(
        `  old P${row.oldPhase}: CS ${row.classstudentId} (${cs.program_enrollment_status})` +
          ` INV-${row.invoiceId} ${inv.issue}/${inv.due} → new P${row.newPhase} ${row.issue}/${row.due}`
      );
    }

    // Step A: move to temp phases
    for (const row of PHASE_MAP) {
      const tempPhase = TEMP_BASE + row.newPhase; // 91..95
      await client.query(
        `UPDATE classstudentstbl SET phase_number = $1 WHERE classstudent_id = $2`,
        [tempPhase, row.classstudentId]
      );
      const inv = (
        await client.query(`SELECT remarks FROM invoicestbl WHERE invoice_id = $1`, [
          row.invoiceId,
        ])
      ).rows[0];
      await client.query(
        `UPDATE invoicestbl SET remarks = $1 WHERE invoice_id = $2`,
        [rewritePhaseLabels(inv.remarks, tempPhase), row.invoiceId]
      );
      console.log(`→ temp P${tempPhase}: CS ${row.classstudentId} / INV-${row.invoiceId}`);
    }

    // Step B: temp → final + dates + enrollment status
    for (const row of PHASE_MAP) {
      const tempPhase = TEMP_BASE + row.newPhase;
      await client.query(
        `UPDATE classstudentstbl
         SET phase_number = $1,
             program_enrollment_status = $2,
             enrolled_at = $3::timestamp,
             removed_at = NULL,
             removed_reason = NULL,
             removed_by = NULL
         WHERE classstudent_id = $4
           AND phase_number = $5`,
        [row.newPhase, row.status, row.enrolledAt, row.classstudentId, tempPhase]
      );

      const inv = (
        await client.query(`SELECT remarks FROM invoicestbl WHERE invoice_id = $1`, [
          row.invoiceId,
        ])
      ).rows[0];
      await client.query(
        `UPDATE invoicestbl
         SET issue_date = $1::date,
             due_date = $2::date,
             late_penalty_applied_for_due_date = NULL,
             remarks = $3
         WHERE invoice_id = $4`,
        [
          row.issue,
          row.due,
          appendNote(rewritePhaseLabels(inv.remarks, row.newPhase), REPAIR_NOTE),
          row.invoiceId,
        ]
      );
      await syncProgramPaymentStatusForInvoice(client, row.invoiceId);
      console.log(
        `→ final P${row.newPhase}: CS ${row.classstudentId} ${row.status};` +
          ` INV-${row.invoiceId} ${row.issue}/${row.due}`
      );
    }

    // Profile + queue
    await client.query(
      `UPDATE installmentinvoiceprofilestbl
       SET phase_start = $1,
           total_phases = $2,
           generated_count = $3,
           first_billing_month = $4::date,
           is_active = true
       WHERE installmentinvoiceprofiles_id = $5`,
      [
        NEW_PHASE_START,
        NEW_TOTAL_PHASES,
        NEW_GENERATED_COUNT,
        FIRST_BILLING_MONTH,
        PROFILE_ID,
      ]
    );
    console.log(
      `→ profile phase_start=${NEW_PHASE_START} total_phases=${NEW_TOTAL_PHASES}` +
        ` generated=${NEW_GENERATED_COUNT} first_billing=${FIRST_BILLING_MONTH}`
    );

    const dtl = (
      await client.query(
        `SELECT installmentinvoicedtl_id
         FROM installmentinvoicestbl
         WHERE installmentinvoiceprofiles_id = $1
         ORDER BY installmentinvoicedtl_id DESC
         LIMIT 1`,
        [PROFILE_ID]
      )
    ).rows[0];
    if (!dtl) throw new Error('No installment queue row');
    await client.query(
      `UPDATE installmentinvoicestbl
       SET next_generation_date = $1::date,
           next_invoice_month = $2::date,
           scheduled_date = $1::date
       WHERE installmentinvoicedtl_id = $3
         AND installmentinvoiceprofiles_id = $4`,
      [NEXT_GEN, NEXT_MONTH, dtl.installmentinvoicedtl_id, PROFILE_ID]
    );
    console.log(`→ queue ${NEXT_GEN} / ${NEXT_MONTH}`);

    // Verify
    console.log('\nAfter (in transaction):');
    const enrolls = (
      await client.query(
        `SELECT classstudent_id, phase_number, program_enrollment_status AS status
         FROM classstudentstbl
         WHERE student_id = $1 AND class_id = $2
         ORDER BY phase_number`,
        [STUDENT_ID, CLASS_ID]
      )
    ).rows;
    for (const e of enrolls) console.log(' ', e);

    const invs = (
      await client.query(
        `SELECT invoice_id,
                SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)') AS phase,
                TO_CHAR(issue_date,'YYYY-MM-DD') AS issue,
                TO_CHAR(due_date,'YYYY-MM-DD') AS due,
                status
         FROM invoicestbl
         WHERE installmentinvoiceprofiles_id = $1
           AND remarks ILIKE '%TARGET_PHASE:%'
         ORDER BY COALESCE(SUBSTRING(remarks FROM 'TARGET_PHASE:([0-9]+)')::int, 0), invoice_id`,
        [PROFILE_ID]
      )
    ).rows;
    for (const i of invs) console.log(' ', i);

    const profileAfter = (
      await client.query(
        `SELECT phase_start, total_phases, generated_count, first_billing_month::text
         FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1`,
        [PROFILE_ID]
      )
    ).rows[0];
    console.log(' Profile:', profileAfter);

    for (const row of PHASE_MAP) {
      const e = enrolls.find((x) => Number(x.classstudent_id) === row.classstudentId);
      if (!e || Number(e.phase_number) !== row.newPhase || e.status !== row.status) {
        throw new Error(`Enrollment verify failed for CS ${row.classstudentId}`);
      }
      const i = invs.find((x) => Number(x.invoice_id) === row.invoiceId);
      if (!i || Number(i.phase) !== row.newPhase || i.issue !== row.issue || i.due !== row.due) {
        throw new Error(`Invoice verify failed for INV-${row.invoiceId}`);
      }
    }
    if (
      Number(profileAfter.phase_start) !== NEW_PHASE_START ||
      Number(profileAfter.total_phases) !== NEW_TOTAL_PHASES ||
      Number(profileAfter.generated_count) !== NEW_GENERATED_COUNT
    ) {
      throw new Error('Profile verify failed');
    }

    // No leftover enrollments on old phases 6–7
    const leftover = enrolls.filter((e) => Number(e.phase_number) > 5);
    if (leftover.length) {
      throw new Error(`Unexpected enrollments above P5: ${JSON.stringify(leftover)}`);
    }

    console.log('\n✅ Remap verified: phases 1–5 only.');

    if (isApply) {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDry run — rolled back. Re-run with --apply to commit.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nFailed:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
