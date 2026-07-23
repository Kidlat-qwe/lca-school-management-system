/**
 * Repair Juan Miguel Benitez (user 137) Nursery class 129 first enrollment to upsell.
 *
 * Playgroup (class 57) → Nursery (class 129) is a level-up; Phase 1 must show "upsell"
 * on invoices and enrollment matrices (not "new" / "re_enrolled").
 *
 * Usage:
 *   node scripts/repairJuanBenitezNurseryUpsell.js
 *   node scripts/repairJuanBenitezNurseryUpsell.js --apply
 */
import '../config/loadEnv.js';
import { getClient, query } from '../config/database.js';
import {
  loadStudentMonthEnrollmentMatrix,
  loadStudentPhaseEnrollmentMatrix,
} from '../lib/enrollmentRateMetrics.js';

const STUDENT_ID = 137;
const NURSERY_CLASS_ID = 129;
const PLAYGROUP_CLASS_ID = 57;
const BRANCH_ID = 5;
const NURSERY_CS_ID = 943;

const isApply = process.argv.includes('--apply');

async function previewMatrices(queryFn) {
  const [monthMatrix, phaseMatrix] = await Promise.all([
    loadStudentMonthEnrollmentMatrix(queryFn, {
      year: 2026,
      branchId: BRANCH_ID,
    }),
    loadStudentPhaseEnrollmentMatrix(queryFn, {
      branchId: BRANCH_ID,
      maxPhase: 12,
    }),
  ]);

  const monthTracks = (monthMatrix.students || []).filter(
    (s) => s.student_id === STUDENT_ID
  );
  const phaseTracks = (phaseMatrix.students || []).filter(
    (s) => s.student_id === STUDENT_ID
  );

  console.log('\n--- Month matrix (Juan) ---');
  for (const track of monthTracks) {
    console.log(
      `class ${track.class_id} ${track.class_name || ''} hide=${Boolean(track.hide_from_matrix)} merged=${Boolean(track.matrix_merged_upsell_anchor)}`
    );
    for (const m of monthMatrix.months || []) {
      const c = track.months?.[m.key];
      if (!c) continue;
      if (c.mark === '1' || c.status === 'active' || c.status === 'inactive' || c.label) {
        console.log(
          `  ${m.key}: mark=${c.mark} label=${c.label} status=${c.status}`
        );
      }
    }
  }

  console.log('\n--- Phase matrix (Juan) ---');
  for (const track of phaseTracks) {
    console.log(
      `class ${track.class_id} ${track.class_name || ''} upsell_track=${Boolean(track.matrix_upsell_track)}`
    );
    for (const p of phaseMatrix.phases || []) {
      const c = track.phases?.[p.key];
      if (!c || (c.mark !== '1' && !c.label)) continue;
      console.log(
        `  P${p.key}: mark=${c.mark} label=${c.label} status=${c.status}`
      );
    }
  }
}

async function main() {
  const before = await query(
    `SELECT classstudent_id, class_id, phase_number, program_enrollment_status
     FROM classstudentstbl
     WHERE classstudent_id = $1`,
    [NURSERY_CS_ID]
  );
  console.log('Current Nursery enrollment:', before.rows[0] || null);
  console.log(
    `Mode: ${isApply ? 'APPLY' : 'DRY-RUN'} — set classstudent ${NURSERY_CS_ID} (class ${NURSERY_CLASS_ID} P1) → upsell`
  );

  console.log('\nPreview BEFORE repair:');
  await previewMatrices(query);

  if (!isApply) {
    console.log('\nDry-run only. Re-run with --apply to update production.');
    process.exit(0);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE classstudentstbl
       SET program_enrollment_status = 'upsell'
       WHERE classstudent_id = $1
         AND student_id = $2
         AND class_id = $3
       RETURNING classstudent_id, program_enrollment_status, phase_number`,
      [NURSERY_CS_ID, STUDENT_ID, NURSERY_CLASS_ID]
    );
    if (!upd.rows.length) {
      throw new Error('Nursery classstudent row not found — aborting');
    }
    console.log('\nUpdated:', upd.rows[0]);

    // Sanity: Playgroup still present as lower track
    const pg = await client.query(
      `SELECT COUNT(*)::int AS n FROM classstudentstbl
       WHERE student_id = $1 AND class_id = $2`,
      [STUDENT_ID, PLAYGROUP_CLASS_ID]
    );
    console.log(`Playgroup rows still present: ${pg.rows[0].n}`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('\nPreview AFTER repair:');
  await previewMatrices(query);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
