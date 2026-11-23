import type { ColumnType, Generated } from 'kysely';
import type {
  ApprovalDecision,
  PurchaseRequestCategory,
  PurchaseRequestStatus,
  UserRole,
} from '@levelpath/shared';

// Hand-written table types for Kysely, matching db/migrations/. A column Postgres
// fills in (an id, a default, a timestamp) is Generated: optional on insert.

/** bigint: `pg` returns it as a string, so it is read as one. Phase 3 decides the API shape. */
type BigintColumn = ColumnType<string, string | number | bigint, string | number | bigint>;
/** A nullable column that may be left out of an insert. */
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface TenantsTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Date>;
}

export interface UsersTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  role: UserRole;
  created_at: Generated<Date>;
}

export interface SuppliersTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  created_at: Generated<Date>;
}

export interface PurchaseRequestsTable {
  id: Generated<string>;
  tenant_id: string;
  requester_id: string;
  supplier_id: string;
  title: string;
  amount_cents: BigintColumn;
  currency: Generated<string>;
  status: Generated<PurchaseRequestStatus>;
  description: Generated<string>;
  category: Generated<PurchaseRequestCategory>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ApprovalsTable {
  id: Generated<string>;
  tenant_id: string;
  purchase_request_id: string;
  approver_id: string;
  decision: ApprovalDecision;
  comment: Nullable<string>;
  decided_at: Generated<Date>;
}

/** Every table the app role can reach. schema_migrations is not one of them. */
export interface Database {
  tenants: TenantsTable;
  users: UsersTable;
  suppliers: SuppliersTable;
  purchase_requests: PurchaseRequestsTable;
  approvals: ApprovalsTable;
}
