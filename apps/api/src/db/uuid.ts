const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string, any version. Ids and tenant ids are checked before they reach SQL. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
