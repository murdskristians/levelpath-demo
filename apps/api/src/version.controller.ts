import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator.js';
import { VersionService } from './version.service.js';

@Public()
@Controller('version')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get()
  get(): { version: string } {
    return { version: this.versionService.version() };
  }
}
