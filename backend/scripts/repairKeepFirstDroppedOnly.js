/**
 * Keep only the first dropped phase on multi-drop installment tracks.
 * Delete later dropped enrollments and unpaid invoices for those extra
 * dropped phases.
 *
 * Example: drops on phases 2,3,4,5 → keep Phase 2 dropped; delete Phase 3–5
 * enrollments + unpaid invoices for those phases.
 *
 * Modes:
 *   (default)              No-rejoin / no-continue tracks only
 *                          Also removes later unpaid generated invoices after
 *                          the first drop and deactivates the profile.
 *   --include-continued    Also include tracks that rejoined/continued
 *   --continued-only       Only tracks that rejoined/continued
 *
 * For continued tracks: only remove extra dropped enrollments + unpaid
 * invoices for those dropped phases. Rejoin/active phases and profile
 * generated_count / is_active are left unchanged.
 *
 * Usage:
 *   node backend/scripts/repairKeepFirstDroppedOnly.js
 *   node backend/scripts/repairKeepFirstDroppedOnly.js --csv
 *   node backend/scripts/repairKeepFirstDroppedOnly.js --continued-only --csv
 *   node backend/scripts/repairKeepFirstDroppedOnly.js --include-continued
 *   node backend/scripts/repairKeepFirstDroppedOnly.js --profile-id=149
 *   node backend/scripts/repairKeepFirstDroppedOnly.js --continued-only --apply
 */

import '../config/loadEnv.js';
import { writeFileSync } from 'fs';
import { getClient } from '../config/database.js';
import { parseTargetPhase } from '../utils/balanceInvoice.js';

