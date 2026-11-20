-- Suppliers, per tenant.

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The target of the composite foreign key from purchase_requests.
  UNIQUE (tenant_id, id)
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.suppliers
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO {{app_role}};
