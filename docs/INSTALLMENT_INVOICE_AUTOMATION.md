# Installment Invoice Automation System

## Overview

The Physical School Management System has an automated invoice generation system for students on installment payment plans. This document explains how it works and the schedule for automated generation.

## Key Features

### 1. Automated Monthly Invoice Generation

**Schedule:** 25th of every month at 2:00 AM  
**Due Date:** 5th of the following month

- The system automatically generates monthly installment invoices on the 25th of each month
- Each generated invoice is due on the 5th of the next month
- This gives students 10 days to pay their monthly installment

**Example:**
- Invoice generated: January 25, 2026
- Due date: February 5, 2026

### 2. Downpayment Invoice

**When:** Instantly upon enrollment  
**Due Date:** Set manually by admin/user during enrollment

- When a student enrolls in an installment plan, a downpayment invoice is created immediately
- The due date for the downpayment invoice is **set by the admin** when creating the enrollment
- This allows flexibility for different payment terms per student
- Admin can set the due date based on the class start date or other business requirements

**Example:**
- Student enrolls: January 10, 2026
- Admin sets downpayment due: January 20, 2026 (or any date they choose)
- Invoice created with that due date

### 3. First Monthly Installment

**When:** Instantly after downpayment is paid  
**Due Date:** Class start date

- Once the downpayment invoice is marked as "Paid," the system automatically generates the first monthly installment invoice
- This happens immediately (within seconds of payment confirmation)
- **The first installment is due on the class start date** (when classes begin)
- This ensures the first payment is made before or when the class starts

**Flow:**
1. Student pays downpayment → `downpayment_paid` flag set to `true`
2. System creates first installment invoice record in `installmentinvoicestbl`
3. First invoice is generated with **due date = class start date**
4. Subsequent invoices are generated automatically on the 25th of each month (due 5th of next month)

## Database Tables

### `installmentinvoiceprofilestbl`
Stores the installment plan profile for each student:
- `student_id`: Student enrolled
- `class_id`: Class they're enrolled in
- `total_phases`: Number of phases in the curriculum
- `generated_count`: How many invoices have been generated
- `downpayment_paid`: Boolean flag indicating if downpayment is paid
- `downpayment_invoice_id`: Link to the downpayment invoice
- `first_generation_date`: Date for first installment generation
- `frequency`: Invoice frequency (e.g., "1 month(s)")

### `installmentinvoicestbl`
Stores individual installment invoice records:
- `installmentinvoiceprofiles_id`: Link to profile
- `next_generation_date`: When to generate the invoice (25th of month)
- `next_invoice_month`: The billing month
- `scheduled_date`: When it was scheduled/generated
- `status`: Generation status ('Generated' or NULL)

### `invoicestbl`
Actual invoices linked via `installmentinvoiceprofiles_id`:
- Generated invoices appear here for payment processing
- Linked to students via `invoicestudentstbl`

## Configuration

### Environment Variables

```env
# Cron schedule for invoice generation
# Default: '0 2 25 * *' (2:00 AM on 25th of every month)
INSTALLMENT_INVOICE_SCHEDULE=0 2 25 * *

# Run invoice generation on server startup (for testing/development)
RUN_INSTALLMENT_INVOICE_ON_STARTUP=false
```

### Cron Schedule Format

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

**Examples:**
- `0 2 25 * *` - 2:00 AM on the 25th of every month
- `0 3 25 * *` - 3:00 AM on the 25th of every month  
- `30 2 25 * *` - 2:30 AM on the 25th of every month

## Processing Logic

### Monthly Invoice Generation (`processDueInstallmentInvoices`)

The scheduler runs and:

1. **Finds due invoices:**
   ```sql
   WHERE next_generation_date <= today
     AND (status IS NULL OR status != 'Generated')
     AND is_active = true
     AND (generated_count < total_phases)
     AND (downpayment_paid = true)
   ```

2. **For each due invoice:**
   - Creates invoice in `invoicestbl`
   - Issue date = `next_generation_date` (25th)
   - Due date = 5th of next month
   - Applies any promo discounts if applicable
   - Links invoice to student
   - Updates `next_generation_date` by adding frequency (typically 1 month)
   - Increments `generated_count`
   - If `generated_count` reaches `total_phases`, marks profile as inactive

3. **Phase Completion:**
   - When all phases are generated and paid, the installment plan is complete
   - No more invoices will be generated
   - Student graduates from the class

## How It Works: End-to-End Flow

### Scenario: Student Enrolls in 6-Month Installment Plan

