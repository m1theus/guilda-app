import type {
  AttachmentStatus,
  AuditLog,
  Ban,
  Channel,
  ChannelType,
  GuildServer,
  DirectConversation,
  DirectMessage,
  Friendship,
  ServerSnapshot,
  Invite,
  Message,
  ModerationAction,
  Report,
  ReportStatus,
  Role,
  PersonalBlock,
  UpdateProfileRequest,
  User,
} from '@guilda/types';

export interface StoredUser extends User {
  passwordHash: string;
}
export interface RefreshSession {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}
export interface MemberRecord {
  serverId: string;
  userId: string;
  permissions: number;
  user: User;
}
export type RepositoryErrorCode =
  | 'INVITE_NOT_FOUND'
  | 'INVITE_EXPIRED'
  | 'INVITE_EXHAUSTED'
  | 'USER_BANNED'
  | 'ROLE_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'REPORT_NOT_FOUND'
  | 'BAN_NOT_FOUND'
  | 'PROTECTED_ROLE'
  | 'OWNER_PROTECTED'
  | 'SELF_MODERATION'
  | 'ROLE_HIERARCHY'
  | 'UNKNOWN_PERMISSIONS'
  | 'ATTACHMENT_CLAIM_INVALID'
  | 'SELF_RELATION'
  | 'USER_NOT_FOUND'
  | 'RELATION_BLOCKED'
  | 'BLOCK_NOT_FOUND'
  | 'FRIEND_REQUEST_NOT_FOUND'
  | 'FRIEND_REQUEST_EXISTS'
  | 'FRIENDSHIP_NOT_FOUND'
  | 'FRIENDSHIP_REQUIRED'
  | 'CONVERSATION_NOT_FOUND'
  | 'DIRECT_MESSAGE_NOT_FOUND'
  | 'FORBIDDEN';

