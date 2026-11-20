import { describe, expect, it } from 'vitest';
import config, { apiProxy } from '../vite.config';

describe('dev proxy', () => {
  it('defaults to port 3000', () => {
    expect(apiProxy(undefined)['/api'].target).toBe('http://localhost:3000');
  });

  it('follows API_PORT', () => {
    expect(apiProxy('4567')['/api'].target).toBe('http://localhost:4567');
  });

  it('strips the /api prefix', () => {
    expect(apiProxy(undefined)['/api'].rewrite('/api/me')).toBe('/me');
  });

  it('is wired into the server config', () => {
    expect(config).toHaveProperty('server.proxy./api');
  });
});
