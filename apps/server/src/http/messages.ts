import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Permission } from '@guilda/types';
import { authenticate, type AuthenticatedRequest, parse } from './auth.js';
import { forbidden, notFound } from './errors.js';
import { requireServerPermission } from '../modules/permissions.js';
import type { Repository } from '../repository.js';
import type { AuthService } from '../modules/auth.js';

const messageSchema = z
  .object({
    content: z.string().trim().max(4000).default(''),
    replyToId: z.string().optional(),
    attachmentIds: z.array(z.string().min(1)).max(10).default([]),
    clientNonce: z.string().min(1).max(100),
  })
  .refine((body) => body.content.length > 0 || body.attachmentIds.length > 0, {
    message: 'A message needs content or an attachment',
  });
const editSchema = z.object({ content: z.string().trim().min(1).max(4000) });
const channelParams = z.object({ channelId: z.string().min(1) });
const serverParams = z.object({ serverId: z.string().min(1) });
const searchQuery = z.object({
  query: z.string().trim().min(2).max(100),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});
function currentUser(request: FastifyRequest): string {
  return (request as AuthenticatedRequest).userId;
}
async function channelContext(repo: Repository, request: FastifyRequest, userId: string) {
  const { channelId } = parse(channelParams, request.params);
  const channel = await repo.getChannel(channelId);
  if (!channel) throw notFound('Channel not found');
  const member = await requireServerPermission(
    repo,
    channel.serverId,
    userId,
    Permission.VIEW_CHANNEL,
  );
  return { channel, member };
}
const authOptions = (auth: AuthService) => ({
  preHandler: async (request: FastifyRequest) => authenticate(request, auth),
});

export async function registerMessageRoutes(
  app: FastifyInstance,
  repo: Repository,
  auth: AuthService,
): Promise<void> {
  app.get('/channels/:channelId/messages', authOptions(auth), async (request) => {
    const { channel } = await channelContext(repo, request, currentUser(request));
    const query = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    const input = query.cursor
      ? { channelId: channel.id, cursor: query.cursor, limit: query.limit }
      : { channelId: channel.id, limit: query.limit };
    return repo.listMessages(input);
  });
  app.get('/servers/:serverId/messages/search', authOptions(auth), async (request) => {
    const { serverId } = parse(serverParams, request.params);
    await requireServerPermission(repo, serverId, currentUser(request), Permission.VIEW_CHANNEL);
    const input = parse(searchQuery, request.query);
    const searchInput = input.cursor
      ? {
          serverId,
          query: input.query,
          cursor: input.cursor,
          limit: input.limit,
        }
      : { serverId, query: input.query, limit: input.limit };
    return repo.searchMessages(searchInput);
  });
  app.post('/channels/:channelId/messages', authOptions(auth), async (request) => {
    const { channel } = await channelContext(repo, request, currentUser(request));
    const member = await requireServerPermission(
      repo,
      channel.serverId,
      currentUser(request),
      Permission.SEND_MESSAGES,
    );
    const body = parse(messageSchema, request.body);
    const message = await repo.createMessage({
      channelId: channel.id,
      authorId: member.userId,
      content: body.content,
      replyToId: body.replyToId ?? null,
      attachmentIds: body.attachmentIds ?? [],
      clientNonce: body.clientNonce,
    });
    app.realtime?.emitMessageCreated(message, body.clientNonce, channel);
    return message;
  });
  app.patch('/messages/:messageId', authOptions(auth), async (request) => {
    const message = await repo.getMessage(
      z.object({ messageId: z.string() }).parse(request.params).messageId,
    );
    if (!message) throw notFound('Message not found');
    const channel = await repo.getChannel(message.channelId);
    if (!channel) throw notFound('Channel not found');
    const member = await requireServerPermission(
      repo,
      channel.serverId,
      currentUser(request),
      Permission.VIEW_CHANNEL,
    );
    if (
      message.authorId !== member.userId &&
      (member.permissions & Permission.MANAGE_MESSAGES) !== Permission.MANAGE_MESSAGES
    )
      throw forbidden();
    const updated = await repo.updateMessage(message.id, parse(editSchema, request.body).content);
    app.realtime?.emitMessageUpdated(updated);
    return updated;
  });
  app.delete('/messages/:messageId', authOptions(auth), async (request) => {
    const message = await repo.getMessage(
      z.object({ messageId: z.string() }).parse(request.params).messageId,
    );
    if (!message) throw notFound('Message not found');
    const channel = await repo.getChannel(message.channelId);
    if (!channel) throw notFound('Channel not found');
    const member = await requireServerPermission(
      repo,
      channel.serverId,
      currentUser(request),
      Permission.VIEW_CHANNEL,
    );
    if (
      message.authorId !== member.userId &&
      (member.permissions & Permission.MANAGE_MESSAGES) === 0
    )
      throw forbidden();
    await repo.deleteMessage(message.id);
    const deletedAt = new Date().toISOString();
    app.realtime?.emitMessageDeleted(message.id, message.channelId, deletedAt);
    return { ok: true };
  });
}