export class RepositoryError extends Error {
  constructor(readonly code: RepositoryErrorCode) {
    super(code);
    this.name = 'RepositoryError';
  }
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export const canonicalPairKey = (firstUserId: string, secondUserId: string): string => {
  if (firstUserId === secondUserId) throw new RepositoryError('SELF_RELATION');
  return firstUserId < secondUserId
    ? `${firstUserId}:${secondUserId}`
    : `${secondUserId}:${firstUserId}`;
};

export interface AttachmentRecord {
  id: string;
  channelId: string;
  messageId: string | null;
  userId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  size: number;
  status: AttachmentStatus;
  createdAt: string;
}

export type CreateAttachmentRecord = Pick<
  AttachmentRecord,
  'id' | 'channelId' | 'userId' | 'storageKey' | 'filename' | 'mimeType' | 'size'
>;

export interface Repository {
  getChannel(id: string): Promise<Channel | null>;
  healthcheck?(): Promise<void>;
  close?(): Promise<void>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserByUsername(username: string): Promise<StoredUser | null>;
  updateUserProfile(userId: string, input: UpdateProfileRequest): Promise<StoredUser | null>;
  findUserById(id: string): Promise<StoredUser | null>;
  createUser(input: {
    username: string;
    displayName: string;
    email: string;
    passwordHash: string;
  }): Promise<StoredUser>;
  createRefreshSession(
    input: Omit<RefreshSession, 'revokedAt' | 'replacedBy'>,
  ): Promise<RefreshSession>;
  findRefreshSession(id: string): Promise<RefreshSession | null>;
  revokeRefreshFamily(familyId: string): Promise<void>;
  rotateRefreshSession(id: string, replacement: RefreshSession): Promise<void>;
  listServersForUser(userId: string): Promise<GuildServer[]>;
  createServer(input: {
    name: string;
    ownerId: string;
  }): Promise<{ server: GuildServer; defaultChannel: Channel }>;
  getServer(id: string): Promise<GuildServer | null>;
  getMembership(serverId: string, userId: string): Promise<MemberRecord | null>;
  listMembers(serverId: string): Promise<User[]>;
  getSnapshot(serverId: string, currentUserId: string): Promise<ServerSnapshot>;
  createChannel(input: { serverId: string; name: string; type: ChannelType }): Promise<Channel>;
  createInvite(input: {
    serverId: string;
    createdById: string;
    expiresAt: Date | null;
    maxUses: number | null;
  }): Promise<Invite>;
  getInvite(code: string): Promise<Invite | null>;
  acceptInvite(code: string, userId: string): Promise<GuildServer>;
  listMessages(input: {
    channelId: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: Message[]; nextCursor: string | null }>;
  searchMessages(input: {
    serverId: string;
    query: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: Message[]; nextCursor: string | null }>;
  createMessage(input: {
    channelId: string;
    authorId: string;
    content: string;
    replyToId: string | null;
    attachmentIds: string[];
    clientNonce: string;
  }): Promise<Message>;
  getMessage(id: string): Promise<Message | null>;
  updateMessage(id: string, content: string): Promise<Message>;
  deleteMessage(id: string): Promise<void>;
  createAttachment(input: CreateAttachmentRecord): Promise<AttachmentRecord>;
  getAttachment(id: string): Promise<AttachmentRecord | null>;
  markAttachmentReady(id: string, userId: string): Promise<AttachmentRecord | null>;
  listFriendships(userId: string): Promise<Friendship[]>;
  createFriendRequest(requesterId: string, addresseeId: string): Promise<Friendship>;
  acceptFriendRequest(requesterId: string, addresseeId: string): Promise<Friendship>;
  deleteFriendRequest(userId: string, otherUserId: string): Promise<Friendship>;
  deleteFriendship(userId: string, otherUserId: string): Promise<Friendship>;
  listBlocks(userId: string): Promise<PersonalBlock[]>;
  blockUser(
    blockerId: string,
    blockedId: string,
  ): Promise<{ block: PersonalBlock; removedFriendship: Friendship | null }>;
  unblockUser(blockerId: string, blockedId: string): Promise<PersonalBlock>;
  listDirectConversations(userId: string): Promise<DirectConversation[]>;
  getDirectConversation(conversationId: string, userId: string): Promise<DirectConversation>;
  createDirectConversation(
    creatorId: string,
    otherUserId: string,
  ): Promise<{ conversation: DirectConversation; created: boolean }>;
  listDirectMessages(input: {
    conversationId: string;
    userId: string;
    cursor?: string;
    limit: number;
  }): Promise<CursorPage<DirectMessage>>;
  createDirectMessage(input: {
    conversationId: string;
    authorId: string;
    content: string;
    clientNonce: string;
  }): Promise<{ message: DirectMessage; created: boolean }>;
  updateDirectMessage(messageId: string, actorId: string, content: string): Promise<DirectMessage>;
  deleteDirectMessage(messageId: string, actorId: string): Promise<DirectMessage>;
  listRoles(serverId: string): Promise<Role[]>;
  listRoleMemberIds(serverId: string, roleId: string): Promise<string[]>;
  listMemberRoles(serverId: string, userId: string): Promise<Role[]>;
  createRole(input: {
    serverId: string;
    actorId: string;
    name: string;
    permissions: number;
    color: string | null;
    position?: number;
  }): Promise<Role>;
  updateRole(input: {
    serverId: string;
    roleId: string;
    actorId: string;
    name?: string;
    permissions?: number;
    color?: string | null;
    position?: number;
  }): Promise<Role>;
  deleteRole(serverId: string, roleId: string, actorId: string): Promise<void>;
  assignMemberRoles(input: {
    serverId: string;
    userId: string;
    actorId: string;
    roleIds: string[];
  }): Promise<Role[]>;
  moderateMember(input: {
    serverId: string;
    actorId: string;
    userId: string;
    action: ModerationAction;
    reason?: string;
  }): Promise<AuditLog>;
  listBans(serverId: string): Promise<Ban[]>;
  unbanMember(serverId: string, userId: string, actorId: string): Promise<void>;
  createReport(input: {
    reporterId: string;
    serverId?: string;
    messageId?: string;
    targetUserId?: string;
    reason: string;
  }): Promise<Report>;
  listReports(input: {
    serverId: string;
    cursor?: string;
    limit: number;
  }): Promise<CursorPage<Report>>;
  updateReport(input: {
    serverId: string;
    actorId: string;
    reportId: string;
    status: ReportStatus;
    resolution?: string;
  }): Promise<Report>;
  listAudit(input: {
    serverId: string;
    cursor?: string;
    limit: number;
  }): Promise<CursorPage<AuditLog>>;
}

export type DatabaseRepository = Repository;
