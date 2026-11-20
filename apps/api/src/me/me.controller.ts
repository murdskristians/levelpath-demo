import { Controller, Get } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { type MeResponse, MeService } from './me.service.js';

// GET /me: who the X-User-Id header says you are. It exists to show the guard and
// withTenant working end to end; Phase 3's purchase-request routes follow the same pattern.
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  get(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.meService.me(user);
  }
}
