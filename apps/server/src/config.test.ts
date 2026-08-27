import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const baseEnv = {
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long', // gitleaks:allow
};

it('allows the Vite and native desktop origins by default', () => {
  expect(loadConfig(baseEnv).CORS_ORIGIN).toEqual([
    'http://127.0.0.1:1420',
    'http://localhost:1420',
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
  ]);
});

it('keeps access tokens at two days despite a legacy environment override', () => {
  const config = loadConfig({ ...baseEnv, ACCESS_TOKEN_TTL_SECONDS: '900' });
  expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(2 * 24 * 60 * 60);
});

describe('server CORS configuration', () => {
  it('parses and deduplicates comma-separated exact desktop origins', () => {
    const config = loadConfig({
      ...baseEnv,
      CORS_ORIGIN:
        'tauri://localhost, http://tauri.localhost,https://tauri.localhost,tauri://localhost',
    });
    expect(config.CORS_ORIGIN).toEqual([
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ]);
  });

  it.each(['*', 'https://*.example.com', 'https://example.com/path'])(
    'rejects non-exact origin %s',
    (origin) => {
      expect(() => loadConfig({ ...baseEnv, CORS_ORIGIN: origin })).toThrow(
        /comma-separated exact origins without wildcards/,
      );
    },
  );
});
