import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(); // closes the database pool on Ctrl+C or SIGTERM
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  console.log(`api listening on http://localhost:${port}`);
}

void bootstrap();
