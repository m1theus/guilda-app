import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import type {
  DirectConversation,
  DirectMessage,
  Friendship,
  PersonalBlock,
  User,
} from '@guilda/types';
import { errorHandler } from '../src/http/errors.js';
import { registerSocialRoutes } from '../src/http/social.js';
import { canonicalPairKey, RepositoryError, type Repository } from '../src/repository.js';

const now = new Date(0).toISOString();
const user = (id: string): User => ({
  id,
  username: id,
  displayName: id.toUpperCase(),
  email: `${id}@example.test`,
  avatarUrl: null,
  pronouns: null,
  bio: null,
  bannerUrl: null,
  profileColor: null,
  status: 'OFFLINE',
  createdAt: now,
  updatedAt: now,
});
const users = new Map(['a', 'b', 'c'].map((id) => [id, user(id)]));

function socialFixture() {
  const friendships = new Map<string, Friendship>();
  const blocks = new Map<string, PersonalBlock>();
  const conversations = new Map<string, DirectConversation>();
  const messages = new Map<string, DirectMessage>();
  const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
  let messageSequence = 0;

  const blocked = (first: string, second: string) =>
    blocks.has(`${first}:${second}`) || blocks.has(`${second}:${first}`);
  const requireUser = (id: string): User => {
    const found = users.get(id);
    if (!found) throw new RepositoryError('USER_NOT_FOUND');
    return found;
  };
  const requireConversation = (id: string, actorId: string): DirectConversation => {
    const conversation = [...conversations.values()].find((item) => item.id === id);
    if (!conversation || !conversation.members.some((member) => member.id === actorId))
      throw new RepositoryError('CONVERSATION_NOT_FOUND');
    return conversation;
  };

  const repo = {
    listFriendships: async (userId: string) =>
      [...friendships.values()].filter(
        (item) => item.requesterId === userId || item.addresseeId === userId,
      ),
    createFriendRequest: async (requesterId: string, addresseeId: string) => {
      const pairKey = canonicalPairKey(requesterId, addresseeId);
      const addressee = requireUser(addresseeId);
      if (blocked(requesterId, addresseeId)) throw new RepositoryError('RELATION_BLOCKED');
      if (friendships.has(pairKey)) throw new RepositoryError('FRIEND_REQUEST_EXISTS');
      const friendship: Friendship = {
        pairKey,
        requesterId,
        addresseeId,
        status: 'PENDING',
        requestedAt: now,
        respondedAt: null,
        requester: requireUser(requesterId),
        addressee,
      };
      friendships.set(pairKey, friendship);
      return friendship;
    },
    acceptFriendRequest: async (requesterId: string, addresseeId: string) => {
      const pairKey = canonicalPairKey(requesterId, addresseeId);
      const friendship = friendships.get(pairKey);
      if (!friendship || friendship.status !== 'PENDING')
        throw new RepositoryError('FRIEND_REQUEST_NOT_FOUND');
      if (friendship.requesterId !== requesterId || friendship.addresseeId !== addresseeId)
        throw new RepositoryError('FORBIDDEN');
      if (blocked(requesterId, addresseeId)) throw new RepositoryError('RELATION_BLOCKED');
      const accepted = { ...friendship, status: 'ACCEPTED' as const, respondedAt: now };
      friendships.set(pairKey, accepted);
      return accepted;
    },
    deleteFriendRequest: async (actorId: string, otherUserId: string) => {
      const pairKey = canonicalPairKey(actorId, otherUserId);
      const friendship = friendships.get(pairKey);
      if (!friendship || friendship.status !== 'PENDING')
        throw new RepositoryError('FRIEND_REQUEST_NOT_FOUND');
      friendships.delete(pairKey);
      return friendship;
    },
    deleteFriendship: async (actorId: string, otherUserId: string) => {
      const pairKey = canonicalPairKey(actorId, otherUserId);
      const friendship = friendships.get(pairKey);
      if (!friendship || friendship.status !== 'ACCEPTED')
        throw new RepositoryError('FRIENDSHIP_NOT_FOUND');
      friendships.delete(pairKey);
      return friendship;
    },
    listBlocks: async (actorId: string) =>
      [...blocks.values()].filter((block) => block.blockerId === actorId),
    blockUser: async (blockerId: string, blockedId: string) => {
      const pairKey = canonicalPairKey(blockerId, blockedId);
      const removedFriendship = friendships.get(pairKey) ?? null;
      const block: PersonalBlock = {
        blockerId,
        blockedId,
        createdAt: now,
        blocked: requireUser(blockedId),
      };
      blocks.set(`${blockerId}:${blockedId}`, block);
      friendships.delete(pairKey);
      return { block, removedFriendship };
    },
    unblockUser: async (blockerId: string, blockedId: string) => {
      const block = blocks.get(`${blockerId}:${blockedId}`);
      if (!block) throw new RepositoryError('BLOCK_NOT_FOUND');
      blocks.delete(`${blockerId}:${blockedId}`);
      return block;
    },
    listDirectConversations: async (actorId: string) =>
      [...conversations.values()].filter((conversation) =>
        conversation.members.some((member) => member.id === actorId),
      ),
    getDirectConversation: async (conversationId: string, actorId: string) =>
      requireConversation(conversationId, actorId),
    createDirectConversation: async (creatorId: string, otherUserId: string) => {
      const pairKey = canonicalPairKey(creatorId, otherUserId);
      if (blocked(creatorId, otherUserId)) throw new RepositoryError('RELATION_BLOCKED');
      if (friendships.get(pairKey)?.status !== 'ACCEPTED')
        throw new RepositoryError('FRIENDSHIP_REQUIRED');
      const existing = conversations.get(pairKey);
      if (existing) return { conversation: existing, created: false };
      const conversation: DirectConversation = {
        id: `conversation-${conversations.size + 1}`,
        pairKey,
        createdById: creatorId,
        createdAt: now,
        updatedAt: now,
        members: [requireUser(creatorId), requireUser(otherUserId)],
      };
      conversations.set(pairKey, conversation);
      return { conversation, created: true };
    },
    listDirectMessages: async (input: {
      conversationId: string;
      userId: string;
      cursor?: string;
      limit: number;
    }) => {
      requireConversation(input.conversationId, input.userId);
      const ordered = [...messages.values()]
        .filter((message) => message.conversationId === input.conversationId)
        .sort((left, right) =>
          left.createdAt === right.createdAt
            ? right.id.localeCompare(left.id)
            : right.createdAt.localeCompare(left.createdAt),
        );
      const start = input.cursor
        ? ordered.findIndex((message) => message.id === input.cursor) + 1
        : 0;
      if (input.cursor && start === 0) throw new RepositoryError('DIRECT_MESSAGE_NOT_FOUND');
      const page = ordered.slice(start, start + input.limit + 1);
      const items = page.slice(0, input.limit);
      return {
        items,
        nextCursor: page.length > input.limit ? (items.at(-1)?.id ?? null) : null,
      };
    },
    createDirectMessage: async (input: {
      conversationId: string;
      authorId: string;
      content: string;
      clientNonce: string;
    }) => {
      const conversation = requireConversation(input.conversationId, input.authorId);
      const recipient = conversation.members.find((member) => member.id !== input.authorId)!;
      if (blocked(input.authorId, recipient.id)) throw new RepositoryError('RELATION_BLOCKED');
      const existing = [...messages.values()].find(
        (message) =>
          message.conversationId === input.conversationId &&
          message.authorId === input.authorId &&
          message.clientNonce === input.clientNonce,
      );
      if (existing) return { message: existing, created: false };
      messageSequence += 1;
      const message: DirectMessage = {
        id: `dm-${String(messageSequence).padStart(2, '0')}`,
        conversationId: input.conversationId,
        authorId: input.authorId,
        content: input.content,
        clientNonce: input.clientNonce,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        author: requireUser(input.authorId),
      };
      messages.set(message.id, message);
      return { message, created: true };
    },
    updateDirectMessage: async (messageId: string, actorId: string, content: string) => {
      const message = messages.get(messageId);
      if (!message) throw new RepositoryError('DIRECT_MESSAGE_NOT_FOUND');
      requireConversation(message.conversationId, actorId);
      if (message.authorId !== actorId) throw new RepositoryError('FORBIDDEN');
      const updated = { ...message, content };
      messages.set(messageId, updated);
      return updated;
    },
    deleteDirectMessage: async (messageId: string, actorId: string) => {
      const message = messages.get(messageId);
      if (!message) throw new RepositoryError('DIRECT_MESSAGE_NOT_FOUND');
      requireConversation(message.conversationId, actorId);
      if (message.authorId !== actorId) throw new RepositoryError('FORBIDDEN');
      const deleted = { ...message, content: '', deletedAt: new Date(1).toISOString() };
      messages.set(messageId, deleted);
      return deleted;
    },
  } as unknown as Repository;

  const auth = {
    verifyAccessToken: async (token: string) => {
      if (!users.has(token)) throw new Error('invalid token');
      return token;
    },
  } as never;

  return { repo, auth, friendships, blocks, conversations, messages, emitted };
}

