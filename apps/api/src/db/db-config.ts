import type pg from 'pg';

/** How the API reaches Postgres: always as the app role, never as the owner. */
export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** Pool size. */
  max?: number;
  /** Called with every SQL statement Kysely runs. Tests record them. */
  log?: (sql: string) => void;
  /**
   * A pool to use instead of creating one. Only tests set it: they hand in a pool of
   * one connection to watch what that connection carries between transactions.
   */
  pool?: pg.Pool;
}

/** Injection token for DbConfig. Tests override it to point at their own database. */
export const DB_CONFIG = Symbol('DB_CONFIG');

/**
 * Settings from the process environment, with defaults that match docker-compose.yml
 * and .env.sample. The owner's login (POSTGRES_USER) is deliberately not read here.
 */
export function dbConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DbConfig {
  return {
    host: env.POSTGRES_HOST ?? 'localhost',
    port: Number(env.POSTGRES_PORT ?? 5432),
    database: env.POSTGRES_DB ?? 'levelpath',
    user: env.APP_DB_USER ?? 'levelpath_app',
    password: env.APP_DB_PASSWORD ?? 'levelpath_app_dev_password',
  };
}
