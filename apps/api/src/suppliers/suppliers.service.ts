import { Injectable } from '@nestjs/common';
import type { Supplier } from '@levelpath/shared';
import type { AuthUser } from '../auth/auth-user.js';
import { DatabaseService } from '../db/database.service.js';

@Injectable()
export class SuppliersService {
  constructor(private readonly db: DatabaseService) {}

  /** The caller's company suppliers, by name. */
  list(user: AuthUser): Promise<Supplier[]> {
    return this.db.withTenant(user.tenantId, (trx) =>
      trx.selectFrom('suppliers').select(['id', 'name']).orderBy('name').orderBy('id').execute(),
    );
  }
}
