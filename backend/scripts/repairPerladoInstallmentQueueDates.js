/**
 * Update Perlado installment queue — next generation Jul 25, 2026; next month Aug 1, 2026.
 *
 *   node backend/scripts/repairPerladoInstallmentQueueDates.js --production
 *   node backend/scripts/repairPerladoInstallmentQueueDates.js --production --apply
 */

import '../config/loadEnv.js';
import pkg from 'pg';

const { Pool } = pkg;
const useProduction = process.argv.includes('--production');
const isApply = process.argv.includes('--apply');

const pool = new Pool({
  host: useProduction ? process.env.DB_HOST_PRODUCTION : process.env.DB_HOST,
  port: parseInt(
    (useProduction ? process.env.DB_PORT_PRODUCTION : process.env.DB_PORT) || '5432'
  ),
  database: useProduction
    ? process.env.DB_NAME_PRODUCTION || 'psms_production'
    : process.env.DB_NAME || 'psms_db',
  user: useProduction ? process.env.DB_USER_PRODUCTION : process.env.DB_USER,
  password: useProduction
    ? process.env.DB_PASSWORD_PRODUCTION
    : process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const PROFILE_ID = 311;
const STUDENT_ID = 528;
const NEXT_GENERATION = '2026-07-25';
const NEXT_INVOICE_MONTH = '2026-08-01';

async function main() {
  console.log(
    `\nPerlado queue dates${useProduction ? ' (production)' : ' (development)'}${
      isApply ? ' — APPLY' : ' — DRY RUN'
    }\n`
  );

  const client = await pool.connect();
  try {
    const before = await client.query(
      `SELECT ii.installmentinvoicedtl_id,
              TO_CHAR(ii.next_generation_date, 'YYYY-MM-DD') AS next_generation_date,
              TO_CHAR(ii.next_invoice_month, 'YYYY-MM-DD') AS next_invoice_month,
              ip.student_id, u.full_name
       FROM installmentinvoicestbl ii
       JOIN installmentinvoiceprofilestbl ip ON ip.installmentinvoiceprofiles_id = ii.installmentinvoiceprofiles_id
       JOIN userstbl u ON u.user_id = ip.student_id
       WHERE ii.installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );

    const row = before.rows[0];
    if (!row || Number(row.student_id) !== STUDENT_ID) {
      throw new Error(`Queue row for profile ${PROFILE_ID} not found`);
    }

    console.log('Student:', row.full_name);
    console.log('Before:', {
      next_generation_date: row.next_generation_date,
      next_invoice_month: row.next_invoice_month,
    });
    console.log('Target:', {
      next_generation_date: NEXT_GENERATION,
      next_invoice_month: NEXT_INVOICE_MONTH,
    });

    if (isApply) {
      await client.query('BEGIN');
      await client.query(
        `UPDATE installmentinvoicestbl
         SET next_generation_date = $1::date,
             next_invoice_month = $2::date
         WHERE installmentinvoiceprofiles_id = $3`,
        [NEXT_GENERATION, NEXT_INVOICE_MONTH, PROFILE_ID]
      );
      await client.query('COMMIT');
      console.log('\n✅ Updated.');
    } else {
      console.log('\nDRY RUN — re-run with --apply --production to write.');
    }

    const after = await client.query(
      `SELECT TO_CHAR(next_generation_date, 'YYYY-MM-DD') AS next_generation_date,
              TO_CHAR(next_invoice_month, 'YYYY-MM-DD') AS next_invoice_month
       FROM installmentinvoicestbl
       WHERE installmentinvoiceprofiles_id = $1`,
      [PROFILE_ID]
    );
    if (isApply) {
      console.log('After:', after.rows[0]);
    }
  } catch (error) {
    if (isApply) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
