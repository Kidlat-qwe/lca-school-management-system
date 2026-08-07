/**
 * Guiguinto KG_1-3PM (class 83) — class start 2026-07-20 → 2026-07-06 dry-run / apply.
 *
 * July 6 is day ≤7 → billing cadence 25_5 (Phase 2 issue Jul 25 / due Aug 5).
 * Paid Phase 1 invoices stay untouched (product rule).
 *
 * After start-date apply, generate missing Phase 2 for students who did not
 * advance-pay Phase 2 (currently: Julla Santos Rojas profile 462).
 *
 * Run:
 *   node backend/scripts/repairKg13pmGuiguintoStartJuly6.js --production
 *   node backend/scripts/repairKg13pmGuiguintoStartJuly6.js --production --apply
 *   node backend/scripts/repairKg13pmGuiguintoStartJuly6.js --production --apply --generate-phase2
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  applyStartDateAdjustment,
  previewStartDateAdjustment,
} from '../utils/classStartDateAdjustment/classStartDateAdjustmentService.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';
import { generateInvoiceFromInstallment } from '../utils/installmentInvoiceGenerator.js';
import { formatYmdLocal, todayYmdManila } from '../utils/dateUtils.js';

const CLASS_ID = 83;
const CLASS_NAME = 'KG_1-3PM';
const BRANCH_ID = 5;
const NEW_START_DATE = '2026-07-06';
const REASON =
  'Ops 2026-08-07 — move Guiguinto KG_1-3PM start July 20 → July 6 (first-week 25/5 cadence)';

const PHASE2_ISSUE = '2026-07-25';
const PHASE2_DUE = '2026-08-05';
const AFTER_GEN_NEXT = '2026-08-25';
const AFTER_GEN_MONTH = '2026-09-01';

const args = new Set(process.argv.slice(2));
const isApply = args.has('--apply');
const isGeneratePhase2 = args.has('--generate-phase2');
const acknowledgeWarnings = args.has('--acknowledge-warnings');

const ymd = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return formatYmdLocal(value).slice(0, 10);
};

function summarizeBillingImpacts(billingImpacts) {
  const rows = [];
  for (const impact of billingImpacts?.profiles || billingImpacts || []) {
    const studentName = impact.student_name || impact.full_name || impact.student_id;
    const changes = impact.changes || [];
    const updates = changes.filter((c) => c.type === 'update_phase_invoice');
    const queue = changes.filter((c) => c.type === 'update_queue' || c.type === 'queue');
    const warnings = changes.filter((c) => c.type === 'warning');
    const settledSkipped = changes.filter(
      (c) => c.type === 'skip_settled' || c.code === 'paid_unchanged'
    );
    rows.push({
      profile_id: impact.profile_id || impact.installmentinvoiceprofiles_id,
      student: studentName,
      student_id: impact.student_id,
      change_count: changes.length,
      invoice_updates: updates.length,
      queue_updates: queue.length,
      warnings: warnings.length,
      settled_skipped: settledSkipped.length,
    });
  }
  return rows;
}

function flattenInvoiceChanges(billingImpacts) {
  const rows = [];
  const profiles = billingImpacts?.profiles || billingImpacts || [];
  for (const impact of profiles) {
    for (const c of impact.changes || []) {
      if (c.type !== 'update_phase_invoice') continue;
      rows.push({
        student: impact.student_name || impact.full_name || impact.student_id,
        invoice_id: c.invoice_id,
        phase: c.phase ?? c.target_phase,
        status: c.status,
        issue: `${c.old_issue_date || '—'} → ${c.new_issue_date || '—'}`,
        due: `${c.old_due_date || '—'} → ${c.new_due_date || '—'}`,
      });
    }
  }
  return rows;
}

async function listPhase2GenerateCandidates(client) {
  const profiles = await client.query(
    `SELECT DISTINCT ON (ip.installmentinvoiceprofiles_id)
            ip.installmentinvoiceprofiles_id AS pid,
            ip.student_id AS sid,
            u.full_name AS name,
            u.email,
            ip.generated_count,
            ip.total_phases,
            ip.is_active,
            ip.amount,
            ip.phase_start,
            ip.frequency,
            ip.description,
            ip.branch_id,
            ip.class_id,
            ii.installmentinvoicedtl_id,
            ii.status AS q_status,
            ii.frequency AS ii_frequency,
            ii.total_amount_including_tax,
            ii.total_amount_excluding_tax,
            TO_CHAR(ii.next_generation_date,'YYYY-MM-DD') AS next_gen,
            TO_CHAR(ii.next_invoice_month,'YYYY-MM-DD') AS next_month
     FROM installmentinvoiceprofilestbl ip
     JOIN userstbl u ON u.user_id = ip.student_id
     LEFT JOIN installmentinvoicestbl ii
       ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
     WHERE ip.class_id = $1
       AND COALESCE(ip.is_active, true) = true
     ORDER BY ip.installmentinvoiceprofiles_id, ii.installmentinvoicedtl_id NULLS LAST`,
    [CLASS_ID]
  );

  const candidates = [];
  for (const p of profiles.rows) {
    const inv = await client.query(
      `SELECT invoice_id, status, remarks
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND COALESCE(status,'') NOT IN ('Cancelled','Canceled')`,
      [p.pid]
    );
    const phase2 = inv.rows.filter((r) => parseTargetPhase(r.remarks) === 2);
    const phase2PaidOrPartial = phase2.some((r) =>
      ['Paid', 'Partially Paid'].includes(String(r.status))
    );
    const missing = phase2.length === 0;
    if (missing && Number(p.generated_count) >= 1 && !phase2PaidOrPartial) {
      candidates.push(p);
    }
  }
  return candidates;
}

async function generatePhase2ForCandidate(client, row) {
  await client.query(
    `UPDATE installmentinvoicestbl
     SET status = NULL,
         next_generation_date = $1::date,
         next_invoice_month = $2::date,
         scheduled_date = $2::date + INTERVAL '4 days'
     WHERE installmentinvoicedtl_id = $3`,
    [PHASE2_ISSUE, '2026-08-01', row.installmentinvoicedtl_id]
  );

  const installmentInvoice = {
    installmentinvoicedtl_id: row.installmentinvoicedtl_id,
    installmentinvoiceprofiles_id: row.pid,
    next_generation_date: PHASE2_ISSUE,
    next_invoice_month: '2026-08-01',
    frequency: row.ii_frequency || row.frequency,
    total_amount_including_tax: row.total_amount_including_tax,
    total_amount_excluding_tax: row.total_amount_excluding_tax,
    status: null,
  };
  const profilePayload = {
    student_id: row.sid,
    branch_id: row.branch_id || BRANCH_ID,
    package_id: null,
    amount: row.amount,
    frequency: row.frequency,
    description: row.description,
    generated_count: row.generated_count,
    class_id: row.class_id || CLASS_ID,
    total_phases: row.total_phases,
    phase_start: row.phase_start,
    next_generation_date: PHASE2_ISSUE,
  };

  const generated = await generateInvoiceFromInstallment(
    installmentInvoice,
    profilePayload
  );

  const phase2 = (
    await client.query(
      `SELECT invoice_id,
              TO_CHAR(TIMEZONE('Asia/Manila', issue_date),'YYYY-MM-DD') AS issue,
              TO_CHAR(TIMEZONE('Asia/Manila', due_date),'YYYY-MM-DD') AS due,
              status, remarks
       FROM invoicestbl
       WHERE installmentinvoiceprofiles_id = $1
         AND remarks ILIKE '%TARGET_PHASE:2%'
       ORDER BY invoice_id DESC
       LIMIT 1`,
      [row.pid]
    )
  ).rows[0];

  if (phase2 && (phase2.issue !== PHASE2_ISSUE || phase2.due !== PHASE2_DUE)) {
    await client.query(
      `UPDATE invoicestbl
       SET issue_date = ($1::date + TIME '12:00'),
           due_date = ($2::date + TIME '12:00'),
           late_penalty_applied_for_due_date = NULL,
           remarks = TRIM(BOTH ';' FROM COALESCE(remarks,'')) || ';' || $3
       WHERE invoice_id = $4`,
      [PHASE2_ISSUE, PHASE2_DUE, REASON, phase2.invoice_id]
    );
  }

  await client.query(
    `UPDATE installmentinvoicestbl
     SET status = NULL,
         next_generation_date = $1::date,
         next_invoice_month = $2::date,
         scheduled_date = $2::date + INTERVAL '4 days'
     WHERE installmentinvoicedtl_id = $3`,
    [AFTER_GEN_NEXT, AFTER_GEN_MONTH, row.installmentinvoicedtl_id]
  );

  return {
    student: row.name,
    profile_id: row.pid,
    generated_invoice_id: generated?.invoice_id || phase2?.invoice_id,
    issue: PHASE2_ISSUE,
    due: PHASE2_DUE,
  };
}

async function main() {
  console.log(
    `\nKG_1-3PM (class ${CLASS_ID}) start → ${NEW_START_DATE}` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}` +
      `${isGeneratePhase2 ? ' + GENERATE Phase 2' : ''}\n`
  );
  console.log(`Manila today: ${todayYmdManila()}`);
  console.log(`Reason: ${REASON}\n`);

  const client = await getClient();
  try {
    const classRow = (
      await client.query(
        `SELECT class_id, class_name, branch_id,
                TO_CHAR(start_date,'YYYY-MM-DD') AS start_ymd,
                TO_CHAR(end_date,'YYYY-MM-DD') AS end_ymd,
                status
         FROM classestbl WHERE class_id = $1`,
        [CLASS_ID]
      )
    ).rows[0];
    if (!classRow) throw new Error(`Class ${CLASS_ID} not found`);
    if (String(classRow.class_name) !== CLASS_NAME) {
      throw new Error(`Expected ${CLASS_NAME}, got ${classRow.class_name}`);
    }
    if (Number(classRow.branch_id) !== BRANCH_ID) {
      throw new Error(`Expected branch ${BRANCH_ID}, got ${classRow.branch_id}`);
    }

    console.log('Class:', {
      class_id: classRow.class_id,
      name: classRow.class_name,
      status: classRow.status,
      current_start: classRow.start_ymd,
      current_end: classRow.end_ymd,
      new_start: NEW_START_DATE,
    });

    const preview = await previewStartDateAdjustment(
      client,
      CLASS_ID,
      NEW_START_DATE,
      { acknowledgeWarnings }
    );

    console.log('\n=== Preview summary ===');
    console.log({
      current_start_date: preview.current_start_date,
      new_start_date: preview.new_start_date,
      current_end_date: preview.current_end_date,
      new_end_date: preview.new_end_date,
      can_apply: preview.can_apply,
      blockers: preview.blockers?.length || 0,
      warnings: preview.warnings?.length || 0,
      room_conflicts: preview.room_conflicts?.length || 0,
      teacher_conflicts: preview.teacher_conflicts?.length || 0,
    });

    if (preview.blockers?.length) {
      console.log('\nBLOCKERS:');
      console.table(preview.blockers);
    }
    if (preview.warnings?.length) {
      console.log('\nWARNINGS:');
      console.table(preview.warnings);
    }
    if (preview.room_conflicts?.length) {
      console.log('\nROOM CONFLICTS:');
      console.table(preview.room_conflicts);
    } else {
      console.log('\nRoom conflicts: none');
    }
    if (preview.teacher_conflicts?.length) {
      console.log('\nTEACHER CONFLICTS:');
      console.table(preview.teacher_conflicts);
    } else {
      console.log('Teacher conflicts: none');
    }

    console.log('\nSession phase summary:');
    console.table(preview.session_summary?.phases || []);

    const billingSummary = summarizeBillingImpacts(preview.billing_impacts);
    console.log('\nBilling impact by profile:');
    console.table(billingSummary);

    const invoiceChanges = flattenInvoiceChanges(preview.billing_impacts);
    const phase1Changes = invoiceChanges.filter((r) => Number(r.phase) === 1);
    const phase2PlusChanges = invoiceChanges.filter((r) => Number(r.phase) >= 2);
    console.log(`\nPhase 1 invoice date changes: ${phase1Changes.length} (settled should be 0)`);
    if (phase1Changes.length) console.table(phase1Changes);
    console.log(`Phase 2+ invoice date changes: ${phase2PlusChanges.length}`);
    if (phase2PlusChanges.length) console.table(phase2PlusChanges.slice(0, 40));

    const phase2Candidates = await listPhase2GenerateCandidates(client);
    console.log('\nPhase 2 generate candidates (no Phase 2 invoice yet):');
    console.table(
      phase2Candidates.map((c) => ({
        pid: c.pid,
        sid: c.sid,
        name: c.name,
        email: c.email,
        gen: `${c.generated_count}/${c.total_phases}`,
        next_gen: c.next_gen,
        next_month: c.next_month,
        planned_issue: PHASE2_ISSUE,
        planned_due: PHASE2_DUE,
      }))
    );

    if (!isApply) {
      console.log('\nDry run only — no DB writes.');
      if (!preview.can_apply) {
        console.log(
          'Apply is blocked. If blockers are attendance-related, re-run with --acknowledge-warnings after review.'
        );
      } else {
        console.log('Preview can_apply=true.');
        console.log('\nTo apply start-date only:');
        console.log(
          '  node backend/scripts/repairKg13pmGuiguintoStartJuly6.js --production --apply'
        );
        console.log('To apply start-date + generate missing Phase 2:');
        console.log(
          '  node backend/scripts/repairKg13pmGuiguintoStartJuly6.js --production --apply --generate-phase2'
        );
      }
      return;
    }

    if (!preview.can_apply) {
      throw new Error(
        `Cannot apply: ${(preview.blockers || []).map((b) => b.message).join('; ')}`
      );
    }

    console.log('\nApplying start date adjustment...');
    const applied = await applyStartDateAdjustment(
      client,
      CLASS_ID,
      NEW_START_DATE,
      REASON,
      null,
      { acknowledgeWarnings }
    );
    console.log('✅ Start date applied. adjustment_id=', applied.adjustment_id);
    console.log({
      old_start: applied.current_start_date,
      new_start: applied.new_start_date,
      old_end: applied.current_end_date,
      new_end: applied.new_end_date,
    });

    if (isGeneratePhase2) {
      const freshCandidates = await listPhase2GenerateCandidates(client);
      console.log(`\nGenerating Phase 2 for ${freshCandidates.length} student(s)...`);
      const generatedRows = [];
      for (const c of freshCandidates) {
        generatedRows.push(await generatePhase2ForCandidate(client, c));
      }
      console.table(generatedRows);
    } else {
      console.log(
        '\nSkipped Phase 2 generate (add --generate-phase2). Candidates remain as listed above.'
      );
    }

    const afterClass = (
      await client.query(
        `SELECT TO_CHAR(start_date,'YYYY-MM-DD') AS start_ymd,
                TO_CHAR(end_date,'YYYY-MM-DD') AS end_ymd
         FROM classestbl WHERE class_id = $1`,
        [CLASS_ID]
      )
    ).rows[0];
    console.log('\nAFTER class dates:', afterClass);
    console.log(`\n${REASON}`);
  } catch (err) {
    console.error('\n❌ Failed:', err?.message || err);
    if (err?.details) console.error(err.details);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
