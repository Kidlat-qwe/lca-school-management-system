# Acknowledgement Receipt – Merchandise Workflow

## Overview

The system supports two types of Acknowledgement Receipts (AR):

1. **Package** – For enrollment packages (existing flow)
2. **Merchandise** – For merchandise-only purchases (buy merchandise)

## Access Control

- **Merchandise AR**: Superadmin and Branch Admin (Admin) only
- **Package AR**: Superadmin, Admin, Finance, Superfinance

## Merchandise AR Flow

1. **Create AR**
   - Click "Create Acknowledgement Receipt"
   - Select branch (Superadmin) or use current branch (Admin)
   - Select "Merchandise" as Issue Type
   - Fill: Student Name, select merchandise (multiple), reference number, attachment (optional)
   - Amount is auto-calculated and read-only
   - Submit → AR created with status "Pending"

2. **Auto-Generated Invoice**
   - On AR creation, an invoice is auto-generated
   - Invoice description: `Merchandise - AR {AR_NUMBER}`
   - Invoice status: Unpaid
   - Invoice is linked to the AR via `ack_receipt_id`

3. **Payment**
   - Go to Invoice or Payment page
   - Find the merchandise invoice
   - Record payment (student is Walk-in Customer or linked student)
   - Payment is recorded in payment logs

4. **Stock Deduction**
   - When the invoice is fully paid, stock is deducted from `merchandisestbl` for the selected branch
   - AR status is updated to "Paid"

## Database Changes (Migration 078)

- `acknowledgement_receiptstbl`: `ar_type`, `merchandise_items_snapshot`, nullable package fields
- `invoicestbl`: `ack_receipt_id` (links to AR)
- Walk-in Customer user for prospect merchandise purchases

## API

- **POST /acknowledgement-receipts** with `ar_type: 'Merchandise'` and `merchandise_items: [{merchandise_id, quantity}]`
- Stock deduction happens in **POST /payments** when invoice is fully paid
