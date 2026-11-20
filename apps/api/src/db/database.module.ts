import { Module } from '@nestjs/common';
import { DatabaseService } from './database.service.js';
import { DB_CONFIG, dbConfigFromEnv } from './db-config.js';

// Exports DatabaseService only: nothing else in the app can reach the pool.
@Module({
  providers: [{ provide: DB_CONFIG, useFactory: () => dbConfigFromEnv() }, DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
