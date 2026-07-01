import { getClient } from '../config/database.js';
import { processInstallmentDelinquencies } from '../utils/installmentDelinquencyService.js';

const ymd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const SETTINGS_KEYS = [
  'installment_penalty_rate',
  'installment_penalty_grace_days',
  'installment_final_dropoff_days',
];

async function getExistingSettingsRows(client, branchIdOrNull) {
  const res = await client.query(
    `SELECT setting_key, setting_value, setting_type, category, description, branch_id
     FROM system_settingstbl
     WHERE branch_id IS NOT DISTINCT FROM $1
       AND setting_key = ANY($2::text[])`,
    [branchIdOrNull, SETTINGS_KEYS]
  );
  const byKey = new Map(res.rows.map((r) => [r.setting_key, r]));
  return byKey;
}

async function upsertSetting(client, { key, value, type, category, description, branchIdOrNull, updatedBy }) {
  // Match backend/routes/settings.js semantics:
  // - global: conflict on (setting_key) WHERE branch_id IS NULL (partial unique index)
  // - branch: conflict on (setting_key, branch_id)
  if (branchIdOrNull === null) {
    await client.query(
      `INSERT INTO system_settingstbl
        (setting_key, setting_value, setting_type, category, description, branch_id, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (setting_key) WHERE branch_id IS NULL
       DO UPDATE SET
         setting_value = EXCLUDED.setting_value,
         setting_type = EXCLUDED.setting_type,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [key, String(value), type, category, description, updatedBy]
    );
  } else {
    await client.query(
      `INSERT INTO system_settingstbl
        (setting_key, setting_value, setting_type, category, description, branch_id, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (setting_key, branch_id)
       DO UPDATE SET
         setting_value = EXCLUDED.setting_value,
         setting_type = EXCLUDED.setting_type,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         updated_by = EXCLUDED.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
      [key, String(value), type, category, description, branchIdOrNull, updatedBy]
    );
  }
}

async function restoreOrDeleteSetting(client, { key, existedRow, branchIdOrNull }) {
  if (existedRow) {
    // Restore exactly what was there.
    await client.query(
      `UPDATE system_settingstbl
       SET setting_value = $1,
           setting_type = $2,
           category = $3,
           description = $4
       WHERE setting_key = $5
         AND branch_id IS NOT DISTINCT FROM $6`,
      [
        existedRow.setting_value,
        existedRow.setting_type,
        existedRow.category,
        existedRow.description,
        key,
        branchIdOrNull,
      ]
    );
  } else {
    // Delete row we created.
    await client.query(
      `DELETE FROM system_settingstbl
       WHERE setting_key = $1
         AND branch_id IS NOT DISTINCT FROM $2`,
      [key, branchIdOrNull]
    );
  }
}

async function main() {
  const client = await getClient();
  const created = {
    // settings restoration
    savedGlobal: null,
    savedBranch: null,
    branchId: null,
    // data rows
    classstudent_id: null,
    profile_id: null,
    invoice_id: null,
    student_id: null,
    class_id: null,
  };

  // Test settings: make behavior obvious
  const TEST_PENALTY_RATE = 0.2; // 20%
  const TEST_GRACE_DAYS = 0;
  const TEST_DROPOFF_DAYS = 0; // remove immediately once overdue (due_date < today)

  try {
    // Safety check: don’t run global processor if there are already overdue installment invoices.
    const pre = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM invoicestbl i
       WHERE i.installmentinvoiceprofiles_id IS NOT NULL
         AND i.status NOT IN ('Paid', 'Cancelled')
         AND i.due_date IS NOT NULL
         AND i.due_date < CURRENT_DATE`
    );
    const preCnt = pre.rows?.[0]?.cnt ?? 0;
    console.log('[SettingsDelinqTest] preExistingOverdueInstallmentInvoices =', preCnt);
    if (preCnt > 0) {
      console.log(
        '[SettingsDelinqTest] ABORT: There are already overdue installment invoices; running the processor could affect real data.'
      );
      process.exitCode = 2;
      return;
    }

    // Find a safe (class, student) pair where student is not currently enrolled in the class.
    const pair = await client.query(
      `SELECT c.class_id, c.branch_id, u.user_id AS student_id
       FROM classestbl c
       JOIN userstbl u
         ON u.user_type = 'Student'
        AND u.branch_id = c.branch_id
       WHERE c.branch_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM classstudentstbl cs
           WHERE cs.class_id = c.class_id AND cs.student_id = u.user_id
         )
       LIMIT 1`
    );
    if (pair.rows.length === 0) {
      throw new Error('No (class,student) pair found for test');
    }
    const { class_id: classId, branch_id: branchId, student_id: studentId } = pair.rows[0];
    created.class_id = classId;
    created.branchId = branchId;
    created.student_id = studentId;
    console.log('[SettingsDelinqTest] using', { classId, branchId, studentId });

    // Save existing settings (global + branch override rows) so we can restore exactly.
    created.savedGlobal = await getExistingSettingsRows(client, null);
    created.savedBranch = await getExistingSettingsRows(client, branchId);

    // Apply test settings as BRANCH override (so it doesn't affect other branches).
    // This matches the UI "Scope: Branch override".
    await client.query('BEGIN');
    await upsertSetting(client, {
      key: 'installment_penalty_rate',
      value: TEST_PENALTY_RATE,
      type: 'number',
      category: 'billing',
      description: 'TEST: penalty rate',
      branchIdOrNull: branchId,
      updatedBy: null,
    });
    await upsertSetting(client, {
      key: 'installment_penalty_grace_days',
      value: TEST_GRACE_DAYS,
      type: 'int',
      category: 'billing',
      description: 'TEST: grace days',
      branchIdOrNull: branchId,
      updatedBy: null,
    });
    await upsertSetting(client, {
      key: 'installment_final_dropoff_days',
      value: TEST_DROPOFF_DAYS,
      type: 'int',
      category: 'billing',
      description: 'TEST: dropoff days',
      branchIdOrNull: branchId,
      updatedBy: null,
    });
    await client.query('COMMIT');
    console.log('[SettingsDelinqTest] appliedBranchOverrideSettings', {
      branchId,
      installment_penalty_rate: TEST_PENALTY_RATE,
      installment_penalty_grace_days: TEST_GRACE_DAYS,
      installment_final_dropoff_days: TEST_DROPOFF_DAYS,
    });

    // due_date = yesterday -> overdue, triggers penalty (grace=0) and removal (dropoff=0).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(today);
    due.setDate(due.getDate() - 1);
    const issue = new Date(due);
    issue.setDate(issue.getDate() - 7);

    // Create enrollment (Active) so the processor can mark it Removed.
    const csRes = await client.query(
      `INSERT INTO classstudentstbl (student_id, class_id, enrolled_by, phase_number, enrollment_status)
       VALUES ($1, $2, $3, $4, 'Active')
       RETURNING classstudent_id`,
      [studentId, classId, 'Test Settings Delinquency', 1]
    );
    created.classstudent_id = csRes.rows[0].classstudent_id;

    // Create installment profile (downpayment already paid so delinquency applies normally).
    const profRes = await client.query(
      `INSERT INTO installmentinvoiceprofilestbl
         (student_id, branch_id, class_id, amount, frequency, description, is_active, downpayment_paid)
       VALUES ($1, $2, $3, $4, $5, $6, true, true)
       RETURNING installmentinvoiceprofiles_id`,
      [studentId, branchId, classId, 1000, '1 month(s)', 'Settings Delinquency Test Profile']
    );
    created.profile_id = profRes.rows[0].installmentinvoiceprofiles_id;

    // Create overdue invoice linked to installment profile.
    const invRes = await client.query(
      `INSERT INTO invoicestbl
         (invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by, installmentinvoiceprofiles_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING invoice_id`,
      ['TEST-SETTINGS-DELINQ', branchId, 1000, 'Unpaid', 'Settings delinquency test invoice', ymd(issue), ymd(due), null, created.profile_id]
    );
    created.invoice_id = invRes.rows[0].invoice_id;
    await client.query('UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2', [
      `INV-TEST-SETTINGS-${created.invoice_id}`,
      created.invoice_id,
    ]);

    // Base invoice item (remaining balance = 1000).
    await client.query(
      `INSERT INTO invoiceitemstbl
        (invoice_id, description, amount, discount_amount, penalty_amount, tax_item, tax_percentage)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [created.invoice_id, 'Installment Test Item', 1000, 0, 0, null, null]
    );

    // Link student to invoice.
    await client.query('INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)', [
      created.invoice_id,
      studentId,
    ]);

    // Run processor (should only affect this test invoice).
    const run = await processInstallmentDelinquencies();
    console.log('[SettingsDelinqTest] processorResult', run);

    // Verify penalty + removal
    const items = await client.query(
      `SELECT description, amount, discount_amount, penalty_amount
       FROM invoiceitemstbl
       WHERE invoice_id = $1
       ORDER BY invoice_item_id`,
      [created.invoice_id]
    );
    console.log('[SettingsDelinqTest] invoiceItems', items.rows);

    const csRow = await client.query(
      `SELECT classstudent_id, enrollment_status, removed_at, removed_reason, removed_by
       FROM classstudentstbl
       WHERE classstudent_id = $1`,
      [created.classstudent_id]
    );
    console.log('[SettingsDelinqTest] classStudentRow', csRow.rows[0]);

    const expectedPenaltyPctLabel = Math.round(TEST_PENALTY_RATE * 100);
    const expectedPenalty = round2(1000 * TEST_PENALTY_RATE);
    const penaltyLine = items.rows.find((r) => r.description === `Late Payment Penalty (${expectedPenaltyPctLabel}%)`);
    if (!penaltyLine || round2(penaltyLine.penalty_amount) !== expectedPenalty) {
      throw new Error(
        `Penalty line missing/incorrect (expected "${`Late Payment Penalty (${expectedPenaltyPctLabel}%)`}" penalty_amount=${expectedPenalty})`
      );
    }
    if (csRow.rows[0]?.enrollment_status !== 'Removed') {
      throw new Error('Enrollment was not marked Removed');
    }

    console.log('[SettingsDelinqTest] ✅ PASS: settings affected penalty + removal');
  } finally {
    // Cleanup test data + restore settings
    try {
      // Delete created invoice + links first
      if (created.invoice_id) {
        await client.query('DELETE FROM invoiceitemstbl WHERE invoice_id = $1', [created.invoice_id]);
        await client.query('DELETE FROM invoicestudentstbl WHERE invoice_id = $1', [created.invoice_id]);
        await client.query('DELETE FROM invoicestbl WHERE invoice_id = $1', [created.invoice_id]);
      }
      if (created.profile_id) {
        await client.query('DELETE FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1', [
          created.profile_id,
        ]);
      }
      if (created.classstudent_id) {
        await client.query('DELETE FROM classstudentstbl WHERE classstudent_id = $1', [created.classstudent_id]);
      }

      // Restore settings rows (branch override only; we didn't change global rows)
      if (created.branchId !== null && created.branchId !== undefined) {
        await client.query('BEGIN');
        for (const key of SETTINGS_KEYS) {
          await restoreOrDeleteSetting(client, {
            key,
            existedRow: created.savedBranch?.get(key) || null,
            branchIdOrNull: created.branchId,
          });
        }
        await client.query('COMMIT');
      }

      console.log('[SettingsDelinqTest] cleanupDone', {
        ...created,
        savedGlobal: undefined,
        savedBranch: undefined,
      });
    } catch (cleanupError) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      console.error('[SettingsDelinqTest] CLEANUP_FAILED', cleanupError, created);
    }
    client.release();
  }
}

main().catch((e) => {
  console.error('[SettingsDelinqTest] FAILED', e);
  process.exitCode = 1;
});

