// Types for test-databases.mjs, for the TypeScript spec that imports it (allowJs is off).
import type pg from 'pg';

export const STALE_AFTER_MS: number;
export function testDatabaseName(now?: Date): string;
export function startedAt(name: string): Date | null;
export function dropStaleTestDatabases(admin: pg.Client, now?: Date): Promise<string[]>;
