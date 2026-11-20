-- Purchase requests: draft → submitted → approved | rejected.
--
-- Foreign-key checks bypass RLS, so a plain `supplier_id REFERENCES suppliers`
-- would let tenant A's request point at tenant B's supplier. The references are
-- composite instead, (tenant_id, x_id) against UNIQUE (tenant_id, id) on the
-- parent: the referenced row must belong to the same tenant as this one.
--
-- requester_id and supplier_id are NOT NULL as a product rule (every request has
-- both, for now), not for isolation: a composite key with a NULL member is not
-- checked (MATCH SIMPLE), which is safe because a NULL points at nothing, and
-- tenant_id is NOT NULL on every table.

CREATE TABLE public.purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  requester_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  title text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The target of the composite foreign key from approvals.
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, requester_id) REFERENCES public.users (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES public.suppliers (tenant_id, id)
);

ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.purchase_requests
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requests TO {{app_role}};
