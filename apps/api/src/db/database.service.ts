import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { AuthUser } from '../auth/auth-user.js';
import { DB_CONFIG, type DbConfig } from './db-config.js';
import type { Database } from './schema.js';
import { isUuid } from './uuid.js';
import type { UserRole } from '@levelpath/shared';

/** What a service gets inside `withTenant`: a transaction in which only one tenant's rows exist. */
export type TenantTransaction = Transaction<Database>;

/**
 * The API's only way into Postgres. This file is the only one that holds the
 * Kysely instance and its pool, and it hands out exactly two things:
 *
 * - `withTenant(tenantId, fn)`: every read and write of tenant data.
 * - `resolveUser(userId)`: the stub login's lookup, before a tenant is known.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly db: Kysely<Database>;

  constructor(@Inject(DB_CONFIG) config: DbConfig) {
    const pool =
      config.pool ??
      new pg.Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        max: config.max ?? 10,
      });
    // A connection that dies (Postgres restarting) emits 'error' on its client, whether
    // a request holds it or it sits idle, and an idle one also on the pool. Node treats
    // an 'error' event nobody listens to as fatal, and the API would exit. So every
    // client gets a listener that logs it, and the pool one that keeps Node running.
    // pg drops the dead connection; the next query opens a fresh one.
    pool.on('connect', (client) => {
      client.on('error', (err) => {
        this.logger.error(`a database connection failed: ${err.message}`);
      });
    });
    pool.on('error', () => {
      // Already logged by the client's own listener above.
    });
    const log = config.log;
    this.db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
      log: log
        ? (event) => {
            if (event.level === 'query') log(event.query.sql);
          }
        : undefined,
    });
  }

  /**
   * Run `fn` in a transaction scoped to one tenant.
   *
   * The first statement sets `app.tenant_id` with set_config(..., true): LOCAL, so
   * it ends with the transaction. The pool gives the same connection to the next
   * request, and a session-wide SET would hand it this tenant's data. With LOCAL,
   * the connection goes back to the pool with no tenant, whether `fn` committed or
   * threw (Kysely rolls back and rethrows). The RLS policies read the setting.
   */
  async withTenant<T>(tenantId: string, fn: (trx: TenantTransaction) => Promise<T>): Promise<T> {
    if (!isUuid(tenantId)) {
      throw new Error('withTenant needs the tenant id as a UUID');
    }
    return this.db.transaction().execute(async (trx) => {
      await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
      return fn(trx);
    });
  }

  /**
   * The user's id, tenant and role, or undefined when no user has this id.
   * It runs outside `withTenant` because the tenant isn't known yet, through the one
   * function the app role may call for this (app_resolve_user in migration 0001):
   * one id in, one row out, and RLS on `users` stays on. The `::uuid` cast makes
   * Postgres pick exactly that function: an untyped argument would also match a
   * look-alike `app_resolve_user(text)`, if one were ever planted.
   */
  async resolveUser(userId: string): Promise<AuthUser | undefined> {
    if (!isUuid(userId)) return undefined;
    const { rows } = await sql<{ id: string; tenant_id: string; role: UserRole }>`
      select id, tenant_id, role from public.app_resolve_user(${userId}::uuid)
    `.execute(this.db);
    const row = rows[0];
    return row ? { userId: row.id, tenantId: row.tenant_id, role: row.role } : undefined;
  }

  /** Nest calls this at startup: the API refuses to run on a login RLS doesn't apply to. */
  async onModuleInit(): Promise<void> {
    await this.assertRestrictedLogin();
  }

  /**
   * Throws when the login this service connects as could get around row-level
   * security, so a wrong APP_DB_USER (the owner, say) stops the API instead of
   * quietly serving every tenant's rows. Checked, not trusted:
   *
   * - superuser or BYPASSRLS: skips every policy;
   * - REPLICATION: replication connections ignore RLS;
   * - a member of another role: attributes aren't inherited, but SET ROLE to, say,
   *   the owner is allowed, and ownership is inherited;
   * - owns a table or schema: an owner can turn its policies off;
   * - may create schemas, objects in a schema, or temporary tables: a table or
   *   function of its own named like a real one could shadow it;
   * - may TRUNCATE a table: RLS doesn't apply to TRUNCATE.
   *
   * It reads session_user, the login itself, not a role a per-role setting may have
   * switched the session to.
   */
  private async assertRestrictedLogin(): Promise<void> {
    const { rows } = await sql<{
      user: string;
      database: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolreplication: boolean;
      member_of_roles: boolean;
      owns_objects: boolean;
      can_create_schemas: boolean;
      can_create_in_schema: boolean;
      can_create_temp_tables: boolean;
      can_truncate: boolean;
    }>`
      select session_user as "user", current_database() as "database",
             r.rolsuper, r.rolbypassrls, r.rolreplication,
             exists (select 1 from pg_auth_members m where m.member = r.oid) as member_of_roles,
             exists (select 1 from pg_class c where c.relowner = r.oid)
               or exists (select 1 from pg_namespace n where n.nspowner = r.oid) as owns_objects,
             has_database_privilege(r.oid, current_database(), 'CREATE') as can_create_schemas,
             exists (select 1 from pg_namespace n
                     where has_schema_privilege(r.oid, n.oid, 'CREATE')) as can_create_in_schema,
             has_database_privilege(r.oid, current_database(), 'TEMP') as can_create_temp_tables,
             exists (select 1 from pg_class c where c.relkind in ('r', 'p')
                     and has_table_privilege(r.oid, c.oid, 'TRUNCATE')) as can_truncate
      from pg_roles r where r.rolname = session_user
    `.execute(this.db);
    const login = rows[0];
    if (!login) throw new Error('the database login is not in pg_roles');
    const problems = [
      login.rolsuper && 'is a superuser',
      login.rolbypassrls && 'has BYPASSRLS',
      login.rolreplication && 'has REPLICATION',
      login.member_of_roles && 'is a member of another role',
      login.owns_objects && 'owns tables or schemas',
      login.can_create_schemas && 'can create schemas in this database',
      // Postgres 14 and older give PUBLIC CREATE on schema public by default: say how to fix it.
      login.can_create_in_schema &&
        'can create objects in a schema (on Postgres 14 or older, as the owner: REVOKE CREATE ON SCHEMA public FROM PUBLIC)',
      // A database migrated before 0001 revoked it keeps PUBLIC's default: say how to fix it.
      login.can_create_temp_tables &&
        `can create temporary tables (fix, as the owner: REVOKE TEMPORARY ON DATABASE "${login.database}" FROM PUBLIC)`,
      login.can_truncate && 'can truncate a table',
    ].filter(Boolean);
    if (problems.length > 0) {
      throw new Error(
        `refusing to run: the database login "${login.user}" ${problems.join(', ')}, so ` +
          'row-level security would not hold for it. Fix the login (APP_DB_USER) or this database’s grants.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
