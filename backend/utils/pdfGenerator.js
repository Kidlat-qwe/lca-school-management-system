import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { query } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generate invoice PDF as buffer
 * @param {number} invoiceId - Invoice ID
 * @returns {Promise<Buffer>} PDF buffer
 */
export const generateInvoicePDFBuffer = async (invoiceId) => {
  // Fetch invoice
  const invoiceResult = await query(
    `SELECT invoice_id, invoice_description, branch_id, amount, status, remarks,
            TO_CHAR(issue_date, 'YYYY-MM-DD') as issue_date,
            TO_CHAR(due_date, 'YYYY-MM-DD') as due_date
     FROM invoicestbl
     WHERE invoice_id = $1`,
    [invoiceId]
  );

  if (invoiceResult.rows.length === 0) {
    throw new Error('Invoice not found');
  }

  const invoice = invoiceResult.rows[0];

  // Fetch branch information
  let branchInfo = null;
  if (invoice.branch_id) {
    const branchResult = await query(
      'SELECT branch_name, branch_address FROM branchestbl WHERE branch_id = $1',
      [invoice.branch_id]
    );
    if (branchResult.rows.length > 0) {
      branchInfo = branchResult.rows[0];
    }
  }

  // Fetch items
  const itemsResult = await query(
    'SELECT description, amount, tax_item, tax_percentage, discount_amount, penalty_amount FROM invoiceitemstbl WHERE invoice_id = $1',
    [invoiceId]
  );

  // Fetch students with phone numbers
  const studentsResult = await query(
    `SELECT inv_student.student_id, u.full_name, u.email, u.phone_number
     FROM invoicestudentstbl inv_student
     LEFT JOIN userstbl u ON inv_student.student_id = u.user_id
     WHERE inv_student.invoice_id = $1`,
    [invoiceId]
  );

  // Fetch payments for this invoice - MATCH INVOICE ROUTE EXACTLY
  const paymentsResult = await query(
    `SELECT p.payment_method, p.payment_type, p.payable_amount, p.reference_number,
            TO_CHAR(p.issue_date, 'YYYY-MM-DD') as payment_date_raw
     FROM paymenttbl p
     WHERE p.invoice_id = $1 AND p.status = 'Completed'
     ORDER BY p.issue_date DESC`,
    [invoiceId]
  );

  // Prepare logo path (if exists) - MATCH INVOICE ROUTE EXACTLY
  const logoPath = path.resolve(process.cwd(), '../frontend/public/LCA Icon.png');
  const hasLogo = fs.existsSync(logoPath);

  // Calculate totals - MATCH INVOICE ROUTE EXACTLY
  const formatCurrency = (value) => `PHP ${(Number(value) || 0).toFixed(2)}`;
  const formatDate = (dateString) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                     'July', 'August', 'September', 'October', 'November', 'December'];
      const day = date.getDate();
      const month = months[date.getMonth()];
      const year = date.getFullYear();
      return `${day.toString().padStart(2, '0')} ${month} ${year}`;
    } catch {
      return dateString;
    }
  };

  const items = itemsResult.rows || [];
  const totals = items.reduce(
    (acc, item) => {
      const amt = Number(item.amount) || 0;
      const discount = Number(item.discount_amount) || 0;
      const penalty = Number(item.penalty_amount) || 0;
      const taxPct = Number(item.tax_percentage) || 0;
      const taxableBase = amt - discount + penalty;
      const tax = taxableBase * (taxPct / 100);
      acc.subtotal += amt;
      acc.discount += discount;
      acc.penalty += penalty;
      acc.tax += tax;
      return acc;
    },
    { subtotal: 0, discount: 0, penalty: 0, tax: 0 }
  );
  const grandTotal = totals.subtotal - totals.discount + totals.penalty + totals.tax;

  // Calculate total payments
  const totalPayments = paymentsResult.rows.reduce((sum, p) => sum + (Number(p.payable_amount) || 0), 0);
  const amountDue = grandTotal - totalPayments;

  // Generate PDF buffer
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      resolve(pdfBuffer);
    });
    doc.on('error', reject);

    // Helper function to extract package name from description
    const extractPackage = (description) => {
      if (!description) return '';
      // Look for package patterns like "Package: Nursery" or just extract level tag
      const packageMatch = description.match(/Package:\s*([^:]+)/i);
      if (packageMatch) return packageMatch[1].trim();
      // Try to extract level tag (e.g., "Nursery", "Pre-Kindergarten")
      const levelMatch = description.match(/^(Nursery|Pre-Kindergarten|Kindergarten|Elementary|Junior High|Senior High)/i);
      if (levelMatch) return levelMatch[1];
      return '';
    };

    // Header Section
    const headerY = 50;
    if (hasLogo) {
      doc.image(logoPath, 50, headerY, { width: 50, height: 50 });
    }
    
    // School name and address
    const schoolNameX = hasLogo ? 120 : 50;
    doc.fontSize(16).fillColor('#000000').font('Helvetica-Bold');
    doc.text('LITTLE CHAMPIONS ACADEMY INC.', schoolNameX, headerY);
    
    // Branch address
    const branchAddress = branchInfo?.branch_address || (branchInfo?.branch_name || '');
    if (branchAddress) {
      doc.fontSize(10).fillColor('#333333').font('Helvetica');
      doc.text(branchAddress, schoolNameX, headerY + 20);
    }

    // INVOICE text on the right
    doc.fontSize(32).fillColor('#000000').font('Helvetica-Bold');
    doc.text('INVOICE', 400, headerY, { align: 'right', width: 150 });

    // Invoice Details Section
    let currentY = headerY + 70;
    doc.fontSize(10).fillColor('#333333').font('Helvetica');
    doc.text(`Invoice Number: INV-${invoice.invoice_id}`, 50, currentY);
    currentY += 12;
    doc.text(`Invoice Date: ${formatDate(invoice.issue_date)}`, 50, currentY);
    currentY += 12;
    doc.text(`Invoice Due Date: ${formatDate(invoice.due_date)}`, 50, currentY);

    currentY += 20;

    // BILL TO Section
    doc.fontSize(12).fillColor('#000000').font('Helvetica-Bold');
    doc.text('BILL TO', 50, currentY);
    currentY += 15;
    
    doc.fontSize(10).fillColor('#333333').font('Helvetica');
    if (studentsResult.rows.length === 0) {
      doc.text('No student linked.', 50, currentY);
      currentY += 12;
      doc.text('Email: -', 50, currentY);
      currentY += 12;
      doc.text('Phone: -', 50, currentY);
      currentY += 12;
      doc.text('Country: Philippines', 50, currentY);
    } else {
      // Combine all student names
      const studentNames = studentsResult.rows.map(s => s.full_name || 'Student').join(', ');
      doc.text(`Name: ${studentNames}`, 50, currentY);
      currentY += 12;
      
      // Combine all emails
      const emails = studentsResult.rows.filter(s => s.email).map(s => s.email).join(', ');
      doc.text(`Email: ${emails || '-'}`, 50, currentY);
      currentY += 12;
      
      // Combine all phone numbers
      const phones = studentsResult.rows.filter(s => s.phone_number).map(s => s.phone_number).join(', ');
      doc.text(`Phone: ${phones ? `+63 ${phones.replace(/^63/, '')}` : '-'}`, 50, currentY);
      currentY += 12;
      doc.text('Country: Philippines', 50, currentY);
    }

    currentY += 20;

    // Line Items Table
    doc.fontSize(10).fillColor('#000000').font('Helvetica-Bold');
    const tableStartY = currentY;
    const colNum = 50;
    const colDesc = 80;
    const colPackage = 350;
    const colQty = 420;
    const colNetAmount = 480;

    // Table Header
    doc.text('#', colNum, tableStartY);
    doc.text('Description', colDesc, tableStartY);
    doc.text('Package', colPackage, tableStartY);
    doc.text('Qty', colQty, tableStartY);
    doc.text('Net Amount', colNetAmount, tableStartY, { width: 70, align: 'right' });
    
    // Draw header line
    doc.moveTo(50, tableStartY + 15).lineTo(550, tableStartY + 15).strokeColor('#000000').lineWidth(0.5).stroke();

    currentY = tableStartY + 25;
    doc.fontSize(9).fillColor('#333333').font('Helvetica');

    if (items.length === 0) {
      doc.text('No items.', colDesc, currentY);
      currentY += 15;
    } else {
      items.forEach((item, idx) => {
        const netAmount = Number(item.amount) || 0;
        const packageName = extractPackage(item.description);
        
        doc.text((idx + 1).toString(), colNum, currentY);
        doc.text(item.description || '-', colDesc, currentY, { width: 250 });
        doc.text(packageName || '-', colPackage, currentY, { width: 60 });
        doc.text('1', colQty, currentY, { width: 30, align: 'center' });
        doc.text(formatCurrency(netAmount), colNetAmount, currentY, { width: 70, align: 'right' });
        currentY += 15;
      });
    }

    currentY += 15;

    // Financial Summary
    doc.fontSize(10).fillColor('#000000').font('Helvetica-Bold');
    doc.text('Total', colNetAmount, currentY, { width: 70, align: 'right' });
    doc.text(formatCurrency(grandTotal), colNetAmount, currentY + 12, { width: 70, align: 'right' });
    currentY += 25;

    // Draw horizontal line after Total
    doc.moveTo(50, currentY).lineTo(550, currentY).strokeColor('#000000').lineWidth(0.5).stroke();
    currentY += 10;

    // Payment details
    if (paymentsResult.rows.length > 0) {
      paymentsResult.rows.forEach((payment) => {
        const paymentMethod = payment.payment_method || 'Cash';
        const refNum = payment.reference_number || '';
        const paymentDate = payment.payment_date_raw ? formatDate(payment.payment_date_raw) : '';
        const paymentAmount = Number(payment.payable_amount) || 0;
        
        // "Fully Settled Via" label on the left
        doc.fontSize(9).fillColor('#333333').font('Helvetica');
        const paymentMethodText = `Fully Settled Via ${paymentMethod}${refNum ? ` ${refNum}` : ''}`;
        doc.text(paymentMethodText, 50, currentY, { width: 300 });
        
        // Payment amount on the right (same line)
        doc.text(formatCurrency(paymentAmount), colNetAmount, currentY, { width: 70, align: 'right' });
        currentY += 15;
        
        // Payment date below, indented
        if (paymentDate) {
          doc.fontSize(8).fillColor('#666666').font('Helvetica');
          doc.text(`(${paymentDate})`, 60, currentY, { width: 300 }); // Indented by 10px
          currentY += 15;
        }
      });
    }

    // Draw horizontal line before Amount Due
    doc.moveTo(50, currentY).lineTo(550, currentY).strokeColor('#000000').lineWidth(0.5).stroke();
    currentY += 10;

    // Amount Due
    doc.fontSize(10).fillColor('#000000').font('Helvetica-Bold');
    doc.text('Amount Due', colNetAmount, currentY, { width: 70, align: 'right' });
    doc.text(formatCurrency(amountDue), colNetAmount, currentY + 12, { width: 70, align: 'right' });

    currentY += 25;

    // Remarks Section - Check if we need to start a new page
    // Only add new page if we're very close to the bottom (be very lenient to avoid unnecessary page breaks)
    const currentPageHeight = doc.page.height;
    const pageTopMargin = 50;
    const pageBottomMargin = 50; // Bottom margin for footer
    // Actual remarks section height is approximately:
    // Thank you (15) + Reminder (20) + Disregard (15) + Facebook Q (12) + URL (12) + Growth (18) + 
    // Regards (12) + Company (12) + Tagline (12) + Branch Address (12) = ~140px
    const estimatedRemarksHeight = 150; // Accurate estimated height including all text and spacing
    const safetyMargin = 10; // Small safety margin
    
    // Calculate usable page height (page height minus margins)
    const usableHeight = currentPageHeight - pageTopMargin - pageBottomMargin;
    // Only create new page if content will definitely overflow the usable area
    // Use a more lenient check - only break if we're really close to the limit
    if (currentY > pageTopMargin && currentY + estimatedRemarksHeight + safetyMargin > currentPageHeight - pageBottomMargin) {
      doc.addPage();
      currentY = pageTopMargin;
    }
    
    doc.fontSize(9).fillColor('#333333').font('Helvetica');
    const remarksY = currentY;
    doc.text('Thank you for choosing Little Champions Academy. Your trust and support are truly valuable to us.', 50, remarksY, { width: 500 });
    currentY += 15;
    
    doc.text('We kindly remind all parents and guardians that payments for monthly tuition fees are due on the 5th day of each month. To avoid inconvenience, we encourage timely payments, as a 10% penalty will be applied to accounts settled after the due date.', 50, currentY, { width: 500 });
    currentY += 20;
    
    doc.text('Please disregard this invoice if payment has already been made.', 50, currentY, { width: 500 });
    currentY += 15;
    
    // Facebook page text with hyperlink - formatted better
    const fbUrl = 'https://www.facebook.com/share/17kpQWebTu';
    doc.text('If you have any questions or need assistance, please don\'t hesitate to reach out to our Facebook Page:', 50, currentY, { width: 500 });
    currentY += 12;
    
    // Put URL on its own line with proper formatting
    const urlStartX = 50;
    const urlY = currentY;
    const urlWidth = doc.widthOfString(fbUrl);
    
    // Add hyperlink for the URL
    doc.link(urlStartX, urlY - 2, urlStartX + urlWidth, urlY + 10, fbUrl);
    
    // Write URL in blue color and underline to indicate it's clickable
    doc.fillColor('#0066cc');
    doc.text(fbUrl, urlStartX, urlY, { 
      width: 500,
      link: fbUrl
    });
    
    // Reset color
    doc.fillColor('#333333');
    currentY += 12;
    
    doc.text('We look forward to another great month of learning and growth together.', 50, currentY, { width: 500 });
    currentY += 18;
    
    doc.text('Warmest regards,', 50, currentY);
    currentY += 12;
    doc.font('Helvetica-Bold');
    doc.text('Little Champions Academy, Inc.', 50, currentY);
    currentY += 12;
    doc.font('Helvetica');
    doc.text('Play. Learn. Succeed.', 50, currentY);
    
    // Add branch address below "Play. Learn. Succeed."
    if (branchInfo?.branch_address) {
      currentY += 12;
      doc.fontSize(9).fillColor('#333333').font('Helvetica');
      doc.text(branchInfo.branch_address, 50, currentY, { width: 500 });
    }

    // Footer - Add at bottom of current page if there's space
    // Calculate footer position: page height minus bottom margin (pageBottomMargin already declared above)
    const footerY = currentPageHeight - pageBottomMargin;
    
    // Only add footer if there's enough space on current page (with 20px buffer)
    if (currentY + 20 < footerY) {
      doc.fontSize(8).fillColor('#666666').font('Helvetica');
      doc.text('This invoice is powered by little-champions academy', 50, footerY, { align: 'center', width: 500 });
    } else {
      // If content is too long, add footer after address (but don't create new page)
      currentY += 15;
      doc.fontSize(8).fillColor('#666666').font('Helvetica');
      doc.text('This invoice is powered by little-champions academy', 50, currentY, { align: 'center', width: 500 });
    }

    doc.end();
  });
};

export default {
  generateInvoicePDFBuffer,
};
