import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@guilda/types';
import { hasOnlyKnownPermissions, hasPermission, requirePermission } from './permissions.js';

describe('permission bitfields', () => {
  it('requires every bit in a composite permission', () => {
    expect(
      hasPermission(Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES, Permission.VIEW_CHANNEL),
    ).toBe(true);
    expect(
      hasPermission(Permission.VIEW_CHANNEL, Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES),
    ).toBe(false);
  });
  it('rejects absent membership or permission', () => {
    expect(() => requirePermission(null, Permission.VIEW_CHANNEL)).toThrow(
      'Insufficient permissions',
    );
    expect(() =>
      requirePermission(
        { serverId: 's', userId: 'u', permissions: Permission.VIEW_CHANNEL, user: {} as never },
        Permission.SEND_MESSAGES,
      ),
    ).toThrow('Insufficient permissions');
  });
  it('defines restricted defaults and recognizes only declared permission bits', () => {
    expect(DEFAULT_EVERYONE_PERMISSIONS).toBe(
      Permission.VIEW_CHANNEL |
        Permission.SEND_MESSAGES |
        Permission.CONNECT |
        Permission.SPEAK |
        Permission.STREAM,
    );
    expect(hasOnlyKnownPermissions(ALL_PERMISSIONS)).toBe(true);
    expect(hasOnlyKnownPermissions(ALL_PERMISSIONS | (1 << 20))).toBe(false);
  });
});
