import cron from 'node-cron';
import { processInstallmentDelinquencies } from '../utils/installmentDelinquencyService.js';

/**
 * Start the scheduled job to apply installment penalties and auto-removals.
 * Runs daily (configurable via environment variable).
 */
export const startInstallmentDelinquencyScheduler = () => {
  // Default: run daily at 2:10 AM, after the installment invoice generator (2:00 AM).
  const schedule = process.env.INSTALLMENT_DELINQUENCY_SCHEDULE || '10 2 * * *';

  console.log(`📅 Installment delinquency scheduler configured: ${schedule}`);

  cron.schedule(schedule, async () => {
    console.log(`⏰ [${new Date().toISOString()}] Processing installment delinquencies...`);

    try {
      const res = await processInstallmentDelinquencies();
      console.log(
        `✅ Delinquency processed: scanned=${res.scanned}, penalties=${res.penaltiesApplied}, removals=${res.removalsApplied}, errors=${res.errors}`
      );
    } catch (error) {
      console.error(`❌ Error in installment delinquency scheduler:`, error);
    }
  });

  // Optional immediate run on startup for development/testing
  if (process.env.RUN_INSTALLMENT_DELINQUENCY_ON_STARTUP === 'true') {
    console.log(`🔄 Running installment delinquency processor on startup...`);
    processInstallmentDelinquencies()
      .then((res) => {
        console.log(
          `✅ Startup delinquency processed: scanned=${res.scanned}, penalties=${res.penaltiesApplied}, removals=${res.removalsApplied}, errors=${res.errors}`
        );
      })
      .catch((error) => {
        console.error(`❌ Startup error in delinquency processor:`, error);
      });
  }
};

