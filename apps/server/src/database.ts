import { randomBytes } from 'node:crypto';
import { prisma } from '@guilda/database';
import {
  ALL_PERMISSIONS,
  DEFAULT_EVERYONE_PERMISSIONS,
  Permission,
  type AuditLog,
  type Ban,
  type Channel,
  type GuildServer,
  type DirectConversation,
  type DirectMessage,
  type Friendship,
  type Invite,
  type Message,
  type Report,
  type ReportStatus,
  type Role,
  type PersonalBlock,
  type UpdateProfileRequest,
  type User,
} from '@guilda/types';
import type { Prisma } from '@guilda/database';
import {
  RepositoryError,
  canonicalPairKey,
  type AttachmentRecord,
  type CreateAttachmentRecord,
  type Repository,
  type RefreshSession,
  type StoredUser,
  type MemberRecord,
} from './repository.js';
const db = prisma;
type UserRow = Prisma.UserGetPayload<Prisma.UserDefaultArgs>;
type ServerRow = Prisma.ServerGetPayload<Prisma.ServerDefaultArgs>;
type ChannelRow = Prisma.ChannelGetPayload<Prisma.ChannelDefaultArgs>;
type MessageRow = Prisma.MessageGetPayload<{
  include: { author: true; attachments: true };
}>;
type AttachmentRow = MessageRow['attachments'][number];
type RoleRow = Prisma.RoleGetPayload<Prisma.RoleDefaultArgs>;
type BanRow = Prisma.BanGetPayload<{ include: { user: true } }>;
type ReportRow = Prisma.ReportGetPayload<Prisma.ReportDefaultArgs>;
type AuditRow = Prisma.AuditLogGetPayload<Prisma.AuditLogDefaultArgs>;
type FriendshipRow = Prisma.FriendshipGetPayload<{
  include: { requester: true; addressee: true };
}>;
type DirectConversationRow = Prisma.DirectConversationGetPayload<{
  include: { members: { include: { user: true } } };
}>;
type DirectMessageRow = Prisma.DirectMessageGetPayload<{ include: { author: true } }>;
const iso = (date: Date): string => date.toISOString();
function userContract(user: UserRow): User {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl ?? null,
    pronouns: user.pronouns ?? null,
    bio: user.bio ?? null,
    bannerUrl: user.bannerUrl ?? null,
    profileColor: user.profileColor ?? null,
    status: user.status,
    createdAt: iso(user.createdAt),
    updatedAt: iso(user.updatedAt),
  };
}
function serverContract(server: ServerRow): GuildServer {
  return {
    id: server.id,
    name: server.name,
    iconUrl: server.iconUrl ?? null,
    ownerId: server.ownerId,
    createdAt: iso(server.createdAt),
    updatedAt: iso(server.updatedAt),
  };
}
function channelContract(channel: ChannelRow): Channel {
  return {
    id: channel.id,
    serverId: channel.serverId,
    name: channel.name,
    type: channel.type,
    position: channel.position,
    createdAt: iso(channel.createdAt),
    updatedAt: iso(channel.updatedAt),
  };
}
function attachmentRecord(attachment: AttachmentRow): AttachmentRecord {
  return {
    id: attachment.id,
    channelId: attachment.channelId,
    messageId: attachment.messageId ?? null,
    userId: attachment.uploadedById,
    storageKey: attachment.storageKey,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: Number(attachment.size),
    status: attachment.status,
    createdAt: iso(attachment.createdAt),
  };
}
function messageContract(message: MessageRow): Message {
  return {
    id: message.id,
    channelId: message.channelId,
    authorId: message.authorId,
    content: message.deletedAt ? '' : message.content,
    replyToId: message.replyToId ?? null,
    createdAt: iso(message.createdAt),
    updatedAt: iso(message.updatedAt),
    deletedAt: message.deletedAt ? iso(message.deletedAt) : null,
    author: userContract(message.author),
    attachments: message.attachments.map((attachment: AttachmentRow) => ({
      id: attachment.id,
      channelId: attachment.channelId,
      messageId: attachment.messageId ?? null,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: Number(attachment.size),
      status: attachment.status,
      url: `/attachments/${attachment.id}/content`,
      createdAt: iso(attachment.createdAt),
    })),
  };
}
function roleContract(role: RoleRow): Role {
  return {
    id: role.id,
    serverId: role.serverId,
    name: role.name,
    permissions: role.permissions,
    color: role.color ?? null,
    position: role.position,
    createdAt: iso(role.createdAt),
  };
}
function banContract(ban: BanRow): Ban {
  return {
    serverId: ban.serverId,
    userId: ban.userId,
    bannedById: ban.bannedById,
    reason: ban.reason ?? null,
    expiresAt: ban.expiresAt ? iso(ban.expiresAt) : null,
    createdAt: iso(ban.createdAt),
    user: userContract(ban.user),
  };
}
function friendshipContract(friendship: FriendshipRow): Friendship {
  return {
    pairKey: friendship.pairKey,
    requesterId: friendship.requesterId,
    addresseeId: friendship.addresseeId,
    status: friendship.status as Friendship['status'],
    requestedAt: iso(friendship.requestedAt),
    respondedAt: friendship.respondedAt ? iso(friendship.respondedAt) : null,
    requester: userContract(friendship.requester),
    addressee: userContract(friendship.addressee),
  };
}

function blockContract(
  block: Prisma.BlockGetPayload<{ include: { blocked: true } }>,
): PersonalBlock {
  return {
    blockerId: block.blockerId,
    blockedId: block.blockedId,
    createdAt: iso(block.createdAt),
    blocked: userContract(block.blocked),
  };
}

function directConversationContract(conversation: DirectConversationRow): DirectConversation {
  return {
    id: conversation.id,
    pairKey: conversation.pairKey,
    createdById: conversation.createdById,
    createdAt: iso(conversation.createdAt),
    updatedAt: iso(conversation.updatedAt),
    members: conversation.members.map((member) => userContract(member.user)),
  };
}