async function appFor(state = socialFixture()) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  app.decorate('realtime', {
    io: {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => state.emitted.push({ room, event, payload }),
      }),
    },
  } as never);
  await registerSocialRoutes(app, state.repo, state.auth);
  return { app, ...state };
}

const bearer = (id: string) => ({ authorization: `Bearer ${id}` });

async function acceptedFriendship(app: FastifyInstance) {
  await app.inject({
    method: 'POST',
    url: '/friend-requests',
    headers: bearer('a'),
    payload: { addresseeId: 'b' },
  });
  await app.inject({
    method: 'POST',
    url: '/friend-requests/a/accept',
    headers: bearer('b'),
  });
}

async function directConversation(app: FastifyInstance): Promise<string> {
  await acceptedFriendship(app);
  const response = await app.inject({
    method: 'POST',
    url: '/direct-conversations',
    headers: bearer('a'),
    payload: { otherUserId: 'b' },
  });
  return response.json().id as string;
}

describe('personal social contracts', () => {
  it('canonicalizes inverse pairs and admits only one concurrent inverse request', async () => {
    expect(canonicalPairKey('a', 'b')).toBe(canonicalPairKey('b', 'a'));
    expect(() => canonicalPairKey('a', 'a')).toThrowError('SELF_RELATION');
    const { app, friendships } = await appFor();
    const [forward, inverse] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/friend-requests',
        headers: bearer('a'),
        payload: { addresseeId: 'b' },
      }),
      app.inject({
        method: 'POST',
        url: '/friend-requests',
        headers: bearer('b'),
        payload: { addresseeId: 'a' },
      }),
    ]);
    expect([forward.statusCode, inverse.statusCode].sort()).toEqual([200, 409]);
    expect(friendships.size).toBe(1);
    await app.close();
  });

  it('only lets the persisted addressee accept a request', async () => {
    const { app } = await appFor();
    await app.inject({
      method: 'POST',
      url: '/friend-requests',
      headers: bearer('a'),
      payload: { addresseeId: 'b' },
    });
    const unauthorized = await app.inject({
      method: 'POST',
      url: '/friend-requests/b/accept',
      headers: bearer('a'),
    });
    const accepted = await app.inject({
      method: 'POST',
      url: '/friend-requests/a/accept',
      headers: bearer('b'),
    });
    expect(unauthorized.statusCode).toBe(403);
    expect(accepted.json()).toMatchObject({ status: 'ACCEPTED' });
    await app.close();
  });

  it('blocking removes the relationship and denies friend operations in both directions', async () => {
    const { app, friendships } = await appFor();
    await acceptedFriendship(app);
    const blocked = await app.inject({
      method: 'PUT',
      url: '/users/b/block',
      headers: bearer('a'),
    });
    const inverseRequest = await app.inject({
      method: 'POST',
      url: '/friend-requests',
      headers: bearer('b'),
      payload: { addresseeId: 'a' },
    });
    expect(blocked.statusCode).toBe(200);
    expect(friendships.size).toBe(0);
    expect(inverseRequest.statusCode).toBe(403);
    expect(inverseRequest.json()).toMatchObject({ code: 'RELATION_BLOCKED' });
    await app.close();
  });

  it('requires friendship, canonicalizes inverse conversation creation, and is idempotent', async () => {
    const { app } = await appFor();
    const denied = await app.inject({
      method: 'POST',
      url: '/direct-conversations',
      headers: bearer('a'),
      payload: { otherUserId: 'b' },
    });
    await acceptedFriendship(app);
    const first = await app.inject({
      method: 'POST',
      url: '/direct-conversations',
      headers: bearer('a'),
      payload: { otherUserId: 'b' },
    });
    const inverse = await app.inject({
      method: 'POST',
      url: '/direct-conversations',
      headers: bearer('b'),
      payload: { otherUserId: 'a' },
    });
    expect(denied.statusCode).toBe(409);
    expect(inverse.json().id).toBe(first.json().id);
    expect(inverse.json().pairKey).toBe(canonicalPairKey('a', 'b'));
    await app.close();
  });

  it('denies conversation messages to outsiders and rejects sends after either user blocks', async () => {
    const { app } = await appFor();
    const conversationId = await directConversation(app);
    const outsider = await app.inject({
      method: 'GET',
      url: `/direct-conversations/${conversationId}/messages`,
      headers: bearer('c'),
    });
    await app.inject({ method: 'PUT', url: '/users/a/block', headers: bearer('b') });
    const blockedSend = await app.inject({
      method: 'POST',
      url: `/direct-conversations/${conversationId}/messages`,
      headers: bearer('a'),
      payload: { content: 'denied', clientNonce: 'blocked' },
    });
    expect(outsider.statusCode).toBe(404);
    expect(blockedSend.statusCode).toBe(403);
    await app.close();
  });

  it('makes nonces idempotent and delivers a created event to the persisted recipient room', async () => {
    const { app, emitted } = await appFor();
    const conversationId = await directConversation(app);
    const request = {
      method: 'POST' as const,
      url: `/direct-conversations/${conversationId}/messages`,
      headers: bearer('a'),
      payload: { content: 'hello', clientNonce: 'nonce-1' },
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);
    const deliveries = emitted.filter(
      (event) => event.event === 'direct-message:create' && event.room === 'user:b',
    );
    expect(replay.json().id).toBe(first.json().id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.payload).toMatchObject({ clientNonce: 'nonce-1' });
    await app.close();
  });

  it('paginates strict newest-first cursor boundaries even when timestamps match', async () => {
    const { app } = await appFor();
    const conversationId = await directConversation(app);
    for (const nonce of ['one', 'two', 'three']) {
      await app.inject({
        method: 'POST',
        url: `/direct-conversations/${conversationId}/messages`,
        headers: bearer('a'),
        payload: { content: nonce, clientNonce: nonce },
      });
    }
    const first = await app.inject({
      method: 'GET',
      url: `/direct-conversations/${conversationId}/messages?limit=2`,
      headers: bearer('a'),
    });
    const firstPage = first.json();
    const second = await app.inject({
      method: 'GET',
      url: `/direct-conversations/${conversationId}/messages?limit=2&cursor=${firstPage.nextCursor}`,
      headers: bearer('a'),
    });
    const ids = [...firstPage.items, ...second.json().items].map((message) => message.id);
    expect(ids).toEqual(['dm-03', 'dm-02', 'dm-01']);
    expect(new Set(ids).size).toBe(3);
    await app.close();
  });

  it('keeps direct-message edit and delete author-only', async () => {
    const { app } = await appFor();
    const conversationId = await directConversation(app);
    const created = await app.inject({
      method: 'POST',
      url: `/direct-conversations/${conversationId}/messages`,
      headers: bearer('a'),
      payload: { content: 'owned', clientNonce: 'owned' },
    });
    const messageId = created.json().id;
    const edit = await app.inject({
      method: 'PATCH',
      url: `/direct-messages/${messageId}`,
      headers: bearer('b'),
      payload: { content: 'stolen' },
    });
    const deletion = await app.inject({
      method: 'DELETE',
      url: `/direct-messages/${messageId}`,
      headers: bearer('b'),
    });
    expect(edit.statusCode).toBe(403);
    expect(deletion.statusCode).toBe(403);
    await app.close();
  });
});
