import { Controller, Get } from '@nestjs/common';
import type { Supplier } from '@levelpath/shared';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SuppliersService } from './suppliers.service.js';

// GET /suppliers: the caller's company suppliers, for the create form.
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<Supplier[]> {
    return this.suppliers.list(user);
  }
}
