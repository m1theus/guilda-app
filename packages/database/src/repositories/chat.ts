import type {
  Channel as ChannelContract,
  GuildServer,
  Message as MessageContract,
  User as UserContract,
} from '@guilda/types';
import { DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@guilda/types';
import type { Prisma } from '@prisma/client';
import { prisma } from '../client';
import { toUserContract } from './auth';
const allPermissions = Object.values(Permission).reduce((bits, permission) => bits | permission, 0);

const messageWithAuthor = {
  author: true,
  attachments: true,
} satisfies Prisma.MessageInclude;

type MessageWithAuthor = Prisma.MessageGetPayload<{ include: typeof messageWithAuthor }>;

type ServerWithSnapshot = Prisma.ServerGetPayload<{
  include: {
    channels: true;
    members: { include: { user: true } };
  };
}>;

function toChannelContract(channel: {
  id: string;
  serverId: string;
  name: string;
  type: ChannelContract['type'];
  position: number;
  createdAt: Date;
  updatedAt: Date;
}): ChannelContract {
  return {
    id: channel.id,
    serverId: channel.serverId,
    name: channel.name,
    type: channel.type,
    position: channel.position,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

function toMessageContract(message: MessageWithAuthor): MessageContract {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    content: message.deletedAt ? '' : message.content,
    replyToId: message.replyToId,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    deletedAt: message.deletedAt?.toISOString() ?? null,
    author: toUserContract(message.author),
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      channelId: attachment.channelId,
      messageId: attachment.messageId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: Number(attachment.size),
      status: attachment.status,
      url: `/attachments/${attachment.id}/content`,
      createdAt: attachment.createdAt.toISOString(),
    })),
  };
}

function toServerContract(server: {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}): GuildServer {
  return {
    id: server.id,
    name: server.name,
    iconUrl: server.iconUrl,
    ownerId: server.ownerId,
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
  };
}

export async function createServerWithDefaults(input: {
  name: string;
  ownerId: string;
}): Promise<{ server: GuildServer; defaultChannel: ChannelContract }> {
  const created = await prisma.$transaction(async (tx) => {
    const server = await tx.server.create({
      data: {
        name: input.name,
        ownerId: input.ownerId,
        members: { create: { userId: input.ownerId } },
      },
    });
    const everyoneRole = await tx.role.create({
      data: {
        serverId: server.id,
        name: '@everyone',
        permissions: DEFAULT_EVERYONE_PERMISSIONS,
        position: 0,
      },
    });
    const ownerRole = await tx.role.create({
      data: { serverId: server.id, name: 'Owner', permissions: allPermissions, position: 1 },
    });
    await tx.serverMemberRole.createMany({
      data: [
        { serverId: server.id, userId: input.ownerId, roleId: everyoneRole.id },
        { serverId: server.id, userId: input.ownerId, roleId: ownerRole.id },
      ],
    });
    const defaultChannel = await tx.channel.create({
      data: { serverId: server.id, name: 'general', type: 'TEXT', position: 0 },
    });
    await tx.channel.create({
      data: { serverId: server.id, name: 'Lounge', type: 'VOICE', position: 1 },
    });
    return { server, defaultChannel };
  });

  return {
    server: toServerContract(created.server),
    defaultChannel: toChannelContract(created.defaultChannel),
  };
}

export async function findServerSnapshot(serverId: string): Promise<{
  server: GuildServer;
  channels: ChannelContract[];
  members: UserContract[];
} | null> {
  const server = (await prisma.server.findUnique({
    where: { id: serverId },
    include: { channels: { orderBy: { position: 'asc' } }, members: { include: { user: true } } },
  })) as ServerWithSnapshot | null;
  if (!server) return null;

  return {
    server: toServerContract(server),
    channels: server.channels.map(toChannelContract),
    members: server.members.map((member) => toUserContract(member.user)),
  };
}

export async function createMessage(input: {
  channelId: string;
  authorId: string;
  content: string;
  clientNonce: string;
  replyToId?: string;
  attachmentIds?: string[];
}): Promise<MessageContract> {
  if (new Set(input.attachmentIds ?? []).size !== (input.attachmentIds?.length ?? 0))
    throw new Error('ATTACHMENT_CLAIM_INVALID');
  const message = await prisma.$transaction(
    async (tx) => {
      const attachmentIds = input.attachmentIds ?? [];
      if (attachmentIds.length) {
        const claimable = await tx.attachment.count({
          where: {
            id: { in: attachmentIds },
            channelId: input.channelId,
            uploadedById: input.authorId,
            messageId: null,
            status: 'READY',
          },
        });
        if (claimable !== attachmentIds.length) throw new Error('ATTACHMENT_CLAIM_INVALID');
      }
      const created = await tx.message.create({
        data: {
          channelId: input.channelId,
          authorId: input.authorId,
          content: input.content,
          clientNonce: input.clientNonce,
          ...(input.replyToId ? { replyToId: input.replyToId } : {}),
        },
      });
      if (attachmentIds.length) {
        const claimed = await tx.attachment.updateMany({
          where: {
            id: { in: attachmentIds },
            channelId: input.channelId,
            uploadedById: input.authorId,
            messageId: null,
            status: 'READY',
          },
          data: { messageId: created.id },
        });
        if (claimed.count !== attachmentIds.length) throw new Error('ATTACHMENT_CLAIM_INVALID');
      }
      return tx.message.findUniqueOrThrow({
        where: { id: created.id },
        include: messageWithAuthor,
      });
    },
    { isolationLevel: 'Serializable' },
  );
  return toMessageContract(message);
}

export async function listChannelMessages(input: {
  channelId: string;
  before?: string;
  limit?: number;
}): Promise<{ items: MessageContract[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const messages = await prisma.message.findMany({
    where: { channelId: input.channelId, deletedAt: null },
    ...(input.before ? { cursor: { id: input.before }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: messageWithAuthor,
  });
  const hasMore = messages.length > limit;
  const items = messages.slice(0, limit).reverse().map(toMessageContract);
  return { items, nextCursor: hasMore ? (messages[limit - 1]?.id ?? null) : null };
}

export async function softDeleteMessage(input: {
  messageId: string;
  authorId: string;
}): Promise<boolean> {
  const result = await prisma.message.updateMany({
    where: { id: input.messageId, authorId: input.authorId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count === 1;
}

export async function upsertReadState(input: {
  userId: string;
  channelId: string;
  lastReadMessageId?: string;
}): Promise<void> {
  const lastReadMessageId = input.lastReadMessageId ?? null;
  await prisma.readState.upsert({
    where: { userId_channelId: { userId: input.userId, channelId: input.channelId } },
    create: { userId: input.userId, channelId: input.channelId, lastReadMessageId },
    update: { lastReadMessageId },
  });
}

export async function addReaction(input: {
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<void> {
  await prisma.messageReaction.create({ data: input });
}

export async function removeReaction(input: {
  messageId: string;
  userId: string;
  emoji: string;
}): Promise<boolean> {
  const result = await prisma.messageReaction.deleteMany({ where: input });
  return result.count === 1;
}
