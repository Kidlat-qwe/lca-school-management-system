import cron from 'node-cron';
import { processDueInstallmentInvoices } from '../utils/installmentInvoiceGenerator.js';

/**
 * Start the scheduled job to process due installment invoices
 * Runs on the 25th of each month at 2:00 AM (configurable via environment variable)
 * This generates monthly invoices with due date on the 5th of the following month
 */
export const startInstallmentInvoiceScheduler = () => {
  // Schedule: Run on 25th of each month at 2:00 AM (can be configured via env)
  // Format: minute hour day month day-of-week
  // '0 2 25 * *' = At 02:00 AM on the 25th of every month
  const schedule = process.env.INSTALLMENT_INVOICE_SCHEDULE || '0 2 25 * *';
  
  console.log(`📅 Installment invoice scheduler configured: ${schedule}`);
  
  cron.schedule(schedule, async () => {
    console.log(`⏰ [${new Date().toISOString()}] Processing due installment invoices...`);
    
    try {
      const result = await processDueInstallmentInvoices();
      
      if (result.processed > 0) {
        console.log(`✅ Processed ${result.processed} installment invoice(s)`);
        if (result.errors > 0) {
          console.warn(`⚠️  ${result.errors} error(s) occurred during processing`);
        }
      } else {
        console.log(`ℹ️  No due installment invoices to process`);
      }
    } catch (error) {
      console.error(`❌ Error in installment invoice scheduler:`, error);
    }
  });
  
  // Also run immediately on startup if configured (useful for development/testing)
  if (process.env.RUN_INSTALLMENT_INVOICE_ON_STARTUP === 'true') {
    console.log(`🔄 Running installment invoice processor on startup...`);
    processDueInstallmentInvoices()
      .then((result) => {
        if (result.processed > 0) {
          console.log(`✅ Startup: Processed ${result.processed} installment invoice(s)`);
        }
      })
      .catch((error) => {
        console.error(`❌ Startup error in installment invoice processor:`, error);
      });
  }
};