function parseArgs() {
  const argv = process.argv.slice(2);
  let apply = false;
  let csvPath = null;
  let profileId = null;
  let studentId = null;
  let limit = null;
  let minDrops = 2;
  let includeContinued = false;
  let continuedOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--include-continued') includeContinued = true;
    else if (a === '--continued-only') {
      continuedOnly = true;
      includeContinued = true;
    } else if (a === '--csv') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        csvPath = next;
        i += 1;
      } else {
        csvPath = `keep-first-dropped-only-${Date.now()}.csv`;
      }
    } else if (a.startsWith('--profile-id=')) {
      profileId = parseInt(a.split('=')[1], 10);
    } else if (a === '--profile-id') {
      profileId = parseInt(argv[++i], 10);
    } else if (a.startsWith('--student-id=')) {
      studentId = parseInt(a.split('=')[1], 10);
    } else if (a === '--student-id') {
      studentId = parseInt(argv[++i], 10);
    } else if (a.startsWith('--limit=')) {
      limit = Math.max(1, parseInt(a.split('=')[1], 10) || 1);
    } else if (a === '--limit') {
      limit = Math.max(1, parseInt(argv[++i], 10) || 1);
    } else if (a.startsWith('--min-drops=')) {
      minDrops = Math.max(2, parseInt(a.split('=')[1], 10) || 2);
    } else if (a === '--help' || a === '-h') {
      console.log(`
Keep first dropped phase only; remove later dropped enrollments + unpaid invoices.

  (default)              Dry run, no-rejoin tracks only
  --apply                Write changes
  --include-continued    Include rejoined/continued tracks
  --continued-only       Only rejoined/continued tracks
  --csv [path]           Write planned-action CSV
  --profile-id=N         Only one installment profile
  --student-id=N         Only one student
  --limit=N              Process at most N tracks
  --min-drops=N          Minimum dropped phases (default 2)
`);
      process.exit(0);
    }
  }

  return {
    apply,
    csvPath,
    profileId,
    studentId,
    limit,
    minDrops,
    includeContinued,
    continuedOnly,
  };
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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
  await client.query(`DELETE FROM program_payment_statustbl WHERE invoice_id = $1`, [
    invoiceId,
  ]);
  await client.query(`DELETE FROM invoicestudentstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(`DELETE FROM invoiceitemstbl WHERE invoice_id = $1`, [invoiceId]);
  await client.query(
    `UPDATE invoicestbl SET balance_invoice_id = NULL WHERE balance_invoice_id = $1`,
    [invoiceId]
  );
  await client.query(`DELETE FROM invoicestbl WHERE invoice_id = $1`, [invoiceId]);
}

async function loadCandidateTracks(
  client,
  { minDrops, profileId, studentId, limit, includeContinued, continuedOnly }
) {
  const params = [minDrops];
  const filters = [];

  if (profileId != null) {
    params.push(profileId);
    filters.push(`AND ip.installmentinvoiceprofiles_id = $${params.length}`);
  }
  if (studentId != null) {
    params.push(studentId);
    filters.push(`AND ip.student_id = $${params.length}`);
  }

  const limitSql = limit != null ? `LIMIT ${Number(limit)}` : '';

  let continuedFilter = `
    WHERE COALESCE(cont.has_rejoin_after_drop, false) = false
      AND COALESCE(cont.has_active_after_drop, false) = false`;
  if (continuedOnly) {
    continuedFilter = `
    WHERE (
      COALESCE(cont.has_rejoin_after_drop, false) = true
      OR COALESCE(cont.has_active_after_drop, false) = true
    )`;
  } else if (includeContinued) {
    continuedFilter = 'WHERE 1=1';
  }

  const result = await client.query(
    `
    WITH installment_tracks AS (
      SELECT DISTINCT
        ip.student_id,
        ip.class_id,
        MAX(ip.installmentinvoiceprofiles_id) AS profile_id
      FROM installmentinvoiceprofilestbl ip
      WHERE ip.class_id IS NOT NULL
      ${filters.join('\n      ')}
      GROUP BY ip.student_id, ip.class_id
    ),
    dropped AS (
      SELECT
        cs.student_id,
        cs.class_id,
        COUNT(DISTINCT COALESCE(cs.phase_number, 1))::int AS dropped_phase_count,
        MIN(COALESCE(cs.phase_number, 1)) AS first_dropped_phase,
        MAX(COALESCE(cs.phase_number, 1)) AS last_dropped_phase,
        STRING_AGG(
          DISTINCT COALESCE(cs.phase_number, 1)::text,
          ',' ORDER BY COALESCE(cs.phase_number, 1)::text
        ) AS dropped_phases
      FROM classstudentstbl cs
      INNER JOIN installment_tracks it
        ON it.student_id = cs.student_id AND it.class_id = cs.class_id
      WHERE cs.program_enrollment_status = 'dropped'
      GROUP BY cs.student_id, cs.class_id
      HAVING COUNT(DISTINCT COALESCE(cs.phase_number, 1)) >= $1
    ),
    continued AS (
      SELECT
        d.student_id,
        d.class_id,
        BOOL_OR(
          cs.program_enrollment_status = 'rejoin'
          AND (
            d.last_dropped_phase IS NULL
            OR COALESCE(cs.phase_number, 1) > d.last_dropped_phase
          )
          AND cs.removed_at IS NULL
        ) AS has_rejoin_after_drop,
        BOOL_OR(
          cs.program_enrollment_status IN ('new', 're_enrolled', 'upsell', 'rejoin')
          AND cs.removed_at IS NULL
          AND COALESCE(cs.phase_number, 1) > d.last_dropped_phase
        ) AS has_active_after_drop,
        MAX(
          CASE
            WHEN cs.program_enrollment_status = 'rejoin'
              AND cs.removed_at IS NULL
              AND COALESCE(cs.phase_number, 1) > d.last_dropped_phase
            THEN COALESCE(cs.phase_number, 1)
            ELSE NULL
          END
        ) AS rejoin_phase
      FROM dropped d
      LEFT JOIN classstudentstbl cs
        ON cs.student_id = d.student_id AND cs.class_id = d.class_id
      GROUP BY d.student_id, d.class_id
    )
    SELECT
      u.user_id AS student_id,
      u.full_name,
      u.email,
      c.class_id,
      c.class_name,
      c.branch_id,
      COALESCE(b.branch_nickname, b.branch_name) AS branch_name,
      ip.installmentinvoiceprofiles_id AS profile_id,
      ip.phase_start,
      ip.total_phases,
      ip.generated_count,
      ip.is_active,
      ii.installmentinvoicedtl_id,
      d.first_dropped_phase,
      d.last_dropped_phase,
      d.dropped_phase_count,
      d.dropped_phases,
      COALESCE(cont.has_rejoin_after_drop, false)
        OR COALESCE(cont.has_active_after_drop, false) AS continued_after_drops,
      cont.rejoin_phase
    FROM dropped d
    INNER JOIN continued cont
      ON cont.student_id = d.student_id AND cont.class_id = d.class_id
    INNER JOIN installment_tracks it
      ON it.student_id = d.student_id AND it.class_id = d.class_id
    INNER JOIN installmentinvoiceprofilestbl ip
      ON ip.installmentinvoiceprofiles_id = it.profile_id
    LEFT JOIN installmentinvoicestbl ii
      ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
    INNER JOIN userstbl u ON u.user_id = d.student_id
    INNER JOIN classestbl c ON c.class_id = d.class_id
    LEFT JOIN branchestbl b ON b.branch_id = c.branch_id
    ${continuedFilter}
    ORDER BY u.full_name, c.class_name
    ${limitSql}
    `,
    params
  );

  return result.rows;
}

async function planTrackRepair(client, track) {
  const studentId = Number(track.student_id);
  const classId = Number(track.class_id);
  const profileId = Number(track.profile_id);
  const firstDrop = Number(track.first_dropped_phase);
  const continued = track.continued_after_drops === true;
  const phaseStart = track.phase_start != null ? Number(track.phase_start) : 1;
  const safeStart = Number.isFinite(phaseStart) && phaseStart > 0 ? phaseStart : 1;

  const enrollments = (
    await client.query(
      `SELECT classstudent_id, phase_number, program_enrollment_status,
              enrolled_by, removed_reason,
              TO_CHAR(TIMEZONE('Asia/Manila', removed_at), 'YYYY-MM-DD') AS removed
       FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2
       ORDER BY phase_number, classstudent_id`,
      [studentId, classId]
    )
  ).rows;

  const invoices = (
    await client.query(
      `SELECT invoice_id, status, amount, remarks,
              TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue,
              (SELECT COUNT(*)::int FROM paymenttbl p WHERE p.invoice_id = i.invoice_id) AS pay_count
       FROM invoicestbl i
       WHERE installmentinvoiceprofiles_id = $1
       ORDER BY invoice_id`,
      [profileId]
    )
  ).rows.map((r) => ({ ...r, phase: parseTargetPhase(r.remarks) }));

  const droppedToDelete = enrollments.filter(
    (e) =>
      e.program_enrollment_status === 'dropped' &&
      Number(e.phase_number) > firstDrop
  );

  const extraDroppedPhases = new Set(
    droppedToDelete.map((e) => Number(e.phase_number)).filter((p) => Number.isFinite(p))
  );

  const invoicesToDelete = [];
  const invoicesSkipped = [];

  for (const inv of invoices) {
    const phase = Number(inv.phase);
    if (!Number.isFinite(phase) || phase <= firstDrop) continue;

    // Continued tracks: only remove unpaid invoices for the extra dropped phases.
    // Never touch rejoin / later active phase invoices.
    if (continued && !extraDroppedPhases.has(phase)) {
      invoicesSkipped.push({
        ...inv,
        skip_reason: 'kept (rejoin/active or non-dropped phase on continued track)',
      });
      continue;
    }

    if (Number(inv.pay_count) > 0 || ['Paid', 'Partially Paid'].includes(inv.status)) {
      invoicesSkipped.push({
        ...inv,
        skip_reason:
          Number(inv.pay_count) > 0
            ? `has ${inv.pay_count} payment(s)`
            : `status=${inv.status}`,
      });
      continue;
    }

    invoicesToDelete.push(inv);
  }

  const targetGeneratedCount = Math.max(0, firstDrop - safeStart + 1);

  return {
    track,
    firstDrop,
    continued,
    keepEnrollmentPhases: enrollments
      .filter(
        (e) =>
          !(
            e.program_enrollment_status === 'dropped' &&
            Number(e.phase_number) > firstDrop
          )
      )
      .map((e) => ({
        id: e.classstudent_id,
        phase: e.phase_number,
        status: e.program_enrollment_status,
      })),
    deleteEnrollments: droppedToDelete.map((e) => ({
      id: e.classstudent_id,
      phase: e.phase_number,
      status: e.program_enrollment_status,
      removed: e.removed,
      reason: String(e.removed_reason || '').slice(0, 80),
    })),
    deleteInvoices: invoicesToDelete.map((i) => ({
      inv: i.invoice_id,
      phase: i.phase,
      status: i.status,
      amount: i.amount,
      issue: i.issue,
      pays: i.pay_count,
    })),
    skipInvoices: invoicesSkipped.map((i) => ({
      inv: i.invoice_id,
      phase: i.phase,
      status: i.status,
      pays: i.pay_count,
      reason: i.skip_reason,
    })),
    keepInvoices: invoices
      .filter((i) => {
        const phase = Number(i.phase);
        if (!Number.isFinite(phase) || phase <= firstDrop) return true;
        if (continued && !extraDroppedPhases.has(phase)) return true;
        return false;
      })
      .map((i) => ({
        inv: i.invoice_id,
        phase: i.phase,
        status: i.status,
        pays: i.pay_count,
      })),
    profileUpdate: continued
      ? {
          // Keep billing position after rejoin.
          update: false,
          generated_count_from: track.generated_count,
          generated_count_to: track.generated_count,
          is_active_to: track.is_active,
          clear_schedule: false,
        }
      : {
          update: true,
          generated_count_from: track.generated_count,
          generated_count_to: targetGeneratedCount,
          is_active_to: false,
          clear_schedule: Boolean(track.installmentinvoicedtl_id),
        },
  };
}

async function applyPlan(client, plan) {
  const profileId = Number(plan.track.profile_id);

  for (const inv of plan.deleteInvoices) {
    await deleteInvoiceCascade(client, Number(inv.inv));
  }

  for (const e of plan.deleteEnrollments) {
    await client.query(`DELETE FROM classstudentstbl WHERE classstudent_id = $1`, [
      e.id,
    ]);
  }

  if (!plan.profileUpdate.update) return;

  await client.query(
    `UPDATE installmentinvoiceprofilestbl
     SET generated_count = $1,
         is_active = false
     WHERE installmentinvoiceprofiles_id = $2`,
    [plan.profileUpdate.generated_count_to, profileId]
  );

  if (plan.track.installmentinvoicedtl_id) {
    await client.query(
      `UPDATE installmentinvoicestbl
       SET status = 'Generated',
           next_generation_date = NULL,
           next_invoice_month = NULL
       WHERE installmentinvoicedtl_id = $1`,
      [plan.track.installmentinvoicedtl_id]
    );
  }
}

async function main() {
  const {
    apply,
    csvPath,
    profileId,
    studentId,
    limit,
    minDrops,
    includeContinued,
    continuedOnly,
  } = parseArgs();

  console.log(
    `\nKeep first dropped only${apply ? ' (APPLY)' : ' (DRY RUN)'}` +
      ` | min drops=${minDrops}` +
      `${continuedOnly ? ' | continued-only' : includeContinued ? ' | include-continued' : ' | no-rejoin only'}` +
      `${profileId != null ? ` | profile=${profileId}` : ''}` +
      `${studentId != null ? ` | student=${studentId}` : ''}` +
      `${limit != null ? ` | limit=${limit}` : ''}\n`
  );

  const client = await getClient();

  try {
    const tracks = await loadCandidateTracks(client, {
      minDrops,
      profileId,
      studentId,
      limit,
      includeContinued,
      continuedOnly,
    });

    console.log(`Candidate tracks: ${tracks.length}\n`);

    if (!tracks.length) {
      console.log('Nothing to repair.');
      return;
    }

    const plans = [];
    for (const track of tracks) {
      plans.push(await planTrackRepair(client, track));
    }

    let totalEnrollDeletes = 0;
    let totalInvoiceDeletes = 0;
    let totalInvoiceSkips = 0;
    const summaryRows = [];

    for (const plan of plans) {
      const t = plan.track;
      totalEnrollDeletes += plan.deleteEnrollments.length;
      totalInvoiceDeletes += plan.deleteInvoices.length;
      totalInvoiceSkips += plan.skipInvoices.length;

      summaryRows.push({
        student_id: t.student_id,
        name: t.full_name,
        email: t.email,
        class: t.class_name,
        profile: t.profile_id,
        continued: plan.continued,
        rejoin_phase: t.rejoin_phase,
        drops: t.dropped_phases,
        keep_drop_phase: plan.firstDrop,
        delete_enroll_phases: plan.deleteEnrollments.map((e) => e.phase).join('|') || '-',
        delete_enroll_ids: plan.deleteEnrollments.map((e) => e.id).join('|') || '-',
        delete_invoice_ids: plan.deleteInvoices.map((i) => i.inv).join('|') || '-',
        delete_invoice_phases: plan.deleteInvoices.map((i) => i.phase).join('|') || '-',
        skip_invoices: plan.skipInvoices.map((i) => i.inv).join('|') || '-',
        gen_from: plan.profileUpdate.generated_count_from,
        gen_to: plan.profileUpdate.generated_count_to,
        profile_update: plan.profileUpdate.update,
      });

      console.log(
        `• ${t.full_name} | ${t.class_name} | profile ${t.profile_id}` +
          ` | drops ${t.dropped_phases} → keep P${plan.firstDrop}` +
          `${plan.continued ? ` | continued (rejoin P${t.rejoin_phase ?? '-'})` : ''}`
      );
      if (plan.deleteEnrollments.length) {
        console.log(
          `    DELETE enrollments: ${plan.deleteEnrollments
            .map((e) => `cs${e.id}@P${e.phase}`)
            .join(', ')}`
        );
      } else {
        console.log('    DELETE enrollments: (none)');
      }
      if (plan.deleteInvoices.length) {
        console.log(
          `    DELETE invoices: ${plan.deleteInvoices
            .map((i) => `INV-${i.inv}(P${i.phase}/${i.status})`)
            .join(', ')}`
        );
      } else {
        console.log('    DELETE invoices: (none)');
      }
      if (plan.skipInvoices.length) {
        console.log(
          `    SKIP invoices: ${plan.skipInvoices
            .map((i) => `INV-${i.inv}(P${i.phase}: ${i.reason})`)
            .join(', ')}`
        );
      }
      if (plan.profileUpdate.update) {
        console.log(
          `    profile generated_count ${plan.profileUpdate.generated_count_from} → ${plan.profileUpdate.generated_count_to}, is_active=false`
        );
      } else {
        console.log(
          `    profile unchanged (continued track; generated_count=${plan.profileUpdate.generated_count_from})`
        );
      }
      console.log('');
    }

    console.log('Totals:');
    console.log(`  tracks: ${plans.length}`);
    console.log(`  enrollment rows to delete: ${totalEnrollDeletes}`);
    console.log(`  unpaid invoices to delete: ${totalInvoiceDeletes}`);
    console.log(`  invoices skipped: ${totalInvoiceSkips}`);

    if (csvPath) {
      const headers = Object.keys(summaryRows[0] || {});
      const lines = [
        headers.join(','),
        ...summaryRows.map((row) => headers.map((h) => csvEscape(row[h])).join(',')),
      ];
      writeFileSync(csvPath, `${lines.join('\n')}\n`, 'utf8');
      console.log(`\nCSV written: ${csvPath}`);
    }

    if (!apply) {
      console.log('\nDry run complete. Re-run with --apply to write changes.');
      return;
    }

    await client.query('BEGIN');
    for (const plan of plans) {
      await applyPlan(client, plan);
      console.log(
        `✅ Applied profile ${plan.track.profile_id} (${plan.track.full_name})`
      );
    }
    await client.query('COMMIT');
    console.log('\n✅ All planned repairs applied.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
