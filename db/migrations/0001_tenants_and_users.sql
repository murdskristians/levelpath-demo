-- Tenants (companies) and their users. Every later table hangs off these two.
--
-- Runs as the owner, inside one transaction (the runner adds it). {{app_role}} is
-- the API's login role; the runner fills it in.
--
-- The tenant policy, on every table: rows are visible and writable only when
-- their tenant is the one set for the current transaction (`withTenant` sets it
-- with set_config(..., true), so it ends with the transaction). NULLIF turns the
-- empty string Postgres leaves behind after a SET LOCAL into NULL, and NULL
-- matches nothing: with no tenant set, every table looks empty. Fail closed.

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('requester', 'approver')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The target of composite foreign keys: a row can only point at a user of its own tenant.
  UNIQUE (tenant_id, id)
);

-- FORCE: without it, the table's owner would bypass the policy.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.tenants
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.users
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- The app reads companies and users but never writes them: sign-up and user
-- management are out of scope, so creating or changing either needs the owner.
GRANT SELECT ON public.tenants, public.users TO {{app_role}};

-- The stub login's one lookup. A request arrives with only a user id, and the
-- policy above hides every user until a tenant is set, so the API can't find the
-- user's tenant by itself. This function runs with its owner's rights (SECURITY
-- DEFINER; the owner is the image's superuser, which RLS doesn't apply to), takes
-- exactly one id and returns that one user's id, tenant and role: no name, and no
-- way to list users. A fixed search_path stops a caller from swapping in its own
-- `users` table, and every name in it is schema-qualified.
CREATE FUNCTION public.app_resolve_user(user_id uuid)
RETURNS TABLE (id uuid, tenant_id uuid, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT u.id, u.tenant_id, u.role FROM public.users AS u WHERE u.id = user_id
$$;

-- Functions are executable by everyone by default; only the app role may call this one.
REVOKE ALL ON FUNCTION public.app_resolve_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_resolve_user(uuid) TO {{app_role}};

-- Every role may create temporary tables in a new database. A temporary table lives
-- as long as its pooled connection and is searched before `public`, so one named
-- like a real table would shadow it for every later request on that connection,
-- whatever the tenant. The app never needs one. CONNECT stays.
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$$;
