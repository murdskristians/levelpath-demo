import pg from 'pg';

/**
 * True for a foreign-key (23503) or unique (23505) violation. RLS hides rows, not
 * keys: a reference to another tenant's row fails its composite foreign key, so the
 * caller answers these as "not found" and the response doesn't reveal that the key exists.
 */
export function isKeyViolation(err: unknown): boolean {
  return err instanceof pg.DatabaseError && (err.code === '23503' || err.code === '23505');
}
