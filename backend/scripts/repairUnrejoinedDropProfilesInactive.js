/**
 * Deactivate installment profiles that have an unrejoined drop on their class.
 *
 * Rule: dropped on a class with no later active enrollment (higher phase) →
 * `is_active = false` so Student History Status and re-enrollment matrix show Inactive.
 *
 * Default: sync Olivia / Elijah / Erica abandoned 9:30AM plans.
 * Use `--all` to sync every student with an unrejoined drop.
 *
 * Run:
 *   node backend/scripts/repairUnrejoinedDropProfilesInactive.js --production
 *   node backend/scripts/repairUnrejoinedDropProfilesInactive.js --production --apply
 *   node backend/scripts/repairUnrejoinedDropProfilesInactive.js --production --apply --all
 */

import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  classHasUnrejoinedDrop,
  syncStudentInstallmentProfilesForUnrejoinedDrops,
} from '../utils/installmentProfileActivity/index.js';
import {
  loadStudentMonthEnrollmentMatrix,
  loadStudentPhaseEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const TARGETS = [
  {
    label: 'Olivia Brie Sales',
    email: 'ladypipay24@gmail.com',
    studentId: 272,
    profileId: 128,
    classId: 63,
    branchId: 6,
  },
  {
    label: 'Elijah Mikael A. De Jesus',
    email: 'aquinomarielle221@gmail.com',
    studentId: 275,
    profileId: 130,
    classId: 63,
    branchId: 6,
  },
  {
    label: 'Mariae Erica Maere F. Fernando',
    email: 'gewellmaefernando@gmail.com',
    studentId: 269,
    profileId: 124,
    classId: 63,
    branchId: 6,
  },
];

const isApply = process.argv.includes('--apply');
const syncAll = process.argv.includes('--all');

async function previewMatrix(studentId, classId, branchId) {
  const [monthMatrix, phaseMatrix] = await Promise.all([
    loadStudentMonthEnrollmentMatrix(query, {
      year: 2026,
      branchId,
      classId,
    }),
    loadStudentPhaseEnrollmentMatrix(query, {
      branchId,
      classId,
      maxPhase: 10,
    }),
  ]);

  const monthTrack = (monthMatrix.students || []).find(
    (s) => s.student_id === studentId && s.class_id === classId
  );
  const phaseTrack = (phaseMatrix.students || []).find(
    (s) => s.student_id === studentId && s.class_id === classId
  );

  const monthCells = [];
  for (const m of monthMatrix.months || []) {
    const c = monthTrack?.months?.[m.key];
    if (!c) continue;
    if (c.mark === '1' || c.status === 'active' || c.status === 'inactive' || c.label) {
      monthCells.push({
        month: m.key,
        label: c.label,
        status: c.status,
        phase: c.phase_number,
        mark: c.mark,
      });
    }
  }

  const phaseCells = [];
  for (const p of phaseMatrix.phases || []) {
    const c = phaseTrack?.phases?.[p.key];
    if (!c) continue;
    if (c.mark === '1' || c.status === 'active' || c.status === 'inactive' || c.label) {
      phaseCells.push({
        phase: p.key,
        label: c.label,
        status: c.status,
        mark: c.mark,
      });
    }
  }

  return { monthCells, phaseCells };
}

async function main() {
  console.log(
    `\nUnrejoined-drop → Inactive profiles` +
      `${isApply ? ' (APPLY)' : ' (DRY RUN)'}` +
      `${syncAll ? ' [--all]' : ''}\n`
  );
  console.log(`DB: ${process.env.DB_NAME || '(not set)'} | NODE_ENV=${process.env.NODE_ENV}`);

  const client = await getClient();
  try {
    if (syncAll) {
      const candidates = await client.query(
        `SELECT DISTINCT ip.student_id, ip.class_id, ip.installmentinvoiceprofiles_id AS profile_id,
                ip.is_active, u.full_name, c.class_name
         FROM installmentinvoiceprofilestbl ip
         INNER JOIN userstbl u ON u.user_id = ip.student_id
         LEFT JOIN classestbl c ON c.class_id = ip.class_id
         WHERE ip.class_id IS NOT NULL
           AND ip.is_active = true
         ORDER BY ip.student_id, ip.class_id`
      );

      const toFix = [];
      for (const row of candidates.rows) {
        if (await classHasUnrejoinedDrop(client, row.student_id, row.class_id)) {
          toFix.push(row);
        }
      }

      console.log(`Active profiles with unrejoined drop: ${toFix.length}`);
      console.table(
        toFix.map((r) => ({
          student: r.full_name,
          profile: r.profile_id,
          class: r.class_name,
          class_id: r.class_id,
        }))
      );

      if (!isApply) {
        console.log('\nDry run only. Re-run with --apply --all to deactivate.');
        return;
      }

      await client.query('BEGIN');
      let total = 0;
      const studentIds = [...new Set(toFix.map((r) => r.student_id))];
      for (const sid of studentIds) {
        total += await syncStudentInstallmentProfilesForUnrejoinedDrops(client, sid);
      }
      await client.query('COMMIT');
      console.log(`\n✅ Deactivated ${total} profile row(s).`);
      return;
    }

    for (const t of TARGETS) {
      console.log(`\n==== ${t.label} (profile ${t.profileId} / class ${t.classId}) ====`);
      const profile = (
        await client.query(
          `SELECT installmentinvoiceprofiles_id, is_active, class_id, student_id
           FROM installmentinvoiceprofilestbl
           WHERE installmentinvoiceprofiles_id = $1`,
          [t.profileId]
        )
      ).rows[0];
      if (!profile || Number(profile.student_id) !== t.studentId) {
        throw new Error(`Profile ${t.profileId} not found for student ${t.studentId}`);
      }

      const unrejoined = await classHasUnrejoinedDrop(client, t.studentId, t.classId);
      console.log('BEFORE is_active:', profile.is_active, '| unrejoined_drop:', unrejoined);
      console.log('BEFORE matrix:');
      console.table((await previewMatrix(t.studentId, t.classId, t.branchId)).monthCells);

      if (!isApply) continue;

      await client.query('BEGIN');
      const n = await syncStudentInstallmentProfilesForUnrejoinedDrops(client, t.studentId);
      await client.query('COMMIT');

      const after = (
        await client.query(
          `SELECT is_active FROM installmentinvoiceprofilestbl
           WHERE installmentinvoiceprofiles_id = $1`,
          [t.profileId]
        )
      ).rows[0];
      console.log(`✅ Sync updated ${n} row(s); AFTER is_active:`, after?.is_active);
      console.log('AFTER matrix:');
      console.table((await previewMatrix(t.studentId, t.classId, t.branchId)).monthCells);
    }

    if (!isApply) {
      console.log('\nDry run only. Re-run with --apply to commit.');
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    console.error('\n❌ Failed:', err?.message || err);
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
