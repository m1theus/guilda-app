import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  Permission,
  type AuditLog,
  type GuildServer,
  type Report,
  type Role,
} from '@guilda/types';
import { registerModerationRoutes } from '../src/http/moderation.js';
import { registerServerRoutes } from '../src/http/servers.js';
import { errorHandler } from '../src/http/errors.js';
import { RepositoryError, type Repository } from '../src/repository.js';

const server: GuildServer = {
  id: 'server-1',
  name: 'Roles',
  iconUrl: null,
  ownerId: 'owner-1',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
const everyone: Role = {
  id: 'everyone-role',
  serverId: server.id,
  name: '@everyone',
  permissions:
    Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.CONNECT | Permission.SPEAK,
  color: null,
  position: 0,
  createdAt: new Date(0).toISOString(),
};
const ownerRole: Role = {
  ...everyone,
  id: 'owner-role',
  name: 'Owner',
  permissions: ALL_PERMISSIONS,
  position: 100,
};
const bearer = (userId: string) => ({ authorization: `Bearer ${userId}` });

function fixture() {
  const memberships = new Map([
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
      'moderator-1',
      {
        serverId: server.id,
        userId: 'moderator-1',
        permissions:
          Permission.VIEW_CHANNEL |
          Permission.MANAGE_ROLES |
          Permission.KICK_MEMBERS |
          Permission.BAN_MEMBERS |
          Permission.MANAGE_SERVER,
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
  const roles = [everyone, ownerRole];
  const audits: AuditLog[] = [];
  const bans = new Set<string>();
  const reports: Report[] = [];
  let auditSequence = 0;
  const audit = (action: string, actorId: string, targetId: string): AuditLog => {
    const entry: AuditLog = {
      id: `audit-${++auditSequence}`,
      serverId: server.id,
      actorId,
      action,
      targetType: 'USER',
      targetId,
      metadata: {},
      createdAt: new Date(auditSequence).toISOString(),
    };
    audits.unshift(entry);
    return entry;
  };
  const repo = {
    getMembership: async (serverId: string, userId: string) =>
      serverId === server.id ? (memberships.get(userId) ?? null) : null,
    listRoles: async () => roles,
    listRoleMemberIds: async () => [],
    createRole: async (input: { permissions: number }) => {
      if ((input.permissions & ~ALL_PERMISSIONS) !== 0)
        throw new RepositoryError('UNKNOWN_PERMISSIONS');
      return { ...everyone, id: 'created-role', name: 'Created', permissions: input.permissions };
    },
    updateRole: async (input: { roleId: string }) => {
      if (input.roleId === everyone.id || input.roleId === ownerRole.id)
        throw new RepositoryError('PROTECTED_ROLE');
      return roles[0];
    },
    deleteRole: async () => undefined,
    assignMemberRoles: async (input: { userId: string; roleIds: string[] }) => {
      if (input.userId === server.ownerId) throw new RepositoryError('OWNER_PROTECTED');
      return roles.filter((role) => input.roleIds.includes(role.id) || role.id === everyone.id);
    },
    moderateMember: async (input: { actorId: string; userId: string; action: 'KICK' | 'BAN' }) => {
      if (input.userId === server.ownerId || input.userId === input.actorId)
        throw new RepositoryError('OWNER_PROTECTED');
      if (!memberships.has(input.userId)) throw new RepositoryError('MEMBER_NOT_FOUND');
      if (input.action === 'BAN') bans.add(input.userId);
      memberships.delete(input.userId);
      return audit(input.action, input.actorId, input.userId);
    },
    listBans: async () => [],
    unbanMember: async (_serverId: string, userId: string, actorId: string) => {
      bans.delete(userId);
      audit('UNBAN', actorId, userId);
    },
    createReport: async (input: {
      reporterId: string;
      serverId?: string;
      messageId?: string;
      targetUserId?: string;
      reason: string;
    }) => {
      const report: Report = {
        id: `report-${reports.length + 1}`,
        reporterId: input.reporterId,
        serverId: input.serverId ?? server.id,
        messageId: input.messageId ?? null,
        targetUserId: input.targetUserId ?? null,
        reason: input.reason,
        status: 'OPEN',
        resolution: null,
        createdAt: new Date(0).toISOString(),
        resolvedAt: null,
      };
      reports.push(report);
      return report;
    },
    listReports: async () => ({ items: reports, nextCursor: null }),
    updateReport: async () => reports[0],
    listAudit: async (input: { limit: number }) => ({
      items: audits.slice(0, input.limit),
      nextCursor: audits.length > input.limit ? (audits[input.limit - 1]?.id ?? null) : null,
    }),
  } as unknown as Repository;
  const auth = { verifyAccessToken: async (token: string) => token } as never;
  return { repo, auth, memberships, roles, audits, bans, reports };
}

async function appFor(state = fixture()) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await registerServerRoutes(app, state.repo, state.auth);
  await registerModerationRoutes(app, state.repo, state.auth);
  return { app, ...state };
}

describe('roles and moderation contracts', () => {
  it('exposes owner all-permissions and rejects unknown permission bits', async () => {
    const { app, repo } = await appFor();
    expect((await repo.getMembership(server.id, server.ownerId))?.permissions).toBe(
      ALL_PERMISSIONS,
    );
    const response = await app.inject({
      method: 'POST',
      url: `/servers/${server.id}/roles`,
      headers: bearer('owner-1'),
      payload: { name: 'unsafe', permissions: ALL_PERMISSIONS | (1 << 20) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'UNKNOWN_PERMISSIONS' });
    await app.close();
  });

  it('protects @everyone, Owner, and owner member role assignments', async () => {
    const { app } = await appFor();
    const protectedRole = await app.inject({
      method: 'PATCH',
      url: `/servers/${server.id}/roles/${everyone.id}`,
      headers: bearer('owner-1'),
      payload: { name: 'renamed' },
    });
    const protectedOwner = await app.inject({
      method: 'PUT',
      url: `/servers/${server.id}/members/${server.ownerId}/roles`,
      headers: bearer('owner-1'),
      payload: { roleIds: [everyone.id] },
    });
    expect(protectedRole.statusCode).toBe(403);
    expect(protectedRole.json()).toMatchObject({ code: 'PROTECTED_ROLE' });
    expect(protectedOwner.statusCode).toBe(403);
    expect(protectedOwner.json()).toMatchObject({ code: 'OWNER_PROTECTED' });
    await app.close();
  });

  it.each(['KICK', 'BAN'] as const)(
    'mutates membership and records %s audit as one repository operation',
    async (action) => {
      const state = fixture();
      const { app } = await appFor(state);
      const response = await app.inject({
        method: 'POST',
        url: `/servers/${server.id}/moderation`,
        headers: bearer('moderator-1'),
        payload: { action, userId: 'member-1' },
      });
      expect(response.statusCode).toBe(200);
      expect(state.memberships.has('member-1')).toBe(false);
      expect(state.audits[0]).toMatchObject({ action, targetId: 'member-1', targetType: 'USER' });
      expect(state.bans.has('member-1')).toBe(action === 'BAN');
      await app.close();
    },
  );

  it('persists report messageId and returns typed audit pagination', async () => {
    const state = fixture();
    state.audits.push(
      {
        id: 'older-2',
        serverId: server.id,
        actorId: 'moderator-1',
        action: 'ROLE_UPDATE',
        targetType: 'ROLE',
        targetId: 'role-1',
        metadata: {},
        createdAt: new Date(2).toISOString(),
      },
      {
        id: 'older-1',
        serverId: server.id,
        actorId: 'moderator-1',
        action: 'ROLE_CREATE',
        targetType: 'ROLE',
        targetId: 'role-1',
        metadata: {},
        createdAt: new Date(1).toISOString(),
      },
    );
    const { app } = await appFor(state);
    const reportResponse = await app.inject({
      method: 'POST',
      url: '/reports',
      headers: bearer('member-1'),
      payload: { serverId: server.id, messageId: 'message-1', reason: 'abuse' },
    });
    expect(reportResponse.statusCode).toBe(200);
    expect(reportResponse.json()).toMatchObject({ messageId: 'message-1' });
    const auditResponse = await app.inject({
      method: 'GET',
      url: `/servers/${server.id}/audit?limit=1`,
      headers: bearer('moderator-1'),
    });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json()).toMatchObject({ nextCursor: 'older-2' });
    expect(auditResponse.json().items).toHaveLength(1);
    await app.close();
  });

  it('does not register obsolete split moderation routes', async () => {
    const { app } = await appFor();
    const response = await app.inject({
      method: 'POST',
      url: `/servers/${server.id}/kick`,
      headers: bearer('moderator-1'),
      payload: { userId: 'member-1' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
