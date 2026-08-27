import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Repository } from '../src/repository.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('application HTTP policy', () => {
  it('caches successful CORS preflight responses for ten minutes', async () => {
    app = await buildApp({
      repo: {} as Repository,
      config: loadConfig({
        JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long', // gitleaks:allow
        CORS_ORIGIN: 'https://noxera.online',
      }),
      logger: false,
    });

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/servers/server-1/voice-state',
      headers: {
        origin: 'https://noxera.online',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-max-age']).toBe('600');
  });
});