function directMessageContract(message: DirectMessageRow): DirectMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    authorId: message.authorId,
    content: message.deletedAt ? '' : message.content,
    clientNonce: message.clientNonce,
    createdAt: iso(message.createdAt),
    updatedAt: iso(message.updatedAt),
    deletedAt: message.deletedAt ? iso(message.deletedAt) : null,
    author: userContract(message.author),
  };
}

const prismaErrorCode = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;

async function serializable<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (prismaErrorCode(error) !== 'P2034' || attempt >= 2) throw error;
    }
  }
}

async function relationIsBlocked(
  tx: Prisma.TransactionClient,
  firstUserId: string,
  secondUserId: string,
): Promise<boolean> {
  return (
    (await tx.block.count({
      where: {
        OR: [
          { blockerId: firstUserId, blockedId: secondUserId },
          { blockerId: secondUserId, blockedId: firstUserId },
        ],
      },
    })) > 0
  );
}
function reportContract(report: ReportRow): Report {
  return {
    id: report.id,
    reporterId: report.reporterId,
    serverId: report.serverId ?? null,
    messageId: report.messageId ?? null,
    targetUserId: report.targetUserId ?? null,
    reason: report.reason,
    status: report.status,
    resolution: report.resolution ?? null,
    createdAt: iso(report.createdAt),
    resolvedAt: report.resolvedAt ? iso(report.resolvedAt) : null,
  };
}
function auditContract(audit: AuditRow): AuditLog {
  return {
    id: audit.id,
    serverId: audit.serverId,
    actorId: audit.actorId ?? null,
    action: audit.action,
    targetType:
      audit.targetType === 'USER' || audit.targetType === 'ROLE' || audit.targetType === 'REPORT'
        ? audit.targetType
        : null,
    targetId: audit.targetId ?? null,
    metadata:
      audit.metadata && typeof audit.metadata === 'object' && !Array.isArray(audit.metadata)
        ? (audit.metadata as Record<string, unknown>)
        : {},
    createdAt: iso(audit.createdAt),
  };
}
async function memberAuthority(
  tx: Prisma.TransactionClient,
  serverId: string,
  userId: string,
  requiredPermission = 0,
): Promise<{ isOwner: boolean; highestPosition: number; permissions: number }> {
  const member = await tx.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
    include: { server: true, roles: { include: { role: true } } },
  });
  if (!member) throw new RepositoryError('MEMBER_NOT_FOUND');
  const isOwner = member.server.ownerId === userId;
  const assignedPermissions = member.roles.reduce(
    (mask, membershipRole) => mask | membershipRole.role.permissions,
    0,
  );
  const permissions = isOwner ? ALL_PERMISSIONS : assignedPermissions;
  if ((permissions & requiredPermission) !== requiredPermission)
    throw new RepositoryError('ROLE_HIERARCHY');
  return {
    isOwner,
    highestPosition: isOwner
      ? Number.MAX_SAFE_INTEGER
      : Math.max(-1, ...member.roles.map((membershipRole) => membershipRole.role.position)),
    permissions,
  };
}

function assertKnownPermissions(permissions: number): void {
  if (
    !Number.isSafeInteger(permissions) ||
    permissions < 0 ||
    (permissions & ~ALL_PERMISSIONS) !== 0
  )
    throw new RepositoryError('UNKNOWN_PERMISSIONS');
}

