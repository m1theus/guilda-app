import type { Server as HttpServer } from 'node:http';
import {
  Permission,
  type Channel,
  type Message,
  type PresenceStatus,
  type ServerMember,
} from '@guilda/types';
import { Server, type Socket } from 'socket.io';
import {
  type AccessTokenVerifier,
  type CommandAcknowledgement,
  type MessageCreatedAcknowledgement,
  type MessageDeletedAcknowledgement,
  type MessageUpdatedAcknowledgement,
  type RealtimeDatabase,
  type RealtimeMembership,
  type RealtimeStatus,
  realtimeError,
} from './contracts.js';
import { isRealtimeStatus } from './presence.js';
import type { PresenceStore } from './presence.js';
import { RepositoryError } from '../repository.js';
const MAX_MESSAGE_LENGTH = 4_000;
const TYPING_THROTTLE_MS = 1_000;
const CHANNEL_ROOM_PREFIX = 'channel:';
const SERVER_ROOM_PREFIX = 'server:';
const USER_ROOM_PREFIX = 'user:';

export const channelRoom = (channelId: string): string => `${CHANNEL_ROOM_PREFIX}${channelId}`;
export const serverRoom = (serverId: string): string => `${SERVER_ROOM_PREFIX}${serverId}`;
export const userRoom = (userId: string): string => `${USER_ROOM_PREFIX}${userId}`;

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
    sessionId: string;
    memberships: Map<string, RealtimeMembership>;
  };
}

type Acknowledge<T> = (result: CommandAcknowledgement<T>) => void;

type MessageCreatePayload = {
  channelId: string;
  content: string;
  replyToId?: string;
  attachmentIds?: string[];
  clientNonce: string;
};

