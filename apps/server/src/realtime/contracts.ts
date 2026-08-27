import type {
  Channel,
  Message,
  PermissionBitfield,
  PresenceStatus,
  ServerMember,
} from '@guilda/types';

export interface RealtimeMembership {
  serverId: string;
  userId: string;
  permissions: PermissionBitfield;
  member?: ServerMember;
}

export interface RealtimeChannel {
  id: string;
  serverId: string;
  name: string;
}

export interface RealtimeMessageUpdate {
  messageId: string;
  content: string;
}

export interface RealtimeDatabase {
  /** Must query memberships using the authenticated user id, never a socket payload. */
  listMemberships(userId: string): Promise<readonly RealtimeMembership[]>;
  getMembership(serverId: string, userId: string): Promise<RealtimeMembership | null>;
  listChannels(serverId: string, userId: string): Promise<readonly RealtimeChannel[]>;
  getChannel(channelId: string): Promise<RealtimeChannel | null>;
  getMessage(messageId: string): Promise<Message | null>;
  createMessage(input: {
    channelId: string;
    authorId: string;
    content: string;
    replyToId?: string;
    attachmentIds?: readonly string[];
    clientNonce: string;
  }): Promise<Message>;
  updateMessage(input: {
    messageId: string;
    actorId: string;
    content: string;
  }): Promise<Message | null>;
  deleteMessage(input: {
    messageId: string;
    actorId: string;
    deletedAt: Date;
  }): Promise<{ messageId: string; channelId: string; deletedAt: Date } | null>;
}

export interface AccessTokenPrincipal {
  userId: string;
  sessionId: string;
}

export interface AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AccessTokenPrincipal | null>;
}

export interface RedisPresenceClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: readonly unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  quit?(): Promise<unknown>;
}

export type RealtimeStatus = Exclude<PresenceStatus, 'OFFLINE'>;

export interface RealtimeError {
  code: string;
  message: string;
}

export interface MessageCreatedAcknowledgement {
  message: Message;
  clientNonce: string;
}

export interface MessageUpdatedAcknowledgement {
  message: Message;
}

export interface MessageDeletedAcknowledgement {
  messageId: string;
  channelId: string;
  deletedAt: string;
}

export type CommandAcknowledgement<T> = T | RealtimeError;

export type RealtimeChannelCreatedPayload = Channel;

export const realtimeError = (code: string, message: string): RealtimeError => ({ code, message });