export class PrismaRepository implements Repository {
  async close(): Promise<void> {
    await db.$disconnect();
  }
  async healthcheck(): Promise<void> {
    await db.$queryRaw`SELECT 1`;
  }
  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const u = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    return u ? { ...userContract(u), passwordHash: u.passwordHash } : null;
  }
  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const u = await db.user.findUnique({ where: { username } });
    return u ? { ...userContract(u), passwordHash: u.passwordHash } : null;
  }
  async updateUserProfile(userId: string, input: UpdateProfileRequest): Promise<StoredUser | null> {
    const u = await db.user
      .update({ where: { id: userId }, data: input })
      .catch((error: unknown) => {
        if (prismaErrorCode(error) === 'P2025') return null;
        throw error;
      });
    return u ? { ...userContract(u), passwordHash: u.passwordHash } : null;
  }
  async findUserById(id: string): Promise<StoredUser | null> {
    const u = await db.user.findUnique({ where: { id } });
    return u ? { ...userContract(u), passwordHash: u.passwordHash } : null;
  }
  async createUser(input: {
    username: string;
    displayName: string;
    email: string;
    passwordHash: string;
  }): Promise<StoredUser> {
    const u = await db.user.create({ data: { ...input } });
    return { ...userContract(u), passwordHash: u.passwordHash };
  }
  async createRefreshSession(
    input: Omit<RefreshSession, 'revokedAt' | 'replacedBy'>,
  ): Promise<RefreshSession> {
    const s = await db.session.create({
      data: {
        id: input.id,
        userId: input.userId,
        refreshTokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
      },
    });
    return {
      id: s.id,
      userId: s.userId,
      familyId: input.familyId,
      tokenHash: s.refreshTokenHash,
      expiresAt: s.expiresAt,
      revokedAt: s.revokedAt,
      replacedBy: s.replacedById,
    };
  }
  async findRefreshSession(id: string): Promise<RefreshSession | null> {
    const s = await db.session.findUnique({ where: { id } });
    return s
      ? {
          id: s.id,
          userId: s.userId,
          familyId: s.userId,
          tokenHash: s.refreshTokenHash,
          expiresAt: s.expiresAt,
          revokedAt: s.revokedAt,
          replacedBy: s.replacedById,
        }
      : null;
  }
  async revokeRefreshFamily(familyId: string): Promise<void> {
    await db.session.updateMany({ where: { userId: familyId }, data: { revokedAt: new Date() } });
  }
  async rotateRefreshSession(id: string, replacement: RefreshSession): Promise<void> {
    await db.$transaction([
      db.session.create({
        data: {
          id: replacement.id,
          userId: replacement.userId,
          refreshTokenHash: replacement.tokenHash,
          expiresAt: replacement.expiresAt,
        },
      }),
      db.session.update({
        where: { id },
        data: { revokedAt: new Date(), rotatedAt: new Date(), replacedById: replacement.id },
      }),
    ]);
  }
  async listServersForUser(userId: string): Promise<GuildServer[]> {
    const rows = await db.server.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(serverContract);
  }
  async createServer(input: {
    name: string;
    ownerId: string;
  }): Promise<{ server: GuildServer; defaultChannel: Channel }> {
    const result = await db.$transaction(async (tx) => {
      const server = await tx.server.create({
        data: {
          name: input.name,
          ownerId: input.ownerId,
        },
      });
      const defaultChannel = await tx.channel.create({
        data: { serverId: server.id, name: 'general', type: 'TEXT', position: 0 },
      });
      await tx.channel.create({
        data: { serverId: server.id, name: 'Lounge', type: 'VOICE', position: 1 },
      });
      const member = await tx.serverMember.create({
        data: { serverId: server.id, userId: input.ownerId },
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
        data: {
          serverId: server.id,
          name: 'Owner',
          permissions: ALL_PERMISSIONS,
          position: 1,
        },
      });
      await tx.serverMemberRole.createMany({
        data: [
          { serverId: server.id, userId: member.userId, roleId: everyoneRole.id },
          { serverId: server.id, userId: member.userId, roleId: ownerRole.id },
        ],
      });
      return { server, channel: defaultChannel };
    });
    return {
      server: serverContract(result.server),
      defaultChannel: channelContract(result.channel),
    };
  }
  async getServer(id: string): Promise<GuildServer | null> {
    const server = await db.server.findUnique({ where: { id } });
    return server ? serverContract(server) : null;
  }
  async getMembership(serverId: string, userId: string): Promise<MemberRecord | null> {
    const m = await db.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      include: { server: true, user: true, roles: { include: { role: true } } },
    });
    if (!m) return null;
    const assignedPermissions = m.roles.reduce((mask, role) => mask | role.role.permissions, 0);
    const permissions = m.server.ownerId === userId ? ALL_PERMISSIONS : assignedPermissions;
    return { serverId, userId, permissions, user: userContract(m.user) };
  }
  async listMembers(serverId: string): Promise<User[]> {
    const rows = await db.serverMember.findMany({ where: { serverId }, include: { user: true } });
    return rows.map((row) => userContract(row.user));
  }
  async getSnapshot(serverId: string, currentUserId: string) {
    const [server, membership] = await Promise.all([
      db.server.findUnique({
        where: { id: serverId },
        include: { channels: { orderBy: { position: 'asc' } } },
      }),
      this.getMembership(serverId, currentUserId),
    ]);
    if (!server) throw new Error('server not found');
    if (!membership) throw new RepositoryError('MEMBER_NOT_FOUND');
    return {
      server: serverContract(server),
      channels: server.channels.map(channelContract),
      members: await this.listMembers(serverId),
      currentUserPermissions: membership.permissions,
    };
  }
  async getChannel(id: string): Promise<Channel | null> {
    const c = await db.channel.findUnique({ where: { id } });
    return c ? channelContract(c) : null;
  }
  async createChannel(input: {
    serverId: string;
    name: string;
    type: 'TEXT' | 'VOICE';
  }): Promise<Channel> {
    const c = await db.channel.create({ data: input });
    return channelContract(c);
  }
  async createInvite(input: {
    serverId: string;
    createdById: string;
    expiresAt: Date | null;
    maxUses: number | null;
  }): Promise<Invite> {
    const i = await db.invite.create({
      data: { ...input, code: randomBytes(6).toString('base64url').slice(0, 16) },
    });
    return {
      code: i.code,
      serverId: i.serverId,
      createdById: i.createdById,
      expiresAt: i.expiresAt ? iso(i.expiresAt) : null,
      maxUses: i.maxUses,
      uses: i.uses,
    };
  }
  async getInvite(code: string): Promise<Invite | null> {
    const i = await db.invite.findUnique({ where: { code } });
    return i
      ? {
          code: i.code,
          serverId: i.serverId,
          createdById: i.createdById,
          expiresAt: i.expiresAt ? iso(i.expiresAt) : null,
          maxUses: i.maxUses,
          uses: i.uses,
        }
      : null;
  }
  async acceptInvite(code: string, userId: string): Promise<GuildServer> {
    return db.$transaction(
      async (tx) => {
        const invite = await tx.invite.findUnique({
          where: { code },
          include: { server: true },
        });
        if (!invite) throw new RepositoryError('INVITE_NOT_FOUND');
        if (invite.expiresAt && invite.expiresAt <= new Date())
          throw new RepositoryError('INVITE_EXPIRED');
        if (invite.maxUses !== null && invite.uses >= invite.maxUses)
          throw new RepositoryError('INVITE_EXHAUSTED');
        const ban = await tx.ban.findUnique({
          where: { serverId_userId: { serverId: invite.serverId, userId } },
        });
        if (ban && (!ban.expiresAt || ban.expiresAt > new Date()))
          throw new RepositoryError('USER_BANNED');
        if (ban?.expiresAt && ban.expiresAt <= new Date()) {
          await tx.ban.delete({
            where: { serverId_userId: { serverId: invite.serverId, userId } },
          });
        }

        const existingMember = await tx.serverMember.findUnique({
          where: { serverId_userId: { serverId: invite.serverId, userId } },
        });
        if (!existingMember) {
          const everyoneRole = await tx.role.findUnique({
            where: { serverId_name: { serverId: invite.serverId, name: '@everyone' } },
          });
          if (!everyoneRole) throw new Error('default server role missing');
          await tx.serverMember.create({
            data: { serverId: invite.serverId, userId },
          });
          await tx.serverMemberRole.create({
            data: { serverId: invite.serverId, userId, roleId: everyoneRole.id },
          });
          await tx.invite.update({
            where: { code },
            data: { uses: { increment: 1 } },
          });
        }
        return serverContract(invite.server);
      },
      { isolationLevel: 'Serializable' },
    );
  }
  async listMessages(input: { channelId: string; cursor?: string; limit: number }) {
    const rows = await db.message.findMany({
      where: { channelId: input.channelId },
      include: { author: true, attachments: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    const more = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(messageContract);
    return { items, nextCursor: more ? (items.at(-1)?.id ?? null) : null };
  }
  async searchMessages(input: { serverId: string; query: string; cursor?: string; limit: number }) {
    const rows = await db.message.findMany({
      where: {
        deletedAt: null,
        content: { contains: input.query, mode: 'insensitive' },
        channel: { serverId: input.serverId },
      },
      include: { author: true, attachments: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    const more = rows.length > input.limit;
    const items = rows.slice(0, input.limit).map(messageContract);
    return { items, nextCursor: more ? (items.at(-1)?.id ?? null) : null };
  }
  async createMessage(input: {
    channelId: string;
    authorId: string;
    content: string;
    replyToId: string | null;
    attachmentIds: string[];
    clientNonce: string;
  }): Promise<Message> {
    if (new Set(input.attachmentIds).size !== input.attachmentIds.length)
      throw new RepositoryError('ATTACHMENT_CLAIM_INVALID');
    try {
      const message = await serializable(async (tx) => {
        const existing = await tx.message.findUnique({
          where: {
            channelId_authorId_clientNonce: {
              channelId: input.channelId,
              authorId: input.authorId,
              clientNonce: input.clientNonce,
            },
          },
          include: { author: true, attachments: true },
        });
        if (existing) return existing;
        if (input.attachmentIds.length) {
          const claimable = await tx.attachment.count({
            where: {
              id: { in: input.attachmentIds },
              channelId: input.channelId,
              uploadedById: input.authorId,
              messageId: null,
              status: 'READY',
            },
          });
          if (claimable !== input.attachmentIds.length)
            throw new RepositoryError('ATTACHMENT_CLAIM_INVALID');
        }
        const created = await tx.message.create({
          data: {
            channelId: input.channelId,
            authorId: input.authorId,
            content: input.content,
            replyToId: input.replyToId,
            clientNonce: input.clientNonce,
          },
        });
        if (input.attachmentIds.length) {
          const claimed = await tx.attachment.updateMany({
            where: {
              id: { in: input.attachmentIds },
              channelId: input.channelId,
              uploadedById: input.authorId,
              messageId: null,
              status: 'READY',
            },
            data: { messageId: created.id },
          });
          if (claimed.count !== input.attachmentIds.length)
            throw new RepositoryError('ATTACHMENT_CLAIM_INVALID');
        }
        return tx.message.findUniqueOrThrow({
          where: { id: created.id },
          include: { author: true, attachments: true },
        });
      });
      return messageContract(message);
    } catch (error) {
      if (prismaErrorCode(error) !== 'P2002') throw error;
      const message = await db.message.findUnique({
        where: {
          channelId_authorId_clientNonce: {
            channelId: input.channelId,
            authorId: input.authorId,
            clientNonce: input.clientNonce,
          },
        },
        include: { author: true, attachments: true },
      });
      if (!message) throw error;
      return messageContract(message);
    }
  }
  async getMessage(id: string): Promise<Message | null> {
    const m = await db.message.findUnique({
      where: { id },
      include: { author: true, attachments: true },
    });
    return m ? messageContract(m) : null;
  }
  async updateMessage(id: string, content: string): Promise<Message> {
    const m = await db.message.update({
      where: { id },
      data: { content },
      include: { author: true, attachments: true },
    });
    return messageContract(m);
  }
  async deleteMessage(id: string): Promise<void> {
    await db.message.update({ where: { id }, data: { deletedAt: new Date() } });
  }
  async listFriendships(userId: string): Promise<Friendship[]> {
    const friendships = await db.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      include: { requester: true, addressee: true },
      orderBy: [{ requestedAt: 'desc' }, { pairKey: 'desc' }],
    });
    return friendships.map(friendshipContract);
  }

  async createFriendRequest(requesterId: string, addresseeId: string): Promise<Friendship> {
    const pairKey = canonicalPairKey(requesterId, addresseeId);
    try {
      return await serializable(async (tx) => {
        if (!(await tx.user.findUnique({ where: { id: addresseeId }, select: { id: true } })))
          throw new RepositoryError('USER_NOT_FOUND');
        if (await relationIsBlocked(tx, requesterId, addresseeId))
          throw new RepositoryError('RELATION_BLOCKED');
        if (await tx.friendship.findUnique({ where: { pairKey } }))
          throw new RepositoryError('FRIEND_REQUEST_EXISTS');
        return friendshipContract(
          await tx.friendship.create({
            data: { pairKey, requesterId, addresseeId },
            include: { requester: true, addressee: true },
          }),
        );
      });
    } catch (error) {
      if (prismaErrorCode(error) === 'P2002') throw new RepositoryError('FRIEND_REQUEST_EXISTS');
      throw error;
    }
  }

  async acceptFriendRequest(requesterId: string, addresseeId: string): Promise<Friendship> {
    const pairKey = canonicalPairKey(requesterId, addresseeId);
    return serializable(async (tx) => {
      const friendship = await tx.friendship.findUnique({
        where: { pairKey },
        include: { requester: true, addressee: true },
      });
      if (!friendship || friendship.status !== 'PENDING')
        throw new RepositoryError('FRIEND_REQUEST_NOT_FOUND');
      if (friendship.requesterId !== requesterId || friendship.addresseeId !== addresseeId)
        throw new RepositoryError('FORBIDDEN');
      if (await relationIsBlocked(tx, requesterId, addresseeId))
        throw new RepositoryError('RELATION_BLOCKED');
      return friendshipContract(
        await tx.friendship.update({
          where: { pairKey },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
          include: { requester: true, addressee: true },
        }),
      );
    });
  }

  async deleteFriendRequest(userId: string, otherUserId: string): Promise<Friendship> {
    const pairKey = canonicalPairKey(userId, otherUserId);
    return serializable(async (tx) => {
      const friendship = await tx.friendship.findUnique({
        where: { pairKey },
        include: { requester: true, addressee: true },
      });
      if (!friendship || friendship.status !== 'PENDING')
        throw new RepositoryError('FRIEND_REQUEST_NOT_FOUND');
      if (friendship.requesterId !== userId && friendship.addresseeId !== userId)
        throw new RepositoryError('FORBIDDEN');
      await tx.friendship.delete({ where: { pairKey } });
      return friendshipContract(friendship);
    });
  }

  async deleteFriendship(userId: string, otherUserId: string): Promise<Friendship> {
    const pairKey = canonicalPairKey(userId, otherUserId);
    return serializable(async (tx) => {
      const friendship = await tx.friendship.findUnique({
        where: { pairKey },
        include: { requester: true, addressee: true },
      });
      if (!friendship || friendship.status !== 'ACCEPTED')
        throw new RepositoryError('FRIENDSHIP_NOT_FOUND');
      if (friendship.requesterId !== userId && friendship.addresseeId !== userId)
        throw new RepositoryError('FORBIDDEN');
      await tx.friendship.delete({ where: { pairKey } });
      return friendshipContract(friendship);
    });
  }

  async listBlocks(userId: string): Promise<PersonalBlock[]> {
    const blocks = await db.block.findMany({
      where: { blockerId: userId },
      include: { blocked: true },
      orderBy: [{ createdAt: 'desc' }, { blockedId: 'desc' }],
    });
    return blocks.map(blockContract);
  }

  async blockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ block: PersonalBlock; removedFriendship: Friendship | null }> {
    const pairKey = canonicalPairKey(blockerId, blockedId);
    return serializable(async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: blockedId }, select: { id: true } })))
        throw new RepositoryError('USER_NOT_FOUND');
      const friendship = await tx.friendship.findUnique({
        where: { pairKey },
        include: { requester: true, addressee: true },
      });
      const block = await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
        include: { blocked: true },
      });
      if (friendship) await tx.friendship.delete({ where: { pairKey } });
      return {
        block: blockContract(block),
        removedFriendship:
          friendship && (friendship.status === 'PENDING' || friendship.status === 'ACCEPTED')
            ? friendshipContract(friendship)
            : null,
      };
    });
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<PersonalBlock> {
    canonicalPairKey(blockerId, blockedId);
    return serializable(async (tx) => {
      const block = await tx.block.findUnique({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        include: { blocked: true },
      });
      if (!block) throw new RepositoryError('BLOCK_NOT_FOUND');
      await tx.block.delete({ where: { blockerId_blockedId: { blockerId, blockedId } } });
      return blockContract(block);
    });
  }

  async listDirectConversations(userId: string): Promise<DirectConversation[]> {
    const conversations = await db.directConversation.findMany({
      where: { members: { some: { userId } } },
      include: { members: { include: { user: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return conversations.map(directConversationContract);
  }

  async getDirectConversation(conversationId: string, userId: string): Promise<DirectConversation> {
    const conversation = await db.directConversation.findFirst({
      where: { id: conversationId, members: { some: { userId } } },
      include: { members: { include: { user: true } } },
    });
    if (!conversation) throw new RepositoryError('CONVERSATION_NOT_FOUND');
    return directConversationContract(conversation);
  }

  async createDirectConversation(
    creatorId: string,
    otherUserId: string,
  ): Promise<{ conversation: DirectConversation; created: boolean }> {
    const pairKey = canonicalPairKey(creatorId, otherUserId);
    try {
      return await serializable(async (tx) => {
        if (!(await tx.user.findUnique({ where: { id: otherUserId }, select: { id: true } })))
          throw new RepositoryError('USER_NOT_FOUND');
        if (await relationIsBlocked(tx, creatorId, otherUserId))
          throw new RepositoryError('RELATION_BLOCKED');
        const friendship = await tx.friendship.findUnique({ where: { pairKey } });
        if (!friendship || friendship.status !== 'ACCEPTED')
          throw new RepositoryError('FRIENDSHIP_REQUIRED');
        const existing = await tx.directConversation.findUnique({
          where: { pairKey },
          include: { members: { include: { user: true } } },
        });
        if (existing) return { conversation: directConversationContract(existing), created: false };
        const conversation = await tx.directConversation.create({
          data: {
            pairKey,
            createdById: creatorId,
            members: { create: [{ userId: creatorId }, { userId: otherUserId }] },
          },
          include: { members: { include: { user: true } } },
        });
        return { conversation: directConversationContract(conversation), created: true };
      });
    } catch (error) {
      if (prismaErrorCode(error) !== 'P2002') throw error;
      const conversation = await db.directConversation.findUnique({
        where: { pairKey },
        include: { members: { include: { user: true } } },
      });
      if (!conversation) throw error;
      return { conversation: directConversationContract(conversation), created: false };
    }
  }

  async listDirectMessages(input: {
    conversationId: string;
    userId: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: DirectMessage[]; nextCursor: string | null }> {
    return db.$transaction(async (tx) => {
      const membership = await tx.directConversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: input.conversationId,
            userId: input.userId,
          },
        },
      });
      if (!membership) throw new RepositoryError('CONVERSATION_NOT_FOUND');
      const cursor = input.cursor
        ? await tx.directMessage.findFirst({
            where: { id: input.cursor, conversationId: input.conversationId },
            select: { id: true, createdAt: true },
          })
        : null;
      if (input.cursor && !cursor) throw new RepositoryError('DIRECT_MESSAGE_NOT_FOUND');
      const messages = await tx.directMessage.findMany({
        where: {
          conversationId: input.conversationId,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        include: { author: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
      });
      const hasMore = messages.length > input.limit;
      const items = messages.slice(0, input.limit).map(directMessageContract);
      return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
    });
  }

  async createDirectMessage(input: {
    conversationId: string;
    authorId: string;
    content: string;
    clientNonce: string;
  }): Promise<{ message: DirectMessage; created: boolean }> {
    try {
      return await serializable(async (tx) => {
        const conversation = await tx.directConversation.findUnique({
          where: { id: input.conversationId },
          include: { members: { select: { userId: true } } },
        });
        if (
          !conversation ||
          !conversation.members.some((member) => member.userId === input.authorId)
        )
          throw new RepositoryError('CONVERSATION_NOT_FOUND');
        const otherMember = conversation.members.find((member) => member.userId !== input.authorId);
        if (!otherMember) throw new RepositoryError('CONVERSATION_NOT_FOUND');
        if (await relationIsBlocked(tx, input.authorId, otherMember.userId))
          throw new RepositoryError('RELATION_BLOCKED');
        const existing = await tx.directMessage.findUnique({
          where: {
            conversationId_authorId_clientNonce: {
              conversationId: input.conversationId,
              authorId: input.authorId,
              clientNonce: input.clientNonce,
            },
          },
          include: { author: true },
        });
        if (existing) return { message: directMessageContract(existing), created: false };
        const message = await tx.directMessage.create({
          data: input,
          include: { author: true },
        });
        await tx.directConversation.update({
          where: { id: input.conversationId },
          data: { updatedAt: new Date() },
        });
        return { message: directMessageContract(message), created: true };
      });
    } catch (error) {
      if (prismaErrorCode(error) !== 'P2002') throw error;
      const message = await db.directMessage.findUnique({
        where: {
          conversationId_authorId_clientNonce: {
            conversationId: input.conversationId,
            authorId: input.authorId,
            clientNonce: input.clientNonce,
          },
        },
        include: { author: true },
      });
      if (!message) throw error;
      return { message: directMessageContract(message), created: false };
    }
  }

  async updateDirectMessage(
    messageId: string,
    actorId: string,
    content: string,
  ): Promise<DirectMessage> {
    return serializable(async (tx) => {
      const message = await tx.directMessage.findUnique({
        where: { id: messageId },
        include: { author: true, conversation: { include: { members: true } } },
      });
      if (!message) throw new RepositoryError('DIRECT_MESSAGE_NOT_FOUND');
      if (!message.conversation.members.some((member) => member.userId === actorId))
        throw new RepositoryError('CONVERSATION_NOT_FOUND');
      if (message.authorId !== actorId) throw new RepositoryError('FORBIDDEN');
      if (message.deletedAt) throw new RepositoryError('DIRECT_MESSAGE_NOT_FOUND');
      return directMessageContract(
        await tx.directMessage.update({
          where: { id: messageId },
          data: { content },
          include: { author: true },
        }),
      );
    });
  }

  async deleteDirectMessage(messageId: string, actorId: string): Promise<DirectMessage> {
    return serializable(async (tx) => {
      const message = await tx.directMessage.findUnique({
        where: { id: messageId },
        include: { author: true, conversation: { include: { members: true } } },
      });
      if (!message) throw new RepositoryError('DIRECT_MESSAGE_NOT_FOUND');
      if (!message.conversation.members.some((member) => member.userId === actorId))
        throw new RepositoryError('CONVERSATION_NOT_FOUND');
      if (message.authorId !== actorId) throw new RepositoryError('FORBIDDEN');
      if (message.deletedAt) return directMessageContract(message);
      return directMessageContract(
        await tx.directMessage.update({
          where: { id: messageId },
          data: { deletedAt: new Date() },
          include: { author: true },
        }),
      );
    });
  }
  async createAttachment(input: CreateAttachmentRecord): Promise<AttachmentRecord> {
    return attachmentRecord(
      await db.attachment.create({
        data: {
          id: input.id,
          channelId: input.channelId,
          uploadedById: input.userId,
          storageKey: input.storageKey,
          filename: input.filename,
          mimeType: input.mimeType,
          size: input.size,
        },
      }),
    );
  }
  async getAttachment(id: string): Promise<AttachmentRecord | null> {
    const attachment = await db.attachment.findUnique({ where: { id } });
    return attachment ? attachmentRecord(attachment) : null;
  }
  async markAttachmentReady(id: string, userId: string): Promise<AttachmentRecord | null> {
    return db.$transaction(async (tx) => {
      const updated = await tx.attachment.updateMany({
        where: { id, uploadedById: userId, messageId: null, status: 'PENDING' },
        data: { status: 'READY' },
      });
      if (updated.count !== 1) return null;
      return attachmentRecord(await tx.attachment.findUniqueOrThrow({ where: { id } }));
    });
  }
  async listRoles(serverId: string): Promise<Role[]> {
    const roles = await db.role.findMany({
      where: { serverId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return roles.map(roleContract);
  }
  async listRoleMemberIds(serverId: string, roleId: string): Promise<string[]> {
    const assignments = await db.serverMemberRole.findMany({
      where: { serverId, roleId },
      select: { userId: true },
    });
    return assignments.map((assignment) => assignment.userId);
  }
  async listMemberRoles(serverId: string, userId: string): Promise<Role[]> {
    const member = await db.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      select: { userId: true },
    });
    if (!member) throw new RepositoryError('MEMBER_NOT_FOUND');
    const assignments = await db.serverMemberRole.findMany({
      where: { serverId, userId },
      include: { role: true },
      orderBy: { role: { position: 'asc' } },
    });
    return assignments.map((assignment) => roleContract(assignment.role));
  }
  async createRole(input: {
    serverId: string;
    actorId: string;
    name: string;
    permissions: number;
    color: string | null;
    position?: number;
  }): Promise<Role> {
    assertKnownPermissions(input.permissions);
    if (input.name === '@everyone' || input.name === 'Owner')
      throw new RepositoryError('PROTECTED_ROLE');
    return db.$transaction(async (tx) => {
      const actor = await memberAuthority(
        tx,
        input.serverId,
        input.actorId,
        Permission.MANAGE_ROLES,
      );
      const highestRole = await tx.role.findFirst({
        where: { serverId: input.serverId },
        orderBy: { position: 'desc' },
      });
      const position =
        input.position ??
        (actor.isOwner ? (highestRole?.position ?? 0) + 1 : Math.max(0, actor.highestPosition - 1));
      if (!actor.isOwner && position >= actor.highestPosition)
        throw new RepositoryError('ROLE_HIERARCHY');
      if (!actor.isOwner && (input.permissions & ~actor.permissions) !== 0)
        throw new RepositoryError('ROLE_HIERARCHY');
      const role = await tx.role.create({
        data: {
          serverId: input.serverId,
          name: input.name,
          permissions: input.permissions,
          color: input.color,
          position,
        },
      });
      await tx.auditLog.create({
        data: {
          serverId: input.serverId,
          actorId: input.actorId,
          action: 'ROLE_CREATE',
          targetType: 'ROLE',
          targetId: role.id,
          metadata: { name: role.name, permissions: role.permissions },
        },
      });
      return roleContract(role);
    });
  }
  async updateRole(input: {
    serverId: string;
    roleId: string;
    actorId: string;
    name?: string;
    permissions?: number;
    color?: string | null;
    position?: number;
  }): Promise<Role> {
    if (input.permissions !== undefined) assertKnownPermissions(input.permissions);
    if (input.name === '@everyone' || input.name === 'Owner')
      throw new RepositoryError('PROTECTED_ROLE');
    return db.$transaction(async (tx) => {
      const actor = await memberAuthority(
        tx,
        input.serverId,
        input.actorId,
        Permission.MANAGE_ROLES,
      );
      const current = await tx.role.findFirst({
        where: { id: input.roleId, serverId: input.serverId },
      });
      if (!current) throw new RepositoryError('ROLE_NOT_FOUND');
      if (current.name === '@everyone' || current.name === 'Owner')
        throw new RepositoryError('PROTECTED_ROLE');
      const nextPosition = input.position ?? current.position;
      if (
        !actor.isOwner &&
        (current.position >= actor.highestPosition || nextPosition >= actor.highestPosition)
      )
        throw new RepositoryError('ROLE_HIERARCHY');
      if (
        !actor.isOwner &&
        input.permissions !== undefined &&
        (input.permissions & ~actor.permissions) !== 0
      )
        throw new RepositoryError('ROLE_HIERARCHY');
      const role = await tx.role.update({
        where: { id: current.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          serverId: input.serverId,
          actorId: input.actorId,
          action: 'ROLE_UPDATE',
          targetType: 'ROLE',
          targetId: role.id,
          metadata: { name: role.name, permissions: role.permissions },
        },
      });
      return roleContract(role);
    });
  }
  async deleteRole(serverId: string, roleId: string, actorId: string): Promise<void> {
    await db.$transaction(async (tx) => {
      const actor = await memberAuthority(tx, serverId, actorId, Permission.MANAGE_ROLES);
      const role = await tx.role.findFirst({ where: { id: roleId, serverId } });
      if (!role) throw new RepositoryError('ROLE_NOT_FOUND');
      if (role.name === '@everyone' || role.name === 'Owner')
        throw new RepositoryError('PROTECTED_ROLE');
      if (!actor.isOwner && role.position >= actor.highestPosition)
        throw new RepositoryError('ROLE_HIERARCHY');
      await tx.role.delete({ where: { id: role.id } });
      await tx.auditLog.create({
        data: {
          serverId,
          actorId,
          action: 'ROLE_DELETE',
          targetType: 'ROLE',
          targetId: role.id,
          metadata: { name: role.name },
        },
      });
    });
  }
  async assignMemberRoles(input: {
    serverId: string;
    userId: string;
    actorId: string;
    roleIds: string[];
  }): Promise<Role[]> {
    return db.$transaction(async (tx) => {
      const actor = await memberAuthority(
        tx,
        input.serverId,
        input.actorId,
        Permission.MANAGE_ROLES,
      );
      const target = await memberAuthority(tx, input.serverId, input.userId);
      const server = await tx.server.findUnique({ where: { id: input.serverId } });
      if (!server) throw new RepositoryError('MEMBER_NOT_FOUND');
      if (server.ownerId === input.userId) throw new RepositoryError('OWNER_PROTECTED');
      if (!actor.isOwner && target.highestPosition >= actor.highestPosition)
        throw new RepositoryError('ROLE_HIERARCHY');
      const requestedRoles = await tx.role.findMany({
        where: { serverId: input.serverId, id: { in: [...new Set(input.roleIds)] } },
      });
      if (requestedRoles.length !== new Set(input.roleIds).size)
        throw new RepositoryError('ROLE_NOT_FOUND');
      const existingAssignments = await tx.serverMemberRole.findMany({
        where: { serverId: input.serverId, userId: input.userId },
        select: { roleId: true },
      });
      const existingRoleIds = new Set(existingAssignments.map((assignment) => assignment.roleId));
      if (requestedRoles.some((role) => role.name === 'Owner'))
        throw new RepositoryError('PROTECTED_ROLE');
      if (
        !actor.isOwner &&
        requestedRoles.some(
          (role) =>
            role.position >= actor.highestPosition ||
            (!existingRoleIds.has(role.id) && (role.permissions & ~actor.permissions) !== 0),
        )
      )
        throw new RepositoryError('ROLE_HIERARCHY');
      const everyone = await tx.role.findUnique({
        where: { serverId_name: { serverId: input.serverId, name: '@everyone' } },
      });
      if (!everyone) throw new RepositoryError('ROLE_NOT_FOUND');
      const roles = [everyone, ...requestedRoles.filter((role) => role.id !== everyone.id)];
      await tx.serverMemberRole.deleteMany({
        where: { serverId: input.serverId, userId: input.userId },
      });
      await tx.serverMemberRole.createMany({
        data: roles.map((role) => ({
          serverId: input.serverId,
          userId: input.userId,
          roleId: role.id,
        })),
      });
      await tx.auditLog.create({
        data: {
          serverId: input.serverId,
          actorId: input.actorId,
          action: 'MEMBER_ROLES_UPDATE',
          targetType: 'USER',
          targetId: input.userId,
          metadata: { roleIds: roles.map((role) => role.id) },
        },
      });
      return roles.map(roleContract);
    });
  }
  async moderateMember(input: {
    serverId: string;
    actorId: string;
    userId: string;
    action: 'KICK' | 'BAN';
    reason?: string;
  }): Promise<AuditLog> {
    return db.$transaction(async (tx) => {
      const required = input.action === 'BAN' ? Permission.BAN_MEMBERS : Permission.KICK_MEMBERS;
      const actor = await memberAuthority(tx, input.serverId, input.actorId, required);
      const target = await memberAuthority(tx, input.serverId, input.userId);
      if (input.actorId === input.userId) throw new RepositoryError('SELF_MODERATION');
      const server = await tx.server.findUnique({ where: { id: input.serverId } });
      if (!server || server.ownerId === input.userId) throw new RepositoryError('OWNER_PROTECTED');
      if (!actor.isOwner && target.highestPosition >= actor.highestPosition)
        throw new RepositoryError('ROLE_HIERARCHY');
      if (input.action === 'BAN') {
        await tx.ban.upsert({
          where: {
            serverId_userId: { serverId: input.serverId, userId: input.userId },
          },
          create: {
            serverId: input.serverId,
            userId: input.userId,
            bannedById: input.actorId,
            reason: input.reason ?? null,
          },
          update: { bannedById: input.actorId, reason: input.reason ?? null },
        });
      }
      await tx.serverMember.delete({
        where: {
          serverId_userId: { serverId: input.serverId, userId: input.userId },
        },
      });
      const audit = await tx.auditLog.create({
        data: {
          serverId: input.serverId,
          actorId: input.actorId,
          action: input.action,
          targetType: 'USER',
          targetId: input.userId,
          metadata: { reason: input.reason ?? null },
        },
      });
      return auditContract(audit);
    });
  }
  async listBans(serverId: string): Promise<Ban[]> {
    const bans = await db.ban.findMany({
      where: { serverId },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
    });
    return bans.map(banContract);
  }
  async unbanMember(serverId: string, userId: string, actorId: string): Promise<void> {
    await db.$transaction(async (tx) => {
      await memberAuthority(tx, serverId, actorId, Permission.BAN_MEMBERS);
      const deleted = await tx.ban.deleteMany({ where: { serverId, userId } });
      if (deleted.count !== 1) throw new RepositoryError('BAN_NOT_FOUND');
      await tx.auditLog.create({
        data: {
          serverId,
          actorId,
          action: 'UNBAN',
          targetType: 'USER',
          targetId: userId,
          metadata: {},
        },
      });
    });
  }
  async createReport(input: {
    reporterId: string;
    serverId?: string;
    messageId?: string;
    targetUserId?: string;
    reason: string;
  }): Promise<Report> {
    return db.$transaction(async (tx) => {
      let serverId = input.serverId;
      let targetUserId = input.targetUserId;
      if (input.messageId) {
        const message = await tx.message.findUnique({
          where: { id: input.messageId },
          include: { channel: true },
        });
        if (!message) throw new RepositoryError('REPORT_NOT_FOUND');
        if (serverId && serverId !== message.channel.serverId)
          throw new RepositoryError('REPORT_NOT_FOUND');
        serverId = message.channel.serverId;
        if (targetUserId && targetUserId !== message.authorId)
          throw new RepositoryError('REPORT_NOT_FOUND');
        targetUserId = message.authorId;
      }
      if (serverId) {
        await memberAuthority(tx, serverId, input.reporterId, Permission.VIEW_CHANNEL);
        if (targetUserId && !input.messageId) await memberAuthority(tx, serverId, targetUserId);
      }
      const report = await tx.report.create({
        data: {
          reporterId: input.reporterId,
          serverId: serverId ?? null,
          messageId: input.messageId ?? null,
          targetUserId: targetUserId ?? null,
          reason: input.reason,
        },
      });
      if (serverId) {
        await tx.auditLog.create({
          data: {
            serverId,
            actorId: input.reporterId,
            action: 'REPORT_CREATE',
            targetType: 'REPORT',
            targetId: report.id,
            metadata: {
              messageId: input.messageId ?? null,
              targetUserId: targetUserId ?? null,
            },
          },
        });
      }
      return reportContract(report);
    });
  }
  async listReports(input: {
    serverId: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: Report[]; nextCursor: string | null }> {
    const reports = await db.report.findMany({
      where: { serverId: input.serverId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    const hasMore = reports.length > input.limit;
    const items = reports.slice(0, input.limit).map(reportContract);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }
  async updateReport(input: {
    serverId: string;
    actorId: string;
    reportId: string;
    status: ReportStatus;
    resolution?: string;
  }): Promise<Report> {
    return db.$transaction(async (tx) => {
      await memberAuthority(tx, input.serverId, input.actorId, Permission.MANAGE_SERVER);
      const existing = await tx.report.findFirst({
        where: { id: input.reportId, serverId: input.serverId },
      });
      if (!existing) throw new RepositoryError('REPORT_NOT_FOUND');
      const terminal = input.status === 'RESOLVED' || input.status === 'DISMISSED';
      const report = await tx.report.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          resolution: input.resolution ?? null,
          resolvedAt: terminal ? new Date() : null,
        },
      });
      await tx.auditLog.create({
        data: {
          serverId: input.serverId,
          actorId: input.actorId,
          action: 'REPORT_UPDATE',
          targetType: 'REPORT',
          targetId: report.id,
          metadata: { status: report.status, resolution: report.resolution },
        },
      });
      return reportContract(report);
    });
  }
  async listAudit(input: {
    serverId: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: AuditLog[]; nextCursor: string | null }> {
    const audits = await db.auditLog.findMany({
      where: { serverId: input.serverId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    const hasMore = audits.length > input.limit;
    const items = audits.slice(0, input.limit).map(auditContract);
    return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
  }
}
