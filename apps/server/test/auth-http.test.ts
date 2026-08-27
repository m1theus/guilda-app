import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthService } from '../src/modules/auth.js';
import { registerAuthRoutes } from '../src/http/auth.js';
import { errorHandler } from '../src/http/errors.js';

const updatedUser = {
  id: 'user-1',
  username: 'mira',
  displayName: 'Updated Mira',
  email: 'mira@example.test',
  avatarUrl: 'https://cdn.example.test/avatar.png',
  pronouns: 'they/them',
  bio: 'A short bio',
  bannerUrl: 'https://cdn.example.test/banner.png',
  profileColor: '#112233',
  status: 'ONLINE' as const,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(1).toISOString(),
};

async function createApp() {
  const calls: unknown[] = [];
  const auth = {
    verifyAccessToken: async (token: string) => {
      if (token !== 'access-token') throw new Error('invalid token');
      return updatedUser.id;
    },
    register: async (input: unknown) => {
      calls.push(input);
      return {
        user: updatedUser,
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      };
    },
    updateProfile: async (_userId: string, input: unknown) => {
      calls.push(input);
      return updatedUser;
    },
  } as unknown as AuthService;
  const app = Fastify({ logger: false });
  app.setErrorHandler(errorHandler);
  await registerAuthRoutes(app, auth);
  return { app, calls };
}

describe('registration password validation', () => {
  it('accepts a password with exactly eight characters', async () => {
    const { app, calls } = await createApp();
    const payload = {
      username: 'mira',
      displayName: 'Mira',
      email: 'mira@example.test',
      password: '12345678',
    };
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([payload]);
    await app.close();
  });

  it('rejects a seven-character password before registration', async () => {
    const { app, calls } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: 'mira',
        displayName: 'Mira',
        email: 'mira@example.test',
        password: '1234567',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
    await app.close();
  });
});

describe('authenticated profile updates', () => {
  it('accepts valid profile fields and returns the updated user', async () => {
    const { app, calls } = await createApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/users/@me',
      headers: { authorization: 'Bearer access-token' },
      payload: {
        displayName: 'Updated Mira',
        pronouns: 'they/them',
        bio: 'A short bio',
        avatarUrl: 'https://cdn.example.test/avatar.png',
        bannerUrl: 'https://cdn.example.test/banner.png',
        profileColor: '#112233',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(updatedUser);
    expect(calls).toHaveLength(1);
    await app.close();
  });

  it.each([
    { displayName: '', avatarUrl: 'https://cdn.example.test/avatar.png' },
    { displayName: 'Valid', avatarUrl: 'http://cdn.example.test/avatar.png' },
    { displayName: 'Valid', profileColor: '#123' },
    { displayName: 'Valid', bio: 'x'.repeat(191) },
  ])('rejects invalid profile values', async (payload) => {
    const { app, calls } = await createApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/users/@me',
      headers: { authorization: 'Bearer access-token' },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
    await app.close();
  });
});
