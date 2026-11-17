import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { VersionController } from './version.controller.js';
import { VersionService } from './version.service.js';

describe('VersionController', () => {
  it('returns the version from apps/api/package.json', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [VersionController],
      providers: [VersionService],
    }).compile();
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    const result = moduleRef.get(VersionController).get();

    expect(result).toEqual({ version });
    expect(typeof result.version).toBe('string');
    expect(result.version.length).toBeGreaterThan(0);
  });
});
