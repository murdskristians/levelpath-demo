import type { UserRole } from '@levelpath/shared';

/** The caller, as the auth guard resolved it from X-User-Id. The only source of a request's tenant. */
export interface AuthUser {
  userId: string;
  tenantId: string;
  role: UserRole;
}
