import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, Permission } from '@guilda/types';
import { hasPermission, requirePermission } from '../src/modules/permissions.js';

const member = (permissions: number) => ({
  serverId: 'server-1',
  userId: 'user-1',
  permissions,
  user: {
    id: 'user-1',
    username: 'member',
    displayName: 'Member',
    email: 'member@example.test',
    avatarUrl: null,
    pronouns: null,
    bio: null,
    bannerUrl: null,
    profileColor: null,
    status: 'OFFLINE' as const,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
});

describe('permission bitfields', () => {
  it('composes independent grants and does not require exact equality', () => {
    const grants = Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES;
    expect(hasPermission(grants, Permission.VIEW_CHANNEL)).toBe(true);
    expect(hasPermission(grants, Permission.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(grants, Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(grants, Permission.MANAGE_MESSAGES)).toBe(false);
  });

  it('recognizes the complete known mask without granting unknown bits', () => {
    expect(hasPermission(ALL_PERMISSIONS, ALL_PERMISSIONS)).toBe(true);
    expect(
      hasPermission(Permission.VIEW_CHANNEL, Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES),
    ).toBe(false);
  });

  it('rejects missing membership and missing grants with the same authorization path', () => {
    expect(() => requirePermission(null, Permission.VIEW_CHANNEL)).toThrowError(/permissions/i);
    expect(() =>
      requirePermission(member(Permission.VIEW_CHANNEL), Permission.SEND_MESSAGES),
    ).toThrowError(/permissions/i);
    expect(requirePermission(member(Permission.VIEW_CHANNEL), Permission.VIEW_CHANNEL).userId).toBe(
      'user-1',
    );
  });
});
