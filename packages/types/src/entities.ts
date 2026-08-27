export type ISODateString = string;
export type EntityId = string;

export type PresenceStatus = 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';
export type ChannelType = 'TEXT' | 'VOICE';

export const Permission = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  MANAGE_SERVER: 1 << 4,
  KICK_MEMBERS: 1 << 5,
  BAN_MEMBERS: 1 << 6,
  MANAGE_ROLES: 1 << 7,
  CONNECT: 1 << 8,
  SPEAK: 1 << 9,
  STREAM: 1 << 10,
} as const;

export type PermissionName = keyof typeof Permission;
export type PermissionBitfield = number;
export const ALL_PERMISSIONS = Object.values(Permission).reduce(
  (mask, permission) => mask | permission,
  0,
);

export const DEFAULT_EVERYONE_PERMISSIONS =
  Permission.VIEW_CHANNEL |
  Permission.SEND_MESSAGES |
  Permission.CONNECT |
  Permission.SPEAK |
  Permission.STREAM;

export interface User {
  id: EntityId;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  pronouns: string | null;
  bio: string | null;
  bannerUrl: string | null;
  profileColor: string | null;
  status: PresenceStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface GuildServer {
  id: EntityId;
  name: string;
  iconUrl: string | null;
  ownerId: EntityId;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
export interface Role {
  id: EntityId;
  serverId: EntityId;
  name: string;
  permissions: PermissionBitfield;
  color: string | null;
  position: number;
  createdAt: ISODateString;
}

export type ModerationAction = 'KICK' | 'BAN';
export type ReportStatus = 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';
export type AuditTargetType = 'USER' | 'ROLE' | 'REPORT';

export interface Ban {
  serverId: EntityId;
  userId: EntityId;
  bannedById: EntityId;
  reason: string | null;
  expiresAt: ISODateString | null;
  createdAt: ISODateString;
  user: User;
}

export interface Report {
  id: EntityId;
  reporterId: EntityId;
  serverId: EntityId | null;
  messageId: EntityId | null;
  targetUserId: EntityId | null;
  reason: string;
  status: ReportStatus;
  resolution: string | null;
  createdAt: ISODateString;
  resolvedAt: ISODateString | null;
}

export interface AuditLog {
  id: EntityId;
  serverId: EntityId;
  actorId: EntityId | null;
  action: string;
  targetType: AuditTargetType | null;
  targetId: EntityId | null;
  metadata: Record<string, unknown>;
  createdAt: ISODateString;
}

export interface ServerMember {
  serverId: EntityId;
  userId: EntityId;
  nickname: string | null;
  joinedAt: ISODateString;
  user: User;
}

export interface Channel {
  id: EntityId;
  serverId: EntityId;
  name: string;
  type: ChannelType;
  position: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type AttachmentStatus = 'PENDING' | 'READY';

export interface Attachment {
  id: EntityId;
  channelId: EntityId;
  messageId: EntityId | null;
  filename: string;
  mimeType: string;
  size: number;
  status: AttachmentStatus;
  url: string;
  createdAt: ISODateString;
}

export interface Message {
  id: EntityId;
  channelId: EntityId;
  authorId: EntityId;
  content: string;
  replyToId: EntityId | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt: ISODateString | null;
  author: User;
  attachments: Attachment[];
}

export interface Invite {
  code: string;
  serverId: EntityId;
  createdById: EntityId;
  expiresAt: ISODateString | null;
  maxUses: number | null;
  uses: number;
}

export type FriendshipStatus = 'PENDING' | 'ACCEPTED';

export interface Friendship {
  pairKey: string;
  requesterId: EntityId;
  addresseeId: EntityId;
  status: FriendshipStatus;
  requestedAt: ISODateString;
  respondedAt: ISODateString | null;
  requester: User;
  addressee: User;
}

export interface PersonalBlock {
  blockerId: EntityId;
  blockedId: EntityId;
  createdAt: ISODateString;
  blocked: User;
}

export interface DirectConversation {
  id: EntityId;
  pairKey: string;
  createdById: EntityId;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  members: User[];
}

export interface DirectMessage {
  id: EntityId;
  conversationId: EntityId;
  authorId: EntityId;
  content: string;
  clientNonce: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt: ISODateString | null;
  author: User;
}