**January 10, 2026:** Student enrolls
- Downpayment invoice created (due date set by admin, e.g., Jan 20)
- Installment profile created with `total_phases = 6`, `class_id` linked
- `downpayment_paid = false`
- Class starts on February 1, 2026

**January 15, 2026:** Student pays downpayment
- `downpayment_paid` set to `true`
- First installment invoice record created in `installmentinvoicestbl`
- First monthly invoice generated immediately with **due date = Feb 1 (class start date)**
- `next_generation_date` set to Feb 25
- `generated_count = 1`

**February 25, 2026, 2:00 AM:** Scheduler runs
- Second monthly invoice generated (due: Mar 5)
- `next_generation_date` set to Mar 25
- `generated_count = 2`

**March 25, April 25, May 25, June 25:** Subsequent invoices generated
- Each due on the 5th of following month
- `generated_count` increments each time

**July 1, 2026:** Last invoice paid
- `generated_count = 6` (reached `total_phases`)
- Profile marked as `is_active = false`
- No more invoices will be generated
- Student completes installment plan

## Testing

### Manual Testing

1. **Test Downpayment Invoice Creation:**
   ```
   - Enroll a student with an Installment package
   - Check that downpayment invoice is created
   - Verify due date = class start date
   ```

2. **Test First Installment Generation:**
   ```
   - Mark the downpayment invoice as "Paid"
   - Check that first installment invoice is generated immediately
   - Verify due date = 5th of next month
   ```

3. **Test Scheduled Generation:**
   ```
   - Set RUN_INSTALLMENT_INVOICE_ON_STARTUP=true in .env
   - Restart backend
   - Check logs for invoice generation
   - Verify invoices appear in system
   ```

4. **Test Due Date Calculation:**
   ```
   - Generate invoice on Jan 25
   - Verify due date is Feb 5
   - Generate invoice on Feb 25
   - Verify due date is Mar 5
   ```

### Using the Test Script

```bash
cd backend
node scripts/testInstallmentAutoGeneration.js
```

This script simulates the scheduled job and shows what invoices would be generated.

## Troubleshooting

### Invoices Not Generating

1. **Check scheduler is running:**
   ```
   # Look for this log on startup:
   📅 Installment invoice scheduler configured: 0 2 25 * *
   ```

2. **Check downpayment status:**
   ```sql
   SELECT * FROM installmentinvoiceprofilestbl 
   WHERE downpayment_paid = false;
   ```
   Invoices won't generate until downpayment is paid.

3. **Check next generation date:**
   ```sql
   SELECT * FROM installmentinvoicestbl 
   WHERE next_generation_date <= CURRENT_DATE 
     AND status IS NULL;
   ```
   This shows which invoices are due for generation.

4. **Check phase limit:**
   ```sql
   SELECT generated_count, total_phases 
   FROM installmentinvoiceprofilestbl 
   WHERE is_active = true;
   ```
   If `generated_count >= total_phases`, no more invoices will generate.

### Wrong Due Dates

1. **First installment should be due on class start date:**
   - Check `installmentInvoiceGenerator.js` line ~158-175
   - Should check `isFirstInvoice` and use class start date
   - Fallback to 5th of next month if class start date unavailable

2. **Subsequent monthly invoices should be due on 5th:**
   - Check `installmentInvoiceGenerator.js` line ~176-180
   - Should set `dueDate.setDate(5)`

3. **Downpayment due date is manual:**
   - Set by admin during enrollment via `installment_settings.invoice_due_date`
   - No automatic date setting

## Files Modified

### Backend
- `backend/jobs/installmentInvoiceScheduler.js` - Scheduler (runs on 25th)
- `backend/utils/installmentInvoiceGenerator.js` - Due date calculation (5th of next month)
- `backend/routes/classes.js` - Downpayment invoice due date (class start date)
- `backend/routes/payments.js` - Downpayment payment handling and first invoice generation

### Frontend
- No frontend changes required (all backend automation)

## Notes

- **Philippines Time (UTC+8):** All dates are handled in server time. Ensure server timezone is set correctly.
- **Holidays:** The system does not automatically skip generation on holidays. Invoices generate on schedule regardless.
- **Promo Codes:** If a promo is applied during enrollment, discounts are automatically applied to monthly invoices based on promo scope settings.
- **Delinquency:** A separate delinquency scheduler tracks overdue invoices and applies penalties if configured.

## Future Enhancements

Potential improvements:
- Email notifications when invoices are generated
- SMS reminders for upcoming due dates
- Grace period configuration before late fees
- Holiday-aware generation (skip generation on holidays)
- Custom generation schedules per class or student
