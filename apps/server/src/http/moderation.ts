import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  Permission,
  type CreateReportRequest,
  type ModerateMemberRequest,
  type UpdateReportRequest,
} from '@guilda/types';
import { authenticate, type AuthenticatedRequest, parse } from './auth.js';
import { HttpError } from './errors.js';
import { requireServerPermission } from '../modules/permissions.js';
import { RepositoryError, type Repository } from '../repository.js';
import type { AuthService } from '../modules/auth.js';

const serverParamsSchema = z.object({ serverId: z.string().min(1) });
const userParamsSchema = serverParamsSchema.extend({ userId: z.string().min(1) });
const moderationSchema = z.object({
  action: z.enum(['KICK', 'BAN']),
  userId: z.string().min(1),
  reason: z.string().trim().min(1).max(500).optional(),
});
const reportSchema = z
  .object({
    serverId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    targetUserId: z.string().min(1).optional(),
    reason: z.string().trim().min(1).max(2_000),
  })
  .refine((body) => body.messageId !== undefined || body.targetUserId !== undefined, {
    message: 'A messageId or targetUserId is required',
  })
  .refine((body) => body.messageId !== undefined || body.serverId !== undefined, {
    message: 'A serverId is required when reporting a user',
    path: ['serverId'],
  });
const updateReportSchema = z.object({
  reportId: z.string().min(1),
  status: z.enum(['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED']),
  resolution: z.string().trim().min(1).max(2_000).optional(),
});
const pageSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function actor(request: FastifyRequest): string {
  return (request as AuthenticatedRequest).userId;
}
function translateRepositoryError(error: unknown): never {
  if (!(error instanceof RepositoryError)) throw error;
  switch (error.code) {
    case 'MEMBER_NOT_FOUND':
    case 'REPORT_NOT_FOUND':
    case 'BAN_NOT_FOUND':
      throw new HttpError(404, error.code, 'Member or report not found');
    case 'OWNER_PROTECTED':
    case 'ROLE_HIERARCHY':
    case 'SELF_MODERATION':
    case 'PROTECTED_ROLE':
      throw new HttpError(403, error.code, 'The protected role hierarchy forbids this action');
    default:
      throw error;
  }
}
const authOptions = (auth: AuthService) => ({
  preHandler: async (request: FastifyRequest) => authenticate(request, auth),
});

export async function registerModerationRoutes(
  app: FastifyInstance,
  repo: Repository,
  auth: AuthService,
): Promise<void> {
  app.post('/servers/:serverId/moderation', authOptions(auth), async (request) => {
    const { serverId } = parse(serverParamsSchema, request.params);
    const actorId = actor(request);
    const body = parse(moderationSchema, request.body) as ModerateMemberRequest;
    const required = body.action === 'BAN' ? Permission.BAN_MEMBERS : Permission.KICK_MEMBERS;
    await requireServerPermission(repo, serverId, actorId, required);
    try {
      const audit = await repo.moderateMember({
        serverId,
        actorId,
        userId: body.userId,
        action: body.action,
        ...(body.reason ? { reason: body.reason } : {}),
      });
      await app.realtime?.refreshMemberAuthorization(serverId, body.userId);
      return audit;
    } catch (error) {
      translateRepositoryError(error);
    }
  });
  app.get('/servers/:serverId/bans', authOptions(auth), async (request) => {
    const { serverId } = parse(serverParamsSchema, request.params);
    await requireServerPermission(repo, serverId, actor(request), Permission.BAN_MEMBERS);
    return { items: await repo.listBans(serverId) };
  });
  app.delete('/servers/:serverId/bans/:userId', authOptions(auth), async (request, reply) => {
    const { serverId, userId } = parse(userParamsSchema, request.params);
    const actorId = actor(request);
    await requireServerPermission(repo, serverId, actorId, Permission.BAN_MEMBERS);
    try {
      await repo.unbanMember(serverId, userId, actorId);
      return reply.status(204).send();
    } catch (error) {
      translateRepositoryError(error);
    }
  });
  app.post('/reports', authOptions(auth), async (request) => {
    const reporterId = actor(request);
    const body = parse(reportSchema, request.body) as CreateReportRequest;
    try {
      return await repo.createReport({ reporterId, ...body });
    } catch (error) {
      translateRepositoryError(error);
    }
  });
  app.get('/servers/:serverId/reports', authOptions(auth), async (request) => {
    const { serverId } = parse(serverParamsSchema, request.params);
    await requireServerPermission(repo, serverId, actor(request), Permission.MANAGE_SERVER);
    const query = parse(pageSchema, request.query);
    return repo.listReports({
      serverId,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  });
  app.patch('/servers/:serverId/reports', authOptions(auth), async (request) => {
    const { serverId } = parse(serverParamsSchema, request.params);
    const actorId = actor(request);
    await requireServerPermission(repo, serverId, actorId, Permission.MANAGE_SERVER);
    const body = parse(updateReportSchema, request.body) as UpdateReportRequest;
    try {
      return await repo.updateReport({ serverId, actorId, ...body });
    } catch (error) {
      translateRepositoryError(error);
    }
  });
  app.get('/servers/:serverId/audit', authOptions(auth), async (request) => {
    const { serverId } = parse(serverParamsSchema, request.params);
    await requireServerPermission(repo, serverId, actor(request), Permission.MANAGE_SERVER);
    const query = parse(pageSchema, request.query);
    return repo.listAudit({
      serverId,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  });
}
