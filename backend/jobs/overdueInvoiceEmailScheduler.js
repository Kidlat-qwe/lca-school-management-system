import cron from 'node-cron';
import { processOverdueInvoiceAutoEmails } from '../utils/overdueInvoiceAutoEmailService.js';

/**
 * Start the scheduled job to auto-send overdue invoice reminder emails once.
 *
 * Default: every 30 minutes (configurable via env OVERDUE_INVOICE_EMAIL_SCHEDULE).
 */
export const startOverdueInvoiceEmailScheduler = () => {
  const schedule = process.env.OVERDUE_INVOICE_EMAIL_SCHEDULE || '*/30 * * * *';
  const batchLimit = Number(process.env.OVERDUE_INVOICE_EMAIL_BATCH_LIMIT || 50);

  console.log(`📧 Overdue invoice auto-email scheduler configured: ${schedule} (batchLimit=${batchLimit})`);

  cron.schedule(schedule, async () => {
    console.log(`⏰ [${new Date().toISOString()}] Processing overdue invoice auto-emails...`);
    try {
      const res = await processOverdueInvoiceAutoEmails({ batchLimit });
      if (res.skipped) {
        console.log(`ℹ️ Auto-email skipped: ${res.reason}`);
        return;
      }
      console.log(
        `✅ Auto-email processed: candidates=${res.candidates}, emailed=${res.emailed}, marked=${res.marked}, errors=${res.errors}`
      );
    } catch (error) {
      console.error(`❌ Error in overdue invoice auto-email scheduler:`, error);
    }
  });

  // Optional immediate run on startup for development/testing
  if (process.env.RUN_OVERDUE_INVOICE_EMAIL_ON_STARTUP === 'true') {
    console.log(`🔄 Running overdue invoice auto-email processor on startup...`);
    processOverdueInvoiceAutoEmails({ batchLimit })
      .then((res) => {
        if (res.skipped) {
          console.log(`ℹ️ Startup auto-email skipped: ${res.reason}`);
          return;
        }
        console.log(
          `✅ Startup auto-email processed: candidates=${res.candidates}, emailed=${res.emailed}, marked=${res.marked}, errors=${res.errors}`
        );
      })
      .catch((error) => {
        console.error(`❌ Startup error in overdue invoice auto-email processor:`, error);
      });
  }
};

