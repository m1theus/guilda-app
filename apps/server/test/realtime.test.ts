import { describe, expect, it } from 'vitest';
import { Permission } from '@guilda/types';
import { accessTokenFromHandshake, authorizeChannel } from '../src/realtime/server.js';

type SocketFixture = {
  data: {
    userId: string;
    memberships: Map<string, { userId: string; serverId: string; permissions: number }>;
  };
};
const socket = (
  userId: string,
  memberships: SocketFixture['data']['memberships'],
): SocketFixture => ({ data: { userId, memberships } });
const channel = { id: 'channel-1', serverId: 'server-1', name: 'general' };
const database = (
  memberships: SocketFixture['data']['memberships'],
): {
  getMembership: (
    serverId: string,
    userId: string,
  ) => Promise<
    SocketFixture['data']['memberships'] extends Map<string, infer Membership>
      ? Membership | null
      : never
  >;
} => ({
  getMembership: async (serverId, userId) => {
    const membership = memberships.get(serverId);
    return membership?.userId === userId ? membership : null;
  },
});

describe('realtime authorization', () => {
  it('requires a handshake access token and ignores malformed credentials', () => {
    expect(accessTokenFromHandshake({}, undefined)).toBeNull();
    expect(accessTokenFromHandshake({ accessToken: '' }, 'Basic abc')).toBeNull();
    expect(accessTokenFromHandshake({ accessToken: 'socket-token' }, 'Bearer header-token')).toBe(
      'socket-token',
    );
    expect(accessTokenFromHandshake({}, 'Bearer header-token')).toBe('header-token');
  });

  it('denies channel commands for a valid socket that is not a member', async () => {
    const result = await authorizeChannel(
      database(new Map()),
      socket('outsider-1', new Map()),
      channel,
      Permission.VIEW_CHANNEL,
    );
    expect(result).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('binds membership to authenticated user instead of trusting membership payload userId', async () => {
    const memberships = new Map([
      [
        'server-1',
        {
          userId: 'different-user',
          serverId: 'server-1',
          permissions: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
        },
      ],
    ]);
    const result = await authorizeChannel(
      database(memberships),
      socket('attacker-1', memberships),
      channel,
      Permission.SEND_MESSAGES,
    );
    expect(result).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('checks each command permission against the current bitfield', async () => {
    const memberships = new Map([
      [
        'server-1',
        { userId: 'member-1', serverId: 'server-1', permissions: Permission.VIEW_CHANNEL },
      ],
    ]);
    expect(
      await authorizeChannel(
        database(memberships),
        socket('member-1', memberships),
        channel,
        Permission.VIEW_CHANNEL,
      ),
    ).toBeNull();
    expect(
      await authorizeChannel(
        database(memberships),
        socket('member-1', memberships),
        channel,
        Permission.SEND_MESSAGES,
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await authorizeChannel(
        database(memberships),
        socket('member-1', memberships),
        null,
        Permission.VIEW_CHANNEL,
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });
});
