import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { Permission } from '@guilda/types';
import { registerUploadRoutes, type AttachmentStorage } from '../src/http/uploads.js';
import { errorHandler } from '../src/http/errors.js';
import type { AttachmentRecord, CreateAttachmentRecord, Repository } from '../src/repository.js';
import type { Config } from '../src/config.js';

const channel = {
  id: 'channel-1',
  serverId: 'server-1',
  name: 'general',
  type: 'TEXT' as const,
  position: 0,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function pendingAttachment(overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id: 'attachment-1',
    channelId: channel.id,
    messageId: null,
    userId: 'sender-1',
    storageKey: 'attachments/channel-1/sender-1/attachment-1',
    filename: 'photo.png',
    mimeType: 'image/png',
    size: 4,
    status: 'PENDING',
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

async function appFor(input?: {
  attachment?: AttachmentRecord;
  object?: { size: number; mimeType: string } | null;
  config?: Partial<Config>;
}) {
  let attachment = input?.attachment ?? null;
  const createAttachment = vi.fn(async (record: CreateAttachmentRecord) => {
    attachment = pendingAttachment({ ...record, messageId: null, status: 'PENDING' });
    return attachment;
  });
  const repo = {
    getChannel: async (id: string) => (id === channel.id ? channel : null),
    getMembership: async (_serverId: string, userId: string) =>
      userId === 'outsider-1'
        ? null
        : {
            serverId: channel.serverId,
            userId,
            permissions: Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
            user: {} as never,
          },
    createAttachment,
    getAttachment: async (id: string) => (attachment?.id === id ? attachment : null),
    markAttachmentReady: async (id: string, ownerId: string) => {
      if (
        attachment?.id !== id ||
        attachment.userId !== ownerId ||
        attachment.status !== 'PENDING' ||
        attachment.messageId
      )
        return null;
      attachment = { ...attachment, status: 'READY' };
      return attachment;
    },
  } as unknown as Repository;
  const storage: AttachmentStorage = {
    presignPut: vi.fn(async () => ({
      uploadUrl: 'http://minio.test/upload',
      headers: { 'Content-Type': 'image/png' },
    })),
    head: vi.fn(async () =>
      input && 'object' in input ? (input.object ?? null) : { size: 4, mimeType: 'image/png' },
    ),
    get: vi.fn(async () => Readable.from(Buffer.from('test'))),
  };
  const auth = {
    verifyAccessToken: async (token: string) => {
      if (token === 'owner-token') return 'sender-1';
      if (token === 'member-token') return 'member-1';
      if (token === 'outsider-token') return 'outsider-1';
      throw new Error('invalid token');
    },
  } as never;
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  await registerUploadRoutes(app, repo, auth, (input?.config ?? {}) as Config, storage);
  return { app, createAttachment, storage };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('attachment upload routes', () => {
  it('presigns a channel upload using the public response contract', async () => {
    const { app, createAttachment } = await appFor();
    const response = await app.inject({
      method: 'POST',
      url: '/channels/channel-1/attachments',
      headers: bearer('owner-token'),
      payload: { filename: 'photo.png', mimeType: 'image/png', size: 4 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      uploadUrl: 'http://minio.test/upload',
      headers: { 'Content-Type': 'image/png' },
      expiresIn: 900,
    });
    expect(response.json().attachmentId).toEqual(expect.any(String));
    expect(createAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: channel.id, userId: 'sender-1', size: 4 }),
    );
    await app.close();
  });

  it('routes uploads through the storage proxy and streams protected downloads', async () => {
    const { app, storage } = await appFor({
      attachment: pendingAttachment({ status: 'READY', messageId: 'message-1' }),
      config: { S3_BROWSER_ENDPOINT: 'https://storage.noxera.online' },
    });
    vi.mocked(storage.presignPut).mockResolvedValueOnce({
      uploadUrl:
        'https://namespace.compat.objectstorage.sa-saopaulo-1.oci.customer-oci.com/guilda/attachment?X-Amz-Signature=put',
      headers: { 'Content-Type': 'image/png' },
    });
    vi.mocked(storage.get).mockResolvedValueOnce(Readable.from(Buffer.from('test')));

    const download = await app.inject({
      method: 'GET',
      url: '/attachments/attachment-1/content',
      headers: bearer('member-token'),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('image/png');
    expect(download.headers['content-length']).toBe('4');
    expect(download.body).toBe('test');

    const upload = await app.inject({
      method: 'POST',
      url: '/channels/channel-1/attachments',
      headers: bearer('owner-token'),
      payload: { filename: 'photo.png', mimeType: 'image/png', size: 4 },
    });
    expect(upload.json().uploadUrl).toBe(
      'https://storage.noxera.online/guilda/attachment?X-Amz-Signature=put',
    );
    await app.close();
  });

  it('verifies object metadata before making an owned upload ready', async () => {
    const { app } = await appFor({ attachment: pendingAttachment() });
    const response = await app.inject({
      method: 'POST',
      url: '/attachments/attachment-1/complete',
      headers: bearer('owner-token'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().attachment).toMatchObject({
      id: 'attachment-1',
      channelId: 'channel-1',
      status: 'READY',
      url: '/attachments/attachment-1/content',
    });
    await app.close();
  });

  it.each([
    ['missing object', null],
    ['wrong size', { size: 3, mimeType: 'image/png' }],
    ['wrong content type', { size: 4, mimeType: 'text/plain' }],
  ])('rejects completion for %s', async (_label, object) => {
    const { app } = await appFor({ attachment: pendingAttachment(), object });
    const response = await app.inject({
      method: 'POST',
      url: '/attachments/attachment-1/complete',
      headers: bearer('owner-token'),
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejects completion by a different user and a second completion', async () => {
    const { app } = await appFor({ attachment: pendingAttachment() });
    const wrongOwner = await app.inject({
      method: 'POST',
      url: '/attachments/attachment-1/complete',
      headers: bearer('member-token'),
    });
    expect(wrongOwner.statusCode).toBe(403);
    const first = await app.inject({
      method: 'POST',
      url: '/attachments/attachment-1/complete',
      headers: bearer('owner-token'),
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: 'POST',
      url: '/attachments/attachment-1/complete',
      headers: bearer('owner-token'),
    });
    expect(second.statusCode).toBe(409);
    await app.close();
  });

  it('only streams claimed content to a channel member', async () => {
    const claimed = pendingAttachment({ status: 'READY', messageId: 'message-1' });
    const { app } = await appFor({ attachment: claimed });
    const outsider = await app.inject({
      method: 'GET',
      url: '/attachments/attachment-1/content',
      headers: bearer('outsider-token'),
    });
    expect(outsider.statusCode).toBe(403);
    const member = await app.inject({
      method: 'GET',
      url: '/attachments/attachment-1/content',
      headers: bearer('member-token'),
    });
    expect(member.statusCode).toBe(200);
    expect(member.body).toBe('test');
    await app.close();
  });

  it('only allows the uploader to access an unassigned attachment', async () => {
    const { app } = await appFor({ attachment: pendingAttachment({ status: 'READY' }) });
    const other = await app.inject({
      method: 'GET',
      url: '/attachments/attachment-1/content',
      headers: bearer('member-token'),
    });
    expect(other.statusCode).toBe(403);
    const owner = await app.inject({
      method: 'GET',
      url: '/attachments/attachment-1/content',
      headers: bearer('owner-token'),
    });
    expect(owner.statusCode).toBe(200);
    expect(owner.body).toBe('test');
    await app.close();
  });
});
