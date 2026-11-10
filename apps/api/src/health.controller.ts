import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  // Nest sees this constructor parameter type and injects the HealthService instance.
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): { status: 'ok' } {
    return { status: this.health.status() };
  }
}
