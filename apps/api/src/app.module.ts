import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { MeModule } from './me/me.module.js';
import { VersionController } from './version.controller.js';
import { VersionService } from './version.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, MeModule],
  controllers: [HealthController, VersionController],
  providers: [HealthService, VersionService],
})
export class AppModule {}
