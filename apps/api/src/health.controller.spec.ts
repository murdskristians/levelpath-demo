import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

describe('HealthController', () => {
  it('gets HealthService injected through its constructor and reports ok', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService],
    }).compile();

    const controller = moduleRef.get(HealthController);

    expect(controller.check()).toEqual({ status: 'ok' });
  });
});
