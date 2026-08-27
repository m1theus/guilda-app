import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  Permission,
  type GuildServer,
  type Invite,
} from '@guilda/types';
import { registerServerRoutes } from '../src/http/servers.js';
import { errorHandler } from '../src/http/errors.js';
import { RepositoryError, type Repository } from '../src/repository.js';

const server: GuildServer = {
  id: 'server-1',
  name: 'Security Test',
  iconUrl: null,
  ownerId: 'owner-1',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
const channel = {
  id: 'channel-1',
  serverId: server.id,
  name: 'general',
  type: 'TEXT' as const,
  position: 0,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function fixture() {
  const members = new Map([
    [
      'owner-1',
      {
        serverId: server.id,
        userId: 'owner-1',
        permissions: ALL_PERMISSIONS,
        user: {} as never,
      },
    ],
    [
      'member-1',
      {
        serverId: server.id,
        userId: 'member-1',
        permissions: Permission.VIEW_CHANNEL,
        user: {} as never,
      },
    ],
  ]);
  const invites = new Map<string, Invite>();
  const bannedUsers = new Set<string>();
  const repo = {
    getMembership: async (serverId: string, userId: string) =>
      serverId === server.id ? (members.get(userId) ?? null) : null,
    getSnapshot: async (_serverId: string, currentUserId: string) => ({
      server,
      channels: [channel],
      members: [],
      currentUserPermissions: members.get(currentUserId)?.permissions ?? 0,
    }),
    listServersForUser: async (userId: string) => (members.has(userId) ? [server] : []),
    createServer: async () => ({ server, defaultChannel: channel }),
    createChannel: async (input: { serverId: string; name: string; type: 'TEXT' | 'VOICE' }) => ({
      ...channel,
      ...input,
      id: 'channel-2',
    }),
    createInvite: async (input: {
      serverId: string;
      createdById: string;
      expiresAt: Date | null;
      maxUses: number | null;
    }) => {
      const invite = { code: `invite-${invites.size + 1}`, ...input, uses: 0 };
      invites.set(invite.code, invite);
      return invite;
    },
    getInvite: async (code: string) => invites.get(code) ?? null,
    acceptInvite: async (code: string, userId: string) => {
      const invite = invites.get(code);
      if (!invite) throw new RepositoryError('INVITE_NOT_FOUND');
      if (invite.expiresAt && new Date(invite.expiresAt) <= new Date())
        throw new RepositoryError('INVITE_EXPIRED');
      if (invite.maxUses !== null && invite.uses >= invite.maxUses)
        throw new RepositoryError('INVITE_EXHAUSTED');
      if (bannedUsers.has(userId)) throw new RepositoryError('USER_BANNED');
      invite.uses += 1;
      members.set(userId, {
        serverId: invite.serverId,
        userId,
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
        user: {} as never,
      });
      return server;
    },
  } as unknown as Repository;
  const auth = {
    verifyAccessToken: async (token: string) => {
      if (token === 'owner-token') return 'owner-1';
      if (token === 'member-token') return 'member-1';
      if (token === 'outsider-token') return 'outsider-1';
      throw new Error('invalid token');
    },
  } as never;
  return { repo, auth, invites, members, bannedUsers };
}

async function appFor(fixtureState = fixture()) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await registerServerRoutes(app, fixtureState.repo, fixtureState.auth);
  return { app, ...fixtureState };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('server membership and invite authorization', () => {
  it('does not disclose a server snapshot to a valid non-member token', async () => {
    const { app } = await appFor();
    const response = await app.inject({
      method: 'GET',
      url: `/servers/${server.id}`,
      headers: bearer('outsider-token'),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
    await app.close();
  });
  it('returns the owner effective all-permissions mask in the snapshot', async () => {
    const { app } = await appFor();
    const response = await app.inject({
      method: 'GET',
      url: `/servers/${server.id}`,
      headers: bearer('owner-token'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ currentUserPermissions: ALL_PERMISSIONS });
    await app.close();
  });

  it('requires independent permissions for channel and invite administration', async () => {
    const { app } = await appFor();
    const channelResponse = await app.inject({
      method: 'POST',
      url: `/servers/${server.id}/channels`,
      headers: bearer('member-token'),
      payload: { name: 'private', type: 'TEXT' },
    });
    const inviteResponse = await app.inject({
      method: 'POST',
      url: `/servers/${server.id}/invites`,
      headers: bearer('member-token'),
      payload: {},
    });
    expect(channelResponse.statusCode).toBe(403);
    expect(inviteResponse.statusCode).toBe(403);
    await app.close();
  });

  it('atomically consumes an invite and rejects a second use after maxUses', async () => {
    const state = fixture();
    const { app } = await appFor(state);
    const created = await app.inject({
      method: 'POST',
      url: `/servers/${server.id}/invites`,
      headers: bearer('owner-token'),
      payload: { maxUses: 1 },
    });
    expect(created.statusCode).toBe(200);
    const code = created.json().invite.code;
    expect(created.json().deepLink).toBe(`https://noxera.online/invite/${code}`);
    const accepted = await app.inject({
      method: 'POST',
      url: `/invites/${code}/accept`,
      headers: bearer('outsider-token'),
    });
    expect(accepted.statusCode).toBe(200);
    expect(state.members.get('outsider-1')?.permissions).toBe(DEFAULT_EVERYONE_PERMISSIONS);
    expect((state.members.get('outsider-1')?.permissions ?? 0) & Permission.MANAGE_SERVER).toBe(0);
    const replay = await app.inject({
      method: 'POST',
      url: `/invites/${code}/accept`,
      headers: bearer('member-token'),
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toMatchObject({ code: 'INVITE_EXHAUSTED' });
    await app.close();
  });

  it.each([
    ['missing invite', 'missing-code', 404, 'INVITE_NOT_FOUND'],
    ['expired invite', 'expired-code', 410, 'INVITE_EXPIRED'],
  ])('returns a typed failure for %s', async (_label, code, status, errorCode) => {
    const state = fixture();
    if (code === 'expired-code') {
      state.invites.set(code, {
        code,
        serverId: server.id,
        createdById: 'owner-1',
        expiresAt: new Date(0).toISOString(),
        maxUses: null,
        uses: 0,
      });
    }
    const { app } = await appFor(state);
    const response = await app.inject({
      method: 'POST',
      url: `/invites/${code}/accept`,
      headers: bearer('outsider-token'),
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code: errorCode });
    await app.close();
  });

  it('rejects a banned invitee with a typed forbidden response', async () => {
    const state = fixture();
    state.invites.set('banned-code', {
      code: 'banned-code',
      serverId: server.id,
      createdById: 'owner-1',
      expiresAt: null,
      maxUses: null,
      uses: 0,
    });
    state.bannedUsers.add('outsider-1');
    const { app } = await appFor(state);
    const response = await app.inject({
      method: 'POST',
      url: '/invites/banned-code/accept',
      headers: bearer('outsider-token'),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'USER_BANNED' });
    await app.close();
  });
});
