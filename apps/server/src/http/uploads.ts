import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MAX_ATTACHMENT_SIZE, Permission, type Attachment } from '@guilda/types';
import { authenticate, type AuthenticatedRequest, parse } from './auth.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { requireServerPermission } from '../modules/permissions.js';
import type { Config } from '../config.js';
import type { AttachmentRecord, Repository } from '../repository.js';
import type { AuthService } from '../modules/auth.js';

const PRESIGN_TTL_SECONDS = 900;

const attachmentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(127),
  size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE),
});
const channelParams = z.object({ channelId: z.string().min(1) });
const attachmentParams = z.object({ id: z.string().min(1) });

export interface AttachmentStorage {
  presignPut(input: {
    storageKey: string;
    mimeType: string;
    size: number;
    expiresIn: number;
  }): Promise<{ uploadUrl: string; headers: Record<string, string> }>;
  head(storageKey: string): Promise<{ size: number; mimeType: string } | null>;
  get(storageKey: string): Promise<Readable | null>;
}

function userId(request: FastifyRequest): string {
  return (request as AuthenticatedRequest).userId;
}

function attachmentContract(record: AttachmentRecord): Attachment {
  return {
    id: record.id,
    channelId: record.channelId,
    messageId: record.messageId,
    filename: record.filename,
    mimeType: record.mimeType,
    size: record.size,
    status: record.status,
    url: `/attachments/${record.id}/content`,
    createdAt: record.createdAt,
  };
}

function browserStorageUrl(signedUrl: string, browserEndpoint: string | undefined): string {
  if (!browserEndpoint) return signedUrl;
  const signed = new URL(signedUrl);
  const browser = new URL(browserEndpoint);
  browser.pathname = `${browser.pathname.replace(/\/$/, '')}${signed.pathname}`;
  browser.search = signed.search;
  browser.hash = '';
  return browser.toString();
}

function s3Storage(config: Config): AttachmentStorage | null {
  if (!config.S3_BUCKET) return null;
  const credentials =
    config.S3_ACCESS_KEY && config.S3_SECRET_KEY
      ? { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
      : undefined;
  const client = new S3Client({
    region: config.S3_REGION,
    forcePathStyle: Boolean(config.S3_ENDPOINT),
    requestChecksumCalculation: 'WHEN_REQUIRED',
    ...(credentials ? { credentials } : {}),
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
  });
  const bucket = config.S3_BUCKET;
  return {
    async presignPut(input) {
      const uploadUrl = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.storageKey,
          ContentType: input.mimeType,
          ContentLength: input.size,
        }),
        { expiresIn: input.expiresIn },
      );
      return { uploadUrl, headers: { 'Content-Type': input.mimeType } };
    },
    async head(storageKey) {
      try {
        const object = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: storageKey }),
        );
        if (object.ContentLength === undefined || !object.ContentType) return null;
        return { size: object.ContentLength, mimeType: object.ContentType };
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },
    async get(storageKey) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
        return object.Body instanceof Readable ? object.Body : null;
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },
  };
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return (
    value.name === 'NotFound' ||
    value.name === 'NoSuchKey' ||
    value.$metadata?.httpStatusCode === 404
  );
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  repo: Repository,
  auth: AuthService,
  config: Config,
  storageOverride?: AttachmentStorage,
): Promise<void> {
  const storage = storageOverride ?? s3Storage(config);
  const authenticated = {
    preHandler: async (request: FastifyRequest) => authenticate(request, auth),
  };

  app.post('/channels/:channelId/attachments', authenticated, async (request) => {
    if (!storage) throw badRequest('Upload storage is not configured');
    const { channelId } = parse(channelParams, request.params);
    const channel = await repo.getChannel(channelId);
    if (!channel) throw notFound('Channel not found');
    const uploader = userId(request);
    await requireServerPermission(repo, channel.serverId, uploader, Permission.SEND_MESSAGES);
    const body = parse(attachmentSchema, request.body);
    const attachmentId = randomUUID();
    const storageKey = `attachments/${channel.id}/${uploader}/${attachmentId}`;
    await repo.createAttachment({
      id: attachmentId,
      channelId: channel.id,
      userId: uploader,
      storageKey,
      filename: body.filename,
      mimeType: body.mimeType,
      size: body.size,
    });
    const signed = await storage.presignPut({
      storageKey,
      mimeType: body.mimeType,
      size: body.size,
      expiresIn: PRESIGN_TTL_SECONDS,
    });
    return {
      attachmentId,
      uploadUrl: browserStorageUrl(signed.uploadUrl, config.S3_BROWSER_ENDPOINT),
      headers: signed.headers,
      expiresIn: PRESIGN_TTL_SECONDS,
    };
  });

  app.post('/attachments/:id/complete', authenticated, async (request) => {
    if (!storage) throw badRequest('Upload storage is not configured');
    const { id } = parse(attachmentParams, request.params);
    const pending = await repo.getAttachment(id);
    if (!pending) throw notFound('Attachment not found');
    if (pending.userId !== userId(request))
      throw forbidden('Only the uploader can complete this attachment');
    if (pending.messageId || pending.status !== 'PENDING')
      throw conflict('Attachment is not pending completion');
    const object = await storage.head(pending.storageKey);
    if (!object) throw badRequest('The uploaded object was not found');
    if (
      object.size !== pending.size ||
      object.mimeType.toLowerCase() !== pending.mimeType.toLowerCase()
    )
      throw badRequest('The uploaded object does not match the declared metadata');
    const completed = await repo.markAttachmentReady(id, userId(request));
    if (!completed) throw conflict('Attachment is no longer pending completion');
    return { attachment: attachmentContract(completed) };
  });

  app.get('/attachments/:id/content', authenticated, async (request, reply) => {
    if (!storage) throw badRequest('Upload storage is not configured');
    const { id } = parse(attachmentParams, request.params);
    const attachment = await repo.getAttachment(id);
    if (!attachment) throw notFound('Attachment not found');
    const viewer = userId(request);
    if (attachment.messageId === null) {
      if (attachment.userId !== viewer) throw forbidden();
    } else {
      const channel = await repo.getChannel(attachment.channelId);
      if (!channel) throw notFound('Channel not found');
      if (!(await repo.getMembership(channel.serverId, viewer))) throw forbidden();
    }
    const body = await storage.get(attachment.storageKey);
    if (!body) throw notFound('Attachment object not found');
    return reply
      .type(attachment.mimeType)
      .header('Content-Length', String(attachment.size))
      .header('Cache-Control', 'private, max-age=900')
      .send(body);
  });
}
