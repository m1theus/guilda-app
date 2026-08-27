import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServerToClientEvents } from '@guilda/types';
import { authenticate, type AuthenticatedRequest, parse } from './auth.js';
import type { AuthService } from '../modules/auth.js';
import type { Repository } from '../repository.js';
import { userRoom } from '../realtime/server.js';

const idSchema = z.string().min(1).max(128);
const otherUserSchema = z.object({ otherUserId: idSchema });
const userParamsSchema = z.object({ userId: idSchema });
const requesterParamsSchema = z.object({ requesterId: idSchema });
const conversationParamsSchema = z.object({ id: idSchema });
const directMessageParamsSchema = z.object({ id: idSchema });
const friendRequestSchema = z.object({ addresseeId: idSchema });
const directMessageSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  clientNonce: z.string().min(1).max(128),
});
const directMessageEditSchema = z.object({ content: z.string().trim().min(1).max(4_000) });
const pageSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const currentUser = (request: FastifyRequest): string => (request as AuthenticatedRequest).userId;

const authOptions = (auth: AuthService) => ({
  preHandler: async (request: FastifyRequest) => authenticate(request, auth),
});

const emitToUsers = <Event extends keyof ServerToClientEvents>(
  app: FastifyInstance,
  userIds: readonly string[],
  event: Event,
  payload: Parameters<ServerToClientEvents[Event]>[0],
): void => {
  const realtime = app.realtime;
  if (!realtime) return;
  for (const userId of new Set(userIds)) realtime.io.to(userRoom(userId)).emit(event, payload);
};

const friendshipUsers = (friendship: {
  requesterId: string;
  addresseeId: string;
}): [string, string] => [friendship.requesterId, friendship.addresseeId];

export async function registerSocialRoutes(
  app: FastifyInstance,
  repo: Repository,
  auth: AuthService,
): Promise<void> {
  const authenticated = authOptions(auth);

  app.get('/friendships', authenticated, async (request) => ({
    items: await repo.listFriendships(currentUser(request)),
  }));

  app.post('/friend-requests', authenticated, async (request) => {
    const actorId = currentUser(request);
    const body = parse(friendRequestSchema, request.body);
    const friendship = await repo.createFriendRequest(actorId, body.addresseeId);
    emitToUsers(app, friendshipUsers(friendship), 'friend-request:create', { friendship });
    return friendship;
  });

  app.post('/friend-requests/:requesterId/accept', authenticated, async (request) => {
    const { requesterId } = parse(requesterParamsSchema, request.params);
    const friendship = await repo.acceptFriendRequest(requesterId, currentUser(request));
    emitToUsers(app, friendshipUsers(friendship), 'friendship:update', { friendship });
    return friendship;
  });

  app.delete('/friend-requests/:otherUserId', authenticated, async (request) => {
    const { otherUserId } = parse(otherUserSchema, request.params);
    const friendship = await repo.deleteFriendRequest(currentUser(request), otherUserId);
    emitToUsers(app, friendshipUsers(friendship), 'friendship:delete', {
      pairKey: friendship.pairKey,
      userIds: friendshipUsers(friendship),
    });
    return { ok: true };
  });

  app.delete('/friendships/:userId', authenticated, async (request) => {
    const { userId } = parse(userParamsSchema, request.params);
    const friendship = await repo.deleteFriendship(currentUser(request), userId);
    emitToUsers(app, friendshipUsers(friendship), 'friendship:delete', {
      pairKey: friendship.pairKey,
      userIds: friendshipUsers(friendship),
    });
    return { ok: true };
  });

  app.get('/blocks', authenticated, async (request) => ({
    items: await repo.listBlocks(currentUser(request)),
  }));

  app.put('/users/:userId/block', authenticated, async (request) => {
    const actorId = currentUser(request);
    const { userId } = parse(userParamsSchema, request.params);
    const result = await repo.blockUser(actorId, userId);
    emitToUsers(app, [actorId], 'user-block:update', { block: result.block });
    if (result.removedFriendship) {
      emitToUsers(app, friendshipUsers(result.removedFriendship), 'friendship:delete', {
        pairKey: result.removedFriendship.pairKey,
        userIds: friendshipUsers(result.removedFriendship),
      });
    }
    return result.block;
  });

  app.delete('/users/:userId/block', authenticated, async (request) => {
    const actorId = currentUser(request);
    const { userId } = parse(userParamsSchema, request.params);
    const block = await repo.unblockUser(actorId, userId);
    emitToUsers(app, [actorId], 'user-block:delete', {
      blockerId: block.blockerId,
      blockedId: block.blockedId,
    });
    return { ok: true };
  });

  app.get('/direct-conversations', authenticated, async (request) => ({
    items: await repo.listDirectConversations(currentUser(request)),
  }));

  app.post('/direct-conversations', authenticated, async (request) => {
    const actorId = currentUser(request);
    const { otherUserId } = parse(otherUserSchema, request.body);
    const result = await repo.createDirectConversation(actorId, otherUserId);
    if (result.created) {
      emitToUsers(
        app,
        result.conversation.members.map((member) => member.id),
        'direct-conversation:create',
        { conversation: result.conversation },
      );
    }
    return result.conversation;
  });

  app.get('/direct-conversations/:id/messages', authenticated, async (request) => {
    const { id } = parse(conversationParamsSchema, request.params);
    const query = parse(pageSchema, request.query);
    return repo.listDirectMessages({
      conversationId: id,
      userId: currentUser(request),
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  });

  app.post('/direct-conversations/:id/messages', authenticated, async (request) => {
    const actorId = currentUser(request);
    const { id } = parse(conversationParamsSchema, request.params);
    const body = parse(directMessageSchema, request.body);
    const result = await repo.createDirectMessage({
      conversationId: id,
      authorId: actorId,
      content: body.content,
      clientNonce: body.clientNonce,
    });
    if (result.created) {
      const conversation = await repo.getDirectConversation(id, actorId);
      emitToUsers(
        app,
        conversation.members.map((member) => member.id),
        'direct-message:create',
        { message: result.message, clientNonce: result.message.clientNonce },
      );
    }
    return result.message;
  });

  app.patch('/direct-messages/:id', authenticated, async (request) => {
    const actorId = currentUser(request);
    const { id } = parse(directMessageParamsSchema, request.params);
    const body = parse(directMessageEditSchema, request.body);
    const message = await repo.updateDirectMessage(id, actorId, body.content);
    const conversation = await repo.getDirectConversation(message.conversationId, actorId);
    emitToUsers(
      app,
      conversation.members.map((member) => member.id),
      'direct-message:update',
      { message },
    );
    return message;
  });

  app.delete('/direct-messages/:id', authenticated, async (request) => {
    const actorId = currentUser(request);
    const { id } = parse(directMessageParamsSchema, request.params);
    const message = await repo.deleteDirectMessage(id, actorId);
    if (!message.deletedAt) throw new Error('deleted direct message missing deletion timestamp');
    const conversation = await repo.getDirectConversation(message.conversationId, actorId);
    emitToUsers(
      app,
      conversation.members.map((member) => member.id),
      'direct-message:delete',
      {
        messageId: message.id,
        conversationId: message.conversationId,
        deletedAt: message.deletedAt,
      },
    );
    return { ok: true };
  });
}
