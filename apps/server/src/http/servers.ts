import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  AssignMemberRolesRequest,
  CreateChannelRequest,
  CreateInviteRequest,
  CreateRoleRequest,
  CreateServerRequest,
  UpdateRoleRequest,
} from '@guilda/types';
import { Permission } from '@guilda/types';
import { authenticate, type AuthenticatedRequest, parse } from './auth.js';
import { requireServerPermission } from '../modules/permissions.js';
import { RepositoryError, type Repository } from '../repository.js';
import { HttpError } from './errors.js';
import type { AuthService } from '../modules/auth.js';

const serverSchema = z.object({ name: z.string().trim().min(1).max(100) });
const channelSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(['TEXT', 'VOICE']),
});
const inviteSchema = z.object({
  expiresAt: z.string().datetime().optional(),
  maxUses: z.number().int().positive().max(100_000).optional(),
});
const roleSchema = z.object({
  name: z.string().trim().min(1).max(64),
  permissions: z.number().int().nonnegative(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  position: z.number().int().nonnegative().optional(),
});
const updateRoleSchema = roleSchema.partial().refine((body) => Object.keys(body).length > 0, {
  message: 'At least one role field is required',
});
const roleParams = z.object({
  serverId: z.string().min(1),
  roleId: z.string().min(1),
});
const memberRoleParams = z.object({
  serverId: z.string().min(1),
  userId: z.string().min(1),
});
const memberRolesSchema = z.object({
  roleIds: z.array(z.string().min(1)).max(100),
});
const idParams = z.object({ serverId: z.string().min(1) });
function userId(request: FastifyRequest): string {
  return (request as AuthenticatedRequest).userId;
}
function params(request: FastifyRequest): { serverId: string } {
  return parse(idParams, request.params);
}
function translateRepositoryError(error: unknown): never {
  if (!(error instanceof RepositoryError)) throw error;
  switch (error.code) {
    case 'INVITE_NOT_FOUND':
      throw new HttpError(404, error.code, 'Invite not found');
    case 'INVITE_EXPIRED':
      throw new HttpError(410, error.code, 'Invite has expired');
    case 'INVITE_EXHAUSTED':
      throw new HttpError(409, error.code, 'Invite has reached its maximum uses');
    case 'USER_BANNED':
      throw new HttpError(403, error.code, 'Banned users cannot accept invites');
    case 'UNKNOWN_PERMISSIONS':
      throw new HttpError(400, error.code, 'Permission bitfield contains unknown bits');
    case 'ROLE_NOT_FOUND':
    case 'MEMBER_NOT_FOUND':
      throw new HttpError(404, error.code, 'Role or member not found');
    case 'PROTECTED_ROLE':
    case 'OWNER_PROTECTED':
    case 'ROLE_HIERARCHY':
      throw new HttpError(403, error.code, 'The protected role hierarchy forbids this action');
    default:
      throw error;
  }
}

export async function registerServerRoutes(
  app: FastifyInstance,
  repo: Repository,
  auth: AuthService,
): Promise<void> {
  const authGuard = async (request: FastifyRequest) => authenticate(request, auth);
  app.get('/servers', { preHandler: authGuard }, async (request) => ({
    items: await repo.listServersForUser(userId(request)),
  }));
  app.post('/servers', { preHandler: authGuard }, async (request) =>
    repo.createServer({
      ...(parse(serverSchema, request.body) as CreateServerRequest),
      ownerId: userId(request),
    }),
  );
  app.get('/servers/:serverId', { preHandler: authGuard }, async (request) => {
    const { serverId } = params(request);
    await requireServerPermission(repo, serverId, userId(request), Permission.VIEW_CHANNEL);
    return repo.getSnapshot(serverId, userId(request));
  });
  app.get('/servers/:serverId/snapshot', { preHandler: authGuard }, async (request) => {
    const { serverId } = params(request);
    await requireServerPermission(repo, serverId, userId(request), Permission.VIEW_CHANNEL);
    return repo.getSnapshot(serverId, userId(request));
  });
  app.post('/servers/:serverId/channels', { preHandler: authGuard }, async (request) => {
    const { serverId } = params(request);
    await requireServerPermission(repo, serverId, userId(request), Permission.MANAGE_CHANNELS);
    return repo.createChannel({
      serverId,
      ...(parse(channelSchema, request.body) as CreateChannelRequest),
    });
  });
  app.post('/servers/:serverId/invites', { preHandler: authGuard }, async (request) => {
    const { serverId } = params(request);
    await requireServerPermission(repo, serverId, userId(request), Permission.MANAGE_SERVER);
    const body = parse(inviteSchema, request.body ?? {}) as CreateInviteRequest;
    const invite = await repo.createInvite({
      serverId,
      createdById: userId(request),
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      maxUses: body.maxUses ?? null,
    });
    return { invite, deepLink: `https://noxera.online/invite/${invite.code}` };
  });
  app.get('/servers/:serverId/roles', { preHandler: authGuard }, async (request) => {
    const { serverId } = params(request);
    await requireServerPermission(repo, serverId, userId(request), Permission.VIEW_CHANNEL);
    return { items: await repo.listRoles(serverId) };
  });
  app.post('/servers/:serverId/roles', { preHandler: authGuard }, async (request) => {
    const { serverId } = params(request);
    const actorId = userId(request);
    await requireServerPermission(repo, serverId, actorId, Permission.MANAGE_ROLES);
    const body = parse(roleSchema, request.body) as CreateRoleRequest;
    try {
      return await repo.createRole({
        serverId,
        actorId,
        name: body.name,
        permissions: body.permissions,
        color: body.color ?? null,
        ...(body.position !== undefined ? { position: body.position } : {}),
      });
    } catch (error) {
      translateRepositoryError(error);
    }
  });
  app.patch('/servers/:serverId/roles/:roleId', { preHandler: authGuard }, async (request) => {
    const { serverId, roleId } = parse(roleParams, request.params);
    const actorId = userId(request);
    await requireServerPermission(repo, serverId, actorId, Permission.MANAGE_ROLES);
    const body = parse(updateRoleSchema, request.body) as UpdateRoleRequest;
    try {
      const affectedUserIds = await repo.listRoleMemberIds(serverId, roleId);
      const role = await repo.updateRole({ serverId, roleId, actorId, ...body });
      await Promise.all(
        affectedUserIds.map((memberId) =>
          app.realtime?.refreshMemberAuthorization(serverId, memberId),
        ),
      );
      return role;
    } catch (error) {
      translateRepositoryError(error);
    }
  });
  app.delete(
    '/servers/:serverId/roles/:roleId',
    { preHandler: authGuard },
    async (request, reply) => {
      const { serverId, roleId } = parse(roleParams, request.params);
      const actorId = userId(request);
      await requireServerPermission(repo, serverId, actorId, Permission.MANAGE_ROLES);
      try {
        const affectedUserIds = await repo.listRoleMemberIds(serverId, roleId);
        await repo.deleteRole(serverId, roleId, actorId);
        await Promise.all(
          affectedUserIds.map((memberId) =>
            app.realtime?.refreshMemberAuthorization(serverId, memberId),
          ),
        );
        return reply.status(204).send();
      } catch (error) {
        translateRepositoryError(error);
      }
    },
  );
  app.get(
    '/servers/:serverId/members/:userId/roles',
    { preHandler: authGuard },
    async (request) => {
      const { serverId, userId: memberId } = parse(memberRoleParams, request.params);
      const actorId = userId(request);
      await requireServerPermission(repo, serverId, actorId, Permission.MANAGE_ROLES);
      try {
        return { items: await repo.listMemberRoles(serverId, memberId) };
      } catch (error) {
        translateRepositoryError(error);
      }
    },
  );
  app.put(
    '/servers/:serverId/members/:userId/roles',
    { preHandler: authGuard },
    async (request) => {
      const { serverId, userId: memberId } = parse(memberRoleParams, request.params);
      const actorId = userId(request);
      await requireServerPermission(repo, serverId, actorId, Permission.MANAGE_ROLES);
      const body = parse(memberRolesSchema, request.body) as AssignMemberRolesRequest;
      try {
        const roles = await repo.assignMemberRoles({
          serverId,
          userId: memberId,
          actorId,
          roleIds: body.roleIds,
        });
        await app.realtime?.refreshMemberAuthorization(serverId, memberId);
        return { items: roles };
      } catch (error) {
        translateRepositoryError(error);
      }
    },
  );
  app.post('/invites/:code/accept', { preHandler: authGuard }, async (request) => {
    const code = z.object({ code: z.string().min(4).max(100) }).parse(request.params).code;
    try {
      const currentUserId = userId(request);
      const server = await repo.acceptInvite(code, currentUserId);
      await app.realtime?.refreshMemberAuthorization(server.id, currentUserId);
      return { server };
    } catch (error) {
      translateRepositoryError(error);
    }
  });
}
