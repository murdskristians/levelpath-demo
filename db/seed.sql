-- Demo data: two companies, Acme Corp and Globex Corp, each with a requester, an
-- approver, two suppliers and a purchase request in every status.
--
-- Runs as the owner (`pnpm db:seed`), inside one transaction the runner adds.
-- Idempotent: every row has a fixed id, and a row that exists is left alone, so
-- running it twice changes nothing. The ids are demo data, not secrets: tests,
-- docs and `curl -H "X-User-Id: ..."` refer to them.
--
--   Acme  a0000000-0000-4000-8000-...  Globex  b0000000-0000-4000-8000-...
--   ...000000000001 tenant    ...0101 requester  ...0102 approver
--   ...0201-0202 suppliers    ...0301-0304 purchase requests   ...0401-0402 approvals

INSERT INTO public.tenants (id, name) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'Acme Corp'),
  ('b0000000-0000-4000-8000-000000000001', 'Globex Corp')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, tenant_id, name, role) VALUES
  ('a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000001', 'Alice', 'requester'),
  ('a0000000-0000-4000-8000-000000000102', 'a0000000-0000-4000-8000-000000000001', 'Amir', 'approver'),
  ('b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000001', 'Bella', 'requester'),
  ('b0000000-0000-4000-8000-000000000102', 'b0000000-0000-4000-8000-000000000001', 'Boris', 'approver')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.suppliers (id, tenant_id, name) VALUES
  ('a0000000-0000-4000-8000-000000000201', 'a0000000-0000-4000-8000-000000000001', 'Bright Office Supplies'),
  ('a0000000-0000-4000-8000-000000000202', 'a0000000-0000-4000-8000-000000000001', 'Nordic Laptops'),
  ('b0000000-0000-4000-8000-000000000201', 'b0000000-0000-4000-8000-000000000001', 'Harbor Print Co'),
  ('b0000000-0000-4000-8000-000000000202', 'b0000000-0000-4000-8000-000000000001', 'Summit IT Hardware')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.purchase_requests
  (id, tenant_id, requester_id, supplier_id, title, amount_cents, currency, status) VALUES
  ('a0000000-0000-4000-8000-000000000301', 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000201',
   'Printer paper for Q1', 18000, 'EUR', 'draft'),
  ('a0000000-0000-4000-8000-000000000302', 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000202',
   '20 laptops for new sales hires', 2400000, 'EUR', 'submitted'),
  ('a0000000-0000-4000-8000-000000000303', 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000201',
   'Standing desks for the support team', 640000, 'EUR', 'approved'),
  ('a0000000-0000-4000-8000-000000000304', 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000202',
   'Gaming monitors for the office lounge', 350000, 'EUR', 'rejected'),
  ('b0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000201',
   'Business cards for the new team', 25000, 'EUR', 'draft'),
  ('b0000000-0000-4000-8000-000000000302', 'b0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000202',
   'Docking stations for hybrid desks', 120000, 'EUR', 'submitted'),
  ('b0000000-0000-4000-8000-000000000303', 'b0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000202',
   'Replacement server disks', 89000, 'EUR', 'approved'),
  ('b0000000-0000-4000-8000-000000000304', 'b0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000201',
   'Printed banners for a trade fair', 410000, 'EUR', 'rejected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.approvals
  (id, tenant_id, purchase_request_id, approver_id, decision, comment) VALUES
  ('a0000000-0000-4000-8000-000000000401', 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000303', 'a0000000-0000-4000-8000-000000000102',
   'approved', 'Within the facilities budget.'),
  ('a0000000-0000-4000-8000-000000000402', 'a0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000304', 'a0000000-0000-4000-8000-000000000102',
   'rejected', 'Not a business need.'),
  ('b0000000-0000-4000-8000-000000000401', 'b0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000303', 'b0000000-0000-4000-8000-000000000102',
   'approved', 'Needed before the next outage.'),
  ('b0000000-0000-4000-8000-000000000402', 'b0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000304', 'b0000000-0000-4000-8000-000000000102',
   'rejected', 'The fair was cancelled.')
ON CONFLICT (id) DO NOTHING;
