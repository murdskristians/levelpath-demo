-- Approvals: who approved or rejected a purchase request, when, and why.
-- It carries its own tenant_id, so its policy is the same simple form as every
-- other table's, and its composite keys keep both references inside the tenant.

CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  purchase_request_id uuid NOT NULL,
  approver_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  comment text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, purchase_request_id) REFERENCES public.purchase_requests (tenant_id, id),
  FOREIGN KEY (tenant_id, approver_id) REFERENCES public.users (tenant_id, id)
);

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.approvals
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approvals TO {{app_role}};
