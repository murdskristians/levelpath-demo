import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { DatabaseService } from '../db/database.service.js';
import type { UserRole } from '@levelpath/shared';

export interface MeResponse {
  user: { id: string; name: string; role: UserRole };
  tenant: { id: string; name: string };
}

@Injectable()
export class MeService {
  constructor(private readonly db: DatabaseService) {}

  /** The caller and their company, both read inside the caller's tenant transaction. */
  async me(caller: AuthUser): Promise<MeResponse> {
    return this.db.withTenant(caller.tenantId, async (trx) => {
      const user = await trx
        .selectFrom('users')
        .select(['id', 'name', 'role'])
        .where('id', '=', caller.userId)
        .executeTakeFirst();
      const tenant = await trx
        .selectFrom('tenants')
        .select(['id', 'name'])
        .where('id', '=', caller.tenantId)
        .executeTakeFirst();
      // Only possible if the user was removed after the guard looked them up.
      if (!user || !tenant) throw new UnauthorizedException();
      return { user, tenant };
    });
  }
}
