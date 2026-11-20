import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../db/database.module.js';
import { AuthGuard } from './auth.guard.js';

// APP_GUARD makes AuthGuard run before every route in the app, not only this module's.
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
