-- Migration 135: Document RHET stock-request lifecycle statuses on merchandise requests.
-- No CHECK constraint — status remains varchar. New values used by webhooks:
-- Pending → Shipped → Delivered → Returned; Pending/Shipped → Rejected.
-- Legacy "Approved" is treated as Delivered (stock already credited).

COMMENT ON COLUMN public.merchandiserequestlogtbl.status IS
  'Request status: Pending, Shipped (in transit; RHET warehouse deducted), Delivered (branch stock credited), Returned, Rejected, Cancelled. Legacy Approved = Delivered.';

COMMENT ON COLUMN public.merchandiserequestlogtbl.inventory_status IS
  'Last known RHET status: PENDING, SHIPPED, DELIVERED, RETURNED, REJECTED. Legacy FULFILLED stored/normalized as DELIVERED.';
