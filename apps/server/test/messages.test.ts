import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { Permission } from '@guilda/types';
import { registerMessageRoutes } from '../src/http/messages.js';
import { errorHandler } from '../src/http/errors.js';
import { RepositoryError, type Repository } from '../src/repository.js';

const channel = {
  id: 'channel-1',
  serverId: 'server-1',
  name: 'general',
  type: 'TEXT' as const,
  position: 0,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function appFor() {
  const listMessages = vi.fn(async () => ({ items: [], nextCursor: null }));
  const searchMessages = vi.fn(async () => ({ items: [], nextCursor: null }));
  const claimedAttachments = new Set<string>();
  const createMessage = vi.fn(
    async (input: {
      channelId: string;
      authorId: string;
      content: string;
      replyToId: string | null;
      attachmentIds: string[];
      clientNonce: string;
    }) => {
      const invalid = input.attachmentIds.some(
        (id) => !id.startsWith('ready-') || claimedAttachments.has(id),
      );
      if (invalid || new Set(input.attachmentIds).size !== input.attachmentIds.length)
        throw new RepositoryError('ATTACHMENT_CLAIM_INVALID');
      for (const id of input.attachmentIds) claimedAttachments.add(id);
      return {
        id: 'message-1',
        ...input,
        author: {},
        attachments: [],
        createdAt: '',
        updatedAt: '',
        deletedAt: null,
      };
    },
  );
  const repo = {
    getChannel: async (channelId: string) => (channelId === channel.id ? channel : null),
    getMembership: async (_serverId: string, userId: string) => {
      if (userId === 'outsider-1') return null;
      return {
        serverId: 'server-1',
        userId,
        permissions:
          userId === 'member-1'
            ? Permission.VIEW_CHANNEL
            : Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
        user: {} as never,
      };
    },
    listMessages,
    searchMessages,
    createMessage,
    getMessage: async () => null,
  } as unknown as Repository;
  const auth = {
    verifyAccessToken: async (token: string) => {
      if (token === 'outsider-token') return 'outsider-1';
      if (token === 'member-token') return 'member-1';
      if (token === 'sender-token') return 'sender-1';
      throw new Error('invalid token');
    },
  } as never;
  const emitMessageCreated = vi.fn();
  const emitMessageUpdated = vi.fn();
  const emitMessageDeleted = vi.fn();
  const app = Fastify();
  app.decorate('realtime', { emitMessageCreated, emitMessageUpdated, emitMessageDeleted } as never);
  app.setErrorHandler(errorHandler);
  return registerMessageRoutes(app, repo, auth).then(() => ({
    app,
    listMessages,
    searchMessages,
    createMessage,
    emitMessageCreated,
  }));
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('message authorization and history', () => {
  it('denies history to a valid non-member without querying messages', async () => {
    const { app, listMessages } = await appFor();
    const response = await app.inject({
      method: 'GET',
      url: '/channels/channel-1/messages',
      headers: bearer('outsider-token'),
    });
    expect(response.statusCode).toBe(403);
    expect(listMessages).not.toHaveBeenCalled();
    await app.close();
  });
  it('denies server message search to a valid non-member', async () => {
    const { app, searchMessages } = await appFor();
    const response = await app.inject({
      method: 'GET',
      url: '/servers/server-1/messages/search?query=hello',
      headers: bearer('outsider-token'),
    });
    expect(response.statusCode).toBe(403);
    expect(searchMessages).not.toHaveBeenCalled();
    await app.close();
  });

  it('searches authorized messages with an opaque cursor and bounded page size', async () => {
    const { app, searchMessages } = await appFor();
    const response = await app.inject({
      method: 'GET',
      url: '/servers/server-1/messages/search?query=hello&cursor=result-50&limit=25',
      headers: bearer('sender-token'),
    });
    expect(response.statusCode).toBe(200);
    expect(searchMessages).toHaveBeenCalledWith({
      serverId: 'server-1',
      query: 'hello',
      cursor: 'result-50',
      limit: 25,
    });
    await app.close();
  });

  it('requires SEND_MESSAGES in addition to channel visibility', async () => {
    const { app } = await appFor();
    const response = await app.inject({
      method: 'POST',
      url: '/channels/channel-1/messages',
      headers: bearer('member-token'),
      payload: { content: 'hello', clientNonce: 'nonce-1' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('broadcasts a message created through the HTTP fallback', async () => {
    const { app, emitMessageCreated } = await appFor();
    const response = await app.inject({
      method: 'POST',
      url: '/channels/channel-1/messages',
      headers: bearer('sender-token'),
      payload: { content: 'hello', clientNonce: 'nonce-http-fallback' },
    });
    expect(response.statusCode).toBe(200);
    expect(emitMessageCreated).toHaveBeenCalledWith(
      response.json(),
      'nonce-http-fallback',
      channel,
    );
    await app.close();
  });

  it('uses an opaque cursor and bounded limit for authorized history', async () => {
    const { app, listMessages } = await appFor();
    const response = await app.inject({
      method: 'GET',
      url: '/channels/channel-1/messages?cursor=opaque-1&limit=100',
      headers: bearer('sender-token'),
    });
    expect(response.statusCode).toBe(200);
    expect(listMessages).toHaveBeenCalledWith({
      channelId: 'channel-1',
      cursor: 'opaque-1',
      limit: 100,
    });
    await app.close();
  });

  it.each(['wrong-owner', 'wrong-channel', 'pending'])(
    'rejects an attachment with invalid claim state: %s',
    async (attachmentId) => {
      const { app } = await appFor();
      const response = await app.inject({
        method: 'POST',
        url: '/channels/channel-1/messages',
        headers: bearer('sender-token'),
        payload: {
          content: 'hello',
          clientNonce: `nonce-${attachmentId}`,
          attachmentIds: [attachmentId],
        },
      });
      expect(response.statusCode).toBe(409);
      await app.close();
    },
  );

  it('rejects a partial set without claiming its valid attachment', async () => {
    const { app } = await appFor();
    const partial = await app.inject({
      method: 'POST',
      url: '/channels/channel-1/messages',
      headers: bearer('sender-token'),
      payload: {
        content: 'hello',
        clientNonce: 'nonce-partial',
        attachmentIds: ['ready-2', 'wrong-owner'],
      },
    });
    expect(partial.statusCode).toBe(409);
    const retry = await app.inject({
      method: 'POST',
      url: '/channels/channel-1/messages',
      headers: bearer('sender-token'),
      payload: { content: '', clientNonce: 'nonce-retry', attachmentIds: ['ready-2'] },
    });
    expect(retry.statusCode).toBe(200);
    await app.close();
  });

  it('rejects a second claim of the same attachment', async () => {
    const { app } = await appFor();
    const first = await app.inject({
      method: 'POST',
      url: '/channels/channel-1/messages',
      headers: bearer('sender-token'),
      payload: { content: 'first', clientNonce: 'nonce-first', attachmentIds: ['ready-1'] },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/channels/channel-1/messages',
      headers: bearer('sender-token'),
      payload: { content: 'second', clientNonce: 'nonce-second', attachmentIds: ['ready-1'] },
    });
    expect(second.statusCode).toBe(409);
    await app.close();
  });
});
