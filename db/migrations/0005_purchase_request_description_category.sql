-- A free-text description and a category on every purchase request (Phase 4).
--
-- Both are NOT NULL with a default, so the rows that exist get '' and 'other' and
-- an insert that leaves them out still works. The table keeps its RLS, policy and
-- grants: new columns on a forced table are covered by the same tenant_isolation.
-- The category list is PURCHASE_REQUEST_CATEGORIES in packages/shared/src/values.ts;
-- a test in apps/api/src/db/migrations.spec.ts checks the two agree.

ALTER TABLE public.purchase_requests
  ADD COLUMN description text NOT NULL DEFAULT ''
    CONSTRAINT purchase_requests_description_length CHECK (char_length(description) <= 2000),
  ADD COLUMN category text NOT NULL DEFAULT 'other'
    CONSTRAINT purchase_requests_category_check
      CHECK (category IN ('hardware', 'software', 'office_supplies', 'services', 'travel', 'other'));
