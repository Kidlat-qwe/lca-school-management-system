import { query, getClient } from '../config/database.js';
import { formatYmdLocal, parseYmdToLocalNoon } from './dateUtils.js';

/**
 * Parse frequency string (e.g., "1 month(s)", "2 month(s)") and return number of months
 * @param {string} frequency - Frequency string
 * @returns {number} Number of months
 */
export const parseFrequency = (frequency) => {
  if (!frequency) return 1;
  
  const match = frequency.match(/(\d+)\s*month/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  
  // Default to 1 month if parsing fails
  return 1;
};

/**
 * Calculate next generation date based on current date and frequency
 * @param {Date|string} currentDate - Current generation date
 * @param {string} frequency - Frequency string (e.g., "1 month(s)")
 * @returns {Date} Next generation date
 */
export const calculateNextGenerationDate = (currentDate, frequency) => {
  const date = new Date(currentDate);
  const months = parseFrequency(frequency);
  
  // Add months to the date
  date.setMonth(date.getMonth() + months);
  
  return date;
};

/**
 * Calculate next invoice month (first day of the next billing month)
 * @param {Date|string} currentInvoiceMonth - Current invoice month
 * @param {string} frequency - Frequency string
 * @returns {Date} Next invoice month (first day of the month)
 */
export const calculateNextInvoiceMonth = (currentInvoiceMonth, frequency) => {
  const date = new Date(currentInvoiceMonth);
  const months = parseFrequency(frequency);
  
  // Set to first day of the month
  date.setDate(1);
  // Add months
  date.setMonth(date.getMonth() + months);
  
  return date;
};

/**
 * Generate invoice from installment invoice
 * @param {Object} installmentInvoice - Installment invoice record from installmentinvoicestbl
 * @param {Object} profile - Installment invoice profile from installmentinvoiceprofilestbl
 * @returns {Object} Created invoice data
 */
export const generateInvoiceFromInstallment = async (installmentInvoice, profile) => {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Get student information
    const studentResult = await client.query(
      'SELECT user_id, full_name, email FROM userstbl WHERE user_id = $1',
      [profile.student_id]
    );
    
    if (studentResult.rows.length === 0) {
      throw new Error(`Student with ID ${profile.student_id} not found`);
    }
    
    const student = studentResult.rows[0];
    
    // Calculate issue date (use next generation date as issue date)
    // Use local-noon parsing to avoid timezone shifting (PH time can become previous day in UTC).
    const issueDate =
      typeof installmentInvoice.next_generation_date === 'string'
        ? parseYmdToLocalNoon(installmentInvoice.next_generation_date)
        : new Date(installmentInvoice.next_generation_date);
    
    // Calculate due date (7 days after issue date, or use profile's bill_invoice_due_date logic)
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 7); // Default: 7 days after issue date
    
    // Create invoice (link to installment invoice profile for phase tracking)
    const invoiceResult = await client.query(
      `INSERT INTO invoicestbl (invoice_description, branch_id, amount, status, remarks, issue_date, due_date, created_by, installmentinvoiceprofiles_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        'TEMP', // Temporary, will be updated
        profile.branch_id || null,
        installmentInvoice.total_amount_including_tax || profile.amount,
        'Unpaid',
        `Auto-generated from installment invoice: ${profile.description || 'Installment payment'}`,
        formatYmdLocal(issueDate),
        formatYmdLocal(dueDate),
        null, // System-generated
        installmentInvoice.installmentinvoiceprofiles_id, // Link to installment profile for phase tracking
      ]
    );
    
    const newInvoice = invoiceResult.rows[0];
    
    // Update invoice description
    await client.query(
      'UPDATE invoicestbl SET invoice_description = $1 WHERE invoice_id = $2',
      [`INV-${newInvoice.invoice_id}`, newInvoice.invoice_id]
    );
    
    // Create invoice item
    await client.query(
      `INSERT INTO invoiceitemstbl (invoice_id, description, amount, tax_item, tax_percentage)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        newInvoice.invoice_id,
        profile.description || `Installment payment - ${installmentInvoice.frequency || 'Monthly'}`,
        installmentInvoice.total_amount_excluding_tax || profile.amount,
        null,
        installmentInvoice.total_amount_including_tax && installmentInvoice.total_amount_excluding_tax
          ? ((installmentInvoice.total_amount_including_tax - installmentInvoice.total_amount_excluding_tax) / installmentInvoice.total_amount_excluding_tax * 100)
          : null,
      ]
    );
    
    // Link student to invoice
    await client.query(
      'INSERT INTO invoicestudentstbl (invoice_id, student_id) VALUES ($1, $2)',
      [newInvoice.invoice_id, profile.student_id]
    );
    
    // Calculate next generation date and next invoice month
    const frequency = installmentInvoice.frequency || profile.frequency || '1 month(s)';
    const nextGenDate = calculateNextGenerationDate(
      installmentInvoice.next_generation_date,
      frequency
    );
    
    const nextInvoiceMonth = calculateNextInvoiceMonth(
      installmentInvoice.next_invoice_month || installmentInvoice.next_generation_date,
      frequency
    );
    
    // Check phase limit before generating
    const profileCheck = await client.query(
      'SELECT total_phases, generated_count, downpayment_invoice_id FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1',
      [installmentInvoice.installmentinvoiceprofiles_id]
    );
    
    if (profileCheck.rows.length === 0) {
      throw new Error('Installment invoice profile not found');
    }
    
    const profileData = profileCheck.rows[0];
    const totalPhases = profileData.total_phases;
    const currentCount = profileData.generated_count || 0;
    const maxInvoices = totalPhases !== null ? totalPhases : null; // Max invoices = total_phases (downpayment doesn't count)
    
    // Calculate how many phases are actually paid (downpayment is NOT counted as a phase)
    // Only count paid installment invoices, excluding downpayment invoice
    // Get detailed list for debugging
    const paidInvoicesDetailResult = await client.query(
      `SELECT i.invoice_id, i.invoice_description, i.status, i.installmentinvoiceprofiles_id
       FROM invoicestbl i 
       WHERE i.installmentinvoiceprofiles_id = $1 
         AND i.status = 'Paid'
         AND ($2::INTEGER IS NULL OR i.invoice_id != $2::INTEGER)
       ORDER BY i.invoice_id`,
      [profileData.installmentinvoiceprofiles_id, profileData.downpayment_invoice_id || null]
    );
    
    const paidPhases = paidInvoicesDetailResult.rows.length;
    
    // Debug logging
    console.log('[Generator] Paid invoices count:', paidPhases);
    console.log('[Generator] Paid invoices detail:', JSON.stringify(paidInvoicesDetailResult.rows, null, 2));
    console.log('[Generator] Total phases:', totalPhases);
    console.log('[Generator] Downpayment invoice ID:', profileData.downpayment_invoice_id);
    
    // Check if all phases are already paid (not just generated)
    // If paid_phases < total_phases, we can still generate invoices
    // This is the key check: allow generation based on paid status, not generated count
    if (totalPhases !== null && paidPhases >= totalPhases) {
      throw new Error(`All phases are already paid (${paidPhases}/${totalPhases}). Downpayment is not counted as a phase. Cannot generate more invoices.`);
    }
    
    // Increment generated count
    const newCount = currentCount + 1;
    await client.query(
      'UPDATE installmentinvoiceprofilestbl SET generated_count = $1 WHERE installmentinvoiceprofiles_id = $2',
      [newCount, installmentInvoice.installmentinvoiceprofiles_id]
    );
    
    // Check if this was the last invoice (reached phase limit)
    const isLastInvoice = maxInvoices !== null && newCount >= maxInvoices;
    
    if (isLastInvoice) {
      // Last invoice - mark profile as inactive and update installment invoice status
      await client.query(
        'UPDATE installmentinvoiceprofilestbl SET is_active = false WHERE installmentinvoiceprofiles_id = $1',
        [installmentInvoice.installmentinvoiceprofiles_id]
      );
      
      await client.query(
        `UPDATE installmentinvoicestbl 
         SET status = 'Generated', scheduled_date = $1
         WHERE installmentinvoicedtl_id = $2`,
        [
          formatYmdLocal(new Date()),
          installmentInvoice.installmentinvoicedtl_id,
        ]
      );
    } else {
      // Not last invoice - update with next dates for next cycle
      await client.query(
        `UPDATE installmentinvoicestbl 
         SET status = NULL, next_generation_date = $1, next_invoice_month = $2, scheduled_date = $3
         WHERE installmentinvoicedtl_id = $4`,
        [
          formatYmdLocal(nextGenDate),
          formatYmdLocal(nextInvoiceMonth),
          formatYmdLocal(new Date()), // Update scheduled_date to today (when it was generated)
          installmentInvoice.installmentinvoicedtl_id,
        ]
      );
    }
    
    await client.query('COMMIT');
    
    // Get updated profile data
    const updatedProfile = await client.query(
      'SELECT generated_count, total_phases, is_active FROM installmentinvoiceprofilestbl WHERE installmentinvoiceprofiles_id = $1',
      [installmentInvoice.installmentinvoiceprofiles_id]
    );
    
    return {
      invoice_id: newInvoice.invoice_id,
      invoice_description: `INV-${newInvoice.invoice_id}`,
      student_name: student.full_name,
      amount: installmentInvoice.total_amount_including_tax || profile.amount,
      next_generation_date: isLastInvoice ? null : formatYmdLocal(nextGenDate),
      next_invoice_month: isLastInvoice ? null : formatYmdLocal(nextInvoiceMonth),
      generated_count: updatedProfile.rows[0]?.generated_count || newCount,
      total_phases: updatedProfile.rows[0]?.total_phases || totalPhases,
      phase_limit_reached: isLastInvoice,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Process all due installment invoices
 * 
 * This function:
 * 1. Finds all active installment invoices where next_generation_date <= today
 * 2. For each due invoice:
 *    - Creates an actual invoice in invoicestbl
 *    - Creates invoice items and links student
 *    - Updates the installment invoice record with next generation date and invoice month
 *    - Resets status to NULL so it can be processed again in the next cycle
 * 
 * The next generation date is calculated by adding the frequency (e.g., "1 month(s)") 
 * to the current next_generation_date.
 * 
 * @returns {Object} Summary of processed invoices with details
 */
export const processDueInstallmentInvoices = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Use local date formatting so “today” matches business timezone.
  const todayStr = formatYmdLocal(today);
  
  try {
    // Find all active installment invoices where next_generation_date <= today
    // and status is not 'Generated' (or is null/empty)
    // Only process invoices that haven't been generated yet
    // Check that generated_count < total_phases (phase limit not reached)
    // Only process if downpayment is paid (or no downpayment required)
    const result = await query(
      `SELECT ii.*, ip.student_id, ip.branch_id, ip.package_id, ip.amount as profile_amount, 
              ip.frequency as profile_frequency, ip.description, ip.is_active,
              ip.class_id, ip.total_phases, ip.generated_count,
              ip.downpayment_paid, ip.downpayment_invoice_id
       FROM installmentinvoicestbl ii
       JOIN installmentinvoiceprofilestbl ip ON ii.installmentinvoiceprofiles_id = ip.installmentinvoiceprofiles_id
       WHERE ii.next_generation_date <= $1
         AND (ii.status IS NULL OR ii.status = '' OR ii.status != 'Generated')
         AND ip.is_active = true
         AND (ip.total_phases IS NULL OR ip.generated_count < ip.total_phases)
         AND (ip.downpayment_invoice_id IS NULL OR ip.downpayment_paid = true)
       ORDER BY ii.next_generation_date ASC`,
      [todayStr]
    );
    
    const dueInvoices = result.rows;
    const processed = [];
    const errors = [];
    
    for (const installmentInvoice of dueInvoices) {
      try {
        const invoiceData = await generateInvoiceFromInstallment(installmentInvoice, {
          student_id: installmentInvoice.student_id,
          branch_id: installmentInvoice.branch_id,
          package_id: installmentInvoice.package_id,
          amount: installmentInvoice.profile_amount,
          frequency: installmentInvoice.profile_frequency || installmentInvoice.frequency,
          description: installmentInvoice.description,
        });
        
        processed.push(invoiceData);
      } catch (error) {
        console.error(`Error processing installment invoice ${installmentInvoice.installmentinvoicedtl_id}:`, error);
        errors.push({
          installment_invoice_id: installmentInvoice.installmentinvoicedtl_id,
          student_id: installmentInvoice.student_id,
          error: error.message,
        });
      }
    }
    
    return {
      total_due: dueInvoices.length,
      processed: processed.length,
      errors: errors.length,
      details: {
        processed,
        errors,
      },
    };
  } catch (error) {
    console.error('Error processing due installment invoices:', error);
    throw error;
  }
};

