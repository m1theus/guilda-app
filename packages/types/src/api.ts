import type {
  Attachment,
  AuditLog,
  Ban,
  Channel,
  ChannelType,
  GuildServer,
  Invite,
  Message,
  ModerationAction,
  PermissionBitfield,
  Report,
  ReportStatus,
  Role,
  User,
  DirectConversation,
  DirectMessage,
  Friendship,
  PersonalBlock,
} from './entities';

export interface ApiError {
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, string[]>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse extends AuthTokens {
  user: User;
}

export interface RegisterRequest {
  username: string;
  displayName: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UpdateProfileRequest {
  displayName?: string;
  pronouns?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  profileColor?: string | null;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken: string;
}

export interface CreateServerRequest {
  name: string;
}

export interface CreateServerResponse {
  server: GuildServer;
  defaultChannel: Channel;
}

export interface CreateChannelRequest {
  name: string;
  type: ChannelType;
}

export interface CreateInviteRequest {
  expiresAt?: string;
  maxUses?: number;
}

export interface AcceptInviteResponse {
  server: GuildServer;
}
export interface CreateRoleRequest {
  name: string;
  permissions: PermissionBitfield;
  color?: string | null;
  position?: number;
}

export interface UpdateRoleRequest {
  name?: string;
  permissions?: PermissionBitfield;
  color?: string | null;
  position?: number;
}

export interface RoleListResponse {
  items: Role[];
}

export interface AssignMemberRolesRequest {
  roleIds: string[];
}

export interface ModerateMemberRequest {
  action: ModerationAction;
  userId: string;
  reason?: string;
}

export interface BanListResponse {
  items: Ban[];
}

export interface CreateReportRequest {
  serverId?: string;
  messageId?: string;
  targetUserId?: string;
  reason: string;
}

export interface UpdateReportRequest {
  reportId: string;
  status: ReportStatus;
  resolution?: string;
}

export interface ReportPage {
  items: Report[];
  nextCursor: string | null;
}

export interface AuditLogPage {
  items: AuditLog[];
  nextCursor: string | null;
}

export interface CreateFriendRequestRequest {
  addresseeId: string;
}

export interface FriendshipListResponse {
  items: Friendship[];
}

export interface BlockListResponse {
  items: PersonalBlock[];
}

export interface CreateDirectConversationRequest {
  otherUserId: string;
}

export interface DirectConversationListResponse {
  items: DirectConversation[];
}

export interface SendDirectMessageRequest {
  content: string;
  clientNonce: string;
}

export interface UpdateDirectMessageRequest {
  content: string;
}

export interface DirectMessagePage {
  items: DirectMessage[];
  nextCursor: string | null;
}

export interface SendMessageRequest {
  content: string;
  replyToId?: string;
  attachmentIds?: string[];
  clientNonce: string;
}

export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

export interface CreateAttachmentRequest {
  filename: string;
  mimeType: string;
  size: number;
}

export interface CreateAttachmentResponse {
  attachmentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresIn: number;
}

export interface CompleteAttachmentResponse {
  attachment: Attachment;
}

export interface UpdateMessageRequest {
  content: string;
}

export interface MessagePage {
  items: Message[];
  nextCursor: string | null;
}

export interface ServerSnapshot {
  server: GuildServer;
  channels: Channel[];
  members: User[];
  currentUserPermissions: number;
}

export interface InviteResponse {
  invite: Invite;
  deepLink: string;
}