type MessageUpdatePayload = { messageId: string; content: string };
type MessageDeletePayload = { messageId: string };
type TypingPayload = { channelId: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const stringField = (value: unknown, key: string): string | null => {
  if (!isRecord(value) || typeof value[key] !== 'string') return null;
  return value[key] as string;
};
const isMessageCreatePayload = (value: unknown): value is MessageCreatePayload => {
  const channelId = stringField(value, 'channelId');
  const content = stringField(value, 'content');
  const clientNonce = stringField(value, 'clientNonce');
  if (!channelId || content === null || !clientNonce || content.length > MAX_MESSAGE_LENGTH)
    return false;
  if (!isRecord(value)) return false;
  const { replyToId, attachmentIds } = value;
  if (replyToId !== undefined && typeof replyToId !== 'string') return false;
  if (
    attachmentIds !== undefined &&
    (!Array.isArray(attachmentIds) ||
      attachmentIds.length > 10 ||
      !attachmentIds.every((id) => typeof id === 'string' && id.length > 0))
  )
    return false;
  return content.trim().length > 0 || (Array.isArray(attachmentIds) && attachmentIds.length > 0);
};
const isMessageUpdatePayload = (value: unknown): value is MessageUpdatePayload => {
  const messageId = stringField(value, 'messageId');
  const content = stringField(value, 'content');
  return Boolean(messageId && content && content.length <= MAX_MESSAGE_LENGTH);
};
const isMessageDeletePayload = (value: unknown): value is MessageDeletePayload =>
  Boolean(stringField(value, 'messageId'));
const isTypingPayload = (value: unknown): value is TypingPayload =>
  Boolean(stringField(value, 'channelId'));

const ack = <T>(callback: unknown, result: CommandAcknowledgement<T>): void => {
  if (typeof callback === 'function') (callback as Acknowledge<T>)(result);
};

const errorFromUnknown = (error: unknown): { code: string; message: string } => {
  if (error instanceof Error && error.message === 'NOT_FOUND') {
    return realtimeError('NOT_FOUND', 'The requested resource does not exist.');
  }
  if (error instanceof RepositoryError && error.code === 'ATTACHMENT_CLAIM_INVALID') {
    return realtimeError('INVALID_ATTACHMENT', 'One or more attachments cannot be claimed.');
  }
  return realtimeError('INTERNAL_ERROR', 'The command could not be completed.');
};

export interface RealtimeServerOptions {
  database: RealtimeDatabase;
  tokenVerifier: AccessTokenVerifier;
  presence: PresenceStore;
  corsOrigin?: string | string[] | undefined;
}

export interface RealtimeServer {
  io: Server;
  close(): Promise<void>;
  emitPresence(userId: string, status: PresenceStatus): void;
  emitChannelCreated(channel: Channel): void;
  emitMessageCreated(message: Message, clientNonce: string, channel: Channel): void;
  emitMessageUpdated(message: Message): void;
  emitMessageDeleted(messageId: string, channelId: string, deletedAt: string): void;
  emitMemberJoined(member: ServerMember): void;
  emitMemberLeft(serverId: string, userId: string): void;
  refreshMemberAuthorization(serverId: string, userId: string): Promise<void>;
}

export const createRealtimeServer = (
  httpServer: HttpServer,
  options: RealtimeServerOptions,
): RealtimeServer => {
  const io = new Server(
    httpServer,
    options.corsOrigin ? { cors: { origin: options.corsOrigin, credentials: true } } : {},
  );
  const typingTimes = new Map<string, number>();
  const membershipsByUser = new Map<string, Map<string, RealtimeMembership>>();

  io.use(async (socket, next) => {
    try {
      const token = accessTokenFromHandshake(
        socket.handshake.auth,
        socket.handshake.headers.authorization,
      );
      if (!token) return next(new Error('UNAUTHORIZED'));
      const principal = await options.tokenVerifier.verifyAccessToken(token);
      if (!principal?.userId || !principal.sessionId) return next(new Error('UNAUTHORIZED'));
      socket.data.userId = principal.userId;
      socket.data.sessionId = principal.sessionId;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (rawSocket) => {
    void initializeSocket(rawSocket as AuthenticatedSocket).catch(() => {
      rawSocket.disconnect(true);
    });
  });

  const initializeSocket = async (socket: AuthenticatedSocket): Promise<void> => {
    // Fetch every membership and channel before joining any room. Payload IDs are
    // never used to select a server or to establish authorization.
    const loadedMemberships = await options.database.listMemberships(socket.data.userId);
    const memberships = new Map<string, RealtimeMembership>();
    for (const membership of loadedMemberships) {
      if (membership.userId === socket.data.userId)
        memberships.set(membership.serverId, membership);
    }
    const serverChannels = await Promise.all(
      [...memberships.values()].map(async (membership) => ({
        serverId: membership.serverId,
        channels: await options.database.listChannels(membership.serverId, membership.userId),
      })),
    );
    socket.data.memberships = memberships;
    membershipsByUser.set(socket.data.userId, memberships);
    await socket.join(userRoom(socket.data.userId));
    for (const { serverId, channels } of serverChannels) {
      await socket.join(serverRoom(serverId));
      for (const channel of channels) {
        if (channel.serverId === serverId) await socket.join(channelRoom(channel.id));
      }
    }
    await options.presence.connect(socket.data.userId);
    registerHandlers(socket);
    socket.once('disconnect', () => {
      for (const key of [...typingTimes.keys()]) {
        if (key.startsWith(`${socket.id}:`)) typingTimes.delete(key);
      }
      options.presence.disconnect(socket.data.userId);
    });
  };

  const registerHandlers = (socket: AuthenticatedSocket): void => {
    socket.on('message:create', async (payload: unknown, callback?: unknown) => {
      if (!isMessageCreatePayload(payload)) {
        ack(callback, realtimeError('INVALID_PAYLOAD', 'A valid message payload is required.'));
        return;
      }
      try {
        const channel = await options.database.getChannel(payload.channelId);
        if (!channel) {
          ack(callback, realtimeError('NOT_FOUND', 'The channel does not exist.'));
          return;
        }
        const membershipError = await authorizeChannel(
          options.database,
          socket,
          channel,
          Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES,
        );
        if (membershipError) {
          ack(callback, membershipError);
          return;
        }
        const message = await options.database.createMessage({
          channelId: channel.id,
          authorId: socket.data.userId,
          content: payload.content,
          ...(payload.replyToId ? { replyToId: payload.replyToId } : {}),
          ...(payload.attachmentIds ? { attachmentIds: payload.attachmentIds } : {}),
          clientNonce: payload.clientNonce,
        });
        const result: MessageCreatedAcknowledgement = { message, clientNonce: payload.clientNonce };
        io.to(channelRoom(channel.id)).emit('message:create', {
          ...result,
          serverId: channel.serverId,
          channelName: channel.name,
        });
        ack(callback, result);
      } catch (error) {
        ack(callback, errorFromUnknown(error));
      }
    });

    socket.on('message:update', async (payload: unknown, callback?: unknown) => {
      if (!isMessageUpdatePayload(payload)) {
        ack(callback, realtimeError('INVALID_PAYLOAD', 'A valid message payload is required.'));
        return;
      }
      try {
        const existing = await options.database.getMessage(payload.messageId);
        if (!existing) {
          ack(callback, realtimeError('NOT_FOUND', 'The message does not exist.'));
          return;
        }
        const channel = await options.database.getChannel(existing.channelId);
        if (!channel) {
          ack(callback, realtimeError('NOT_FOUND', 'The channel does not exist.'));
          return;
        }
        const membershipError = await authorizeChannel(
          options.database,
          socket,
          channel,
          Permission.VIEW_CHANNEL,
        );
        if (membershipError) {
          ack(callback, membershipError);
          return;
        }
        const membership = socket.data.memberships.get(channel.serverId);
        if (
          existing.authorId !== socket.data.userId &&
          !hasPermission(membership, Permission.MANAGE_MESSAGES)
        ) {
          ack(callback, realtimeError('FORBIDDEN', 'You cannot update this message.'));
          return;
        }
        const message = await options.database.updateMessage({
          messageId: payload.messageId,
          actorId: socket.data.userId,
          content: payload.content,
        });
        if (!message) {
          ack(callback, realtimeError('NOT_FOUND', 'The message does not exist.'));
          return;
        }
        const result: MessageUpdatedAcknowledgement = { message };
        io.to(channelRoom(channel.id)).emit('message:update', result);
        ack(callback, result);
      } catch (error) {
        ack(callback, errorFromUnknown(error));
      }
    });

    socket.on('message:delete', async (payload: unknown, callback?: unknown) => {
      if (!isMessageDeletePayload(payload)) {
        ack(callback, realtimeError('INVALID_PAYLOAD', 'A valid message payload is required.'));
        return;
      }
      try {
        const existing = await options.database.getMessage(payload.messageId);
        if (!existing) {
          ack(callback, realtimeError('NOT_FOUND', 'The message does not exist.'));
          return;
        }
        const channel = await options.database.getChannel(existing.channelId);
        if (!channel) {
          ack(callback, realtimeError('NOT_FOUND', 'The channel does not exist.'));
          return;
        }
        const membershipError = await authorizeChannel(
          options.database,
          socket,
          channel,
          Permission.VIEW_CHANNEL,
        );
        if (membershipError) {
          ack(callback, membershipError);
          return;
        }
        const membership = socket.data.memberships.get(channel.serverId);
        if (
          existing.authorId !== socket.data.userId &&
          !hasPermission(membership, Permission.MANAGE_MESSAGES)
        ) {
          ack(callback, realtimeError('FORBIDDEN', 'You cannot delete this message.'));
          return;
        }
        const deletedAt = new Date();
        const deleted = await options.database.deleteMessage({
          messageId: payload.messageId,
          actorId: socket.data.userId,
          deletedAt,
        });
        if (!deleted) {
          ack(callback, realtimeError('NOT_FOUND', 'The message does not exist.'));
          return;
        }
        const result: MessageDeletedAcknowledgement = {
          messageId: deleted.messageId,
          channelId: deleted.channelId,
          deletedAt: deleted.deletedAt.toISOString(),
        };
        io.to(channelRoom(deleted.channelId)).emit('message:delete', result);
        ack(callback, result);
      } catch (error) {
        ack(callback, errorFromUnknown(error));
      }
    });

    socket.on('typing:start', async (payload: unknown, callback?: unknown) => {
      await handleTyping(socket, payload, 'typing:start', callback);
    });
    socket.on('typing:stop', async (payload: unknown, callback?: unknown) => {
      await handleTyping(socket, payload, 'typing:stop', callback);
    });
    socket.on('presence:update', async (payload: unknown, callback?: unknown) => {
      const status = isRecord(payload) ? payload.status : undefined;
      if (!isRealtimeStatus(status)) {
        ack(callback, realtimeError('INVALID_PAYLOAD', 'Presence must be ONLINE, IDLE, or DND.'));
        return;
      }
      try {
        const changed = await options.presence.setClientStatus(socket.data.userId, status);
        if (!changed) {
          ack(callback, realtimeError('INVALID_PAYLOAD', 'Presence must be ONLINE, IDLE, or DND.'));
          return;
        }
        ack<{ status: RealtimeStatus }>(callback, { status });
      } catch {
        ack(callback, realtimeError('INTERNAL_ERROR', 'Presence could not be updated.'));
      }
    });
  };

  const handleTyping = async (
    socket: AuthenticatedSocket,
    payload: unknown,
    event: 'typing:start' | 'typing:stop',
    callback: unknown,
  ): Promise<void> => {
    if (!isTypingPayload(payload)) {
      ack(callback, realtimeError('INVALID_PAYLOAD', 'A channel id is required.'));
      return;
    }
    try {
      const channel = await options.database.getChannel(payload.channelId);
      if (!channel) {
        ack(callback, realtimeError('NOT_FOUND', 'The channel does not exist.'));
        return;
      }
      const membershipError = await authorizeChannel(
        options.database,
        socket,
        channel,
        Permission.VIEW_CHANNEL,
      );
      if (membershipError) {
        ack(callback, membershipError);
        return;
      }
      const key = `${socket.id}:${channel.id}:${event}`;
      const now = Date.now();
      const previous = typingTimes.get(key) ?? 0;
      if (now - previous < TYPING_THROTTLE_MS) {
        ack(callback, realtimeError('RATE_LIMITED', 'Typing updates are throttled.'));
        return;
      }
      typingTimes.set(key, now);
      const payloadOut = { channelId: channel.id, userId: socket.data.userId };
      io.to(channelRoom(channel.id)).except(socket.id).emit(event, payloadOut);
      ack(callback, { ok: true });
    } catch (error) {
      ack(callback, errorFromUnknown(error));
    }
  };

  return {
    io,
    async close(): Promise<void> {
      await options.presence.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
    emitPresence(userId: string, status: PresenceStatus): void {
      const memberships = membershipsByUser.get(userId);
      if (!memberships) return;
      const event = { userId, status };
      for (const serverId of memberships.keys()) {
        io.to(serverRoom(serverId)).emit('presence:update', event);
      }
    },
    emitMessageCreated(message: Message, clientNonce: string, channel: Channel): void {
      io.to(channelRoom(message.channelId)).emit('message:create', {
        message,
        clientNonce,
        serverId: channel.serverId,
        channelName: channel.name,
      });
    },
    emitMessageUpdated(message: Message): void {
      io.to(channelRoom(message.channelId)).emit('message:update', { message });
    },
    emitMessageDeleted(messageId: string, channelId: string, deletedAt: string): void {
      io.to(channelRoom(channelId)).emit('message:delete', { messageId, channelId, deletedAt });
    },
    emitChannelCreated(channel: Channel): void {
      io.to(serverRoom(channel.serverId)).emit('channel:create', channel);
    },
    emitMemberJoined(member: ServerMember): void {
      io.to(serverRoom(member.serverId)).emit('member:join', member);
    },
    emitMemberLeft(serverId: string, userId: string): void {
      io.to(serverRoom(serverId)).emit('member:leave', { serverId, userId });
    },
    async refreshMemberAuthorization(serverId: string, userId: string): Promise<void> {
      const [membership, channels] = await Promise.all([
        options.database.getMembership(serverId, userId),
        options.database.listChannels(serverId, userId),
      ]);
      const rooms = [
        serverRoom(serverId),
        ...channels
          .filter((channel) => channel.serverId === serverId)
          .map((channel) => channelRoom(channel.id)),
      ];
      if (membership) io.in(userRoom(userId)).socketsJoin(rooms);
      else io.in(userRoom(userId)).socketsLeave(rooms);
      const cached = membershipsByUser.get(userId);
      if (membership) cached?.set(serverId, membership);
      else cached?.delete(serverId);
      for (const rawSocket of io.sockets.sockets.values()) {
        const socket = rawSocket as AuthenticatedSocket;
        if (socket.data.userId !== userId || !socket.data.memberships) continue;
        if (membership) socket.data.memberships.set(serverId, membership);
        else socket.data.memberships.delete(serverId);
      }
      if (membership) {
        io.to(serverRoom(serverId)).emit('member:update', {
          serverId,
          userId,
          permissions: membership.permissions,
        });
      } else {
        io.to(serverRoom(serverId)).emit('member:leave', { serverId, userId });
      }
    },
  };
};

const accessTokenFromHandshake = (
  auth: unknown,
  authorization: string | string[] | undefined,
): string | null => {
  if (isRecord(auth) && typeof auth.accessToken === 'string' && auth.accessToken.length > 0) {
    return auth.accessToken;
  }
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
};

const hasPermission = (membership: RealtimeMembership | undefined, permission: number): boolean =>
  Boolean(membership && (membership.permissions & permission) === permission);

const authorizeChannel = async (
  database: Pick<RealtimeDatabase, 'getMembership'>,
  socket: Pick<AuthenticatedSocket, 'data'>,
  channel: { id: string; serverId: string } | null,
  permission: number,
): Promise<{ code: string; message: string } | null> => {
  if (!channel) return realtimeError('NOT_FOUND', 'The channel does not exist.');
  const membership = await database.getMembership(channel.serverId, socket.data.userId);
  if (!membership || membership.userId !== socket.data.userId) {
    return realtimeError('FORBIDDEN', 'You are not a member of this server.');
  }
  socket.data.memberships.set(channel.serverId, membership);
  if (!hasPermission(membership, permission)) {
    return realtimeError('FORBIDDEN', 'You do not have permission for this channel.');
  }
  return null;
};

export { accessTokenFromHandshake, authorizeChannel };
