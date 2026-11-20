import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator.js';
import { HealthService } from './health.service.js';

@Public()
@Controller('health')
export class HealthController {
  // Nest sees this constructor parameter type and injects the HealthService instance.
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): { status: 'ok' } {
    return { status: this.health.status() };
  }
}
