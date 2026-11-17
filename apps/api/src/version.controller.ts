import { Controller, Get } from '@nestjs/common';
import { VersionService } from './version.service.js';

@Controller('version')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get()
  get(): { version: string } {
    return { version: this.versionService.version() };
  }
}
