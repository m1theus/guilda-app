import type {
  AssignMemberRolesRequest,
  AuditLogPage,
  AuthResponse,
  AuthTokens,
  BanListResponse,
  BlockListResponse,
  CreateChannelRequest,
  CompleteAttachmentResponse,
  CreateAttachmentResponse,
  CreateDirectConversationRequest,
  CreateFriendRequestRequest,
  CreateInviteRequest,
  CreateReportRequest,
  CreateRoleRequest,
  CreateServerRequest,
  DirectConversationListResponse,
  DirectMessagePage,
  FriendshipListResponse,
  InviteResponse,
  LoginRequest,
  MessagePage,
  ModerateMemberRequest,
  RegisterRequest,
  ReportPage,
  RoleListResponse,
  SendDirectMessageRequest,
  SendMessageRequest,
  ServerSnapshot,
  UpdateDirectMessageRequest,
  UpdateMessageRequest,
  UpdateProfileRequest,
  UpdateReportRequest,
  UpdateRoleRequest,
} from '@guilda/types/api';
import { MAX_ATTACHMENT_SIZE } from '@guilda/types/api';
import type {
  AuditLog,
  Attachment,
  Ban,
  Channel,
  DirectConversation,
  DirectMessage,
  Friendship,
  GuildServer,
  Message,
  PersonalBlock,
  Report,
  Role,
  User,
} from '@guilda/types/entities';
import { ALL_PERMISSIONS, DEFAULT_EVERYONE_PERMISSIONS } from '@guilda/types/entities';
import type { MediaTokenResponse, MediaVoiceStateResponse } from '@guilda/types/media';
import { tokenStore } from './tokenStore';

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
if (!configuredApiUrl && !import.meta.env.DEV) {
  throw new Error('VITE_API_URL must be configured for production builds.');
}
const API_URL = (configuredApiUrl || 'http://localhost:3000').replace(/\/$/, '');
export const isMockMode =
  import.meta.env.VITE_USE_MOCK_API === 'true' ||
  (import.meta.env.DEV &&
    new URLSearchParams(globalThis.location?.search ?? '').get('mock') === 'true');

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_FAILED',
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message
        : `Request failed (${response.status})`;
    const code =
      body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
        ? body.code
        : 'REQUEST_FAILED';
    throw new ApiRequestError(response.status, message, code);
  }
  return body as T;
}

function nonce() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
type RefreshInFlight = {
  refreshToken: string;
  promise: Promise<AuthTokens>;
};

let refreshInFlight: RefreshInFlight | null = null;
let lastRefresh: { consumedRefreshToken: string; tokens: AuthTokens } | null = null;

async function clearTokensIfCurrent(refreshToken: string) {
  const current = await tokenStore.get().catch(() => null);
  if (current?.refreshToken === refreshToken) await tokenStore.clear().catch(() => undefined);
}

async function refreshTokens(tokens: AuthTokens): Promise<AuthTokens> {
  const current = await tokenStore.get();
  if (!current) {
    throw new ApiRequestError(401, 'Your session has expired.', 'REFRESH_INVALID');
  }
  if (current.refreshToken !== tokens.refreshToken) {
    if (
      lastRefresh?.consumedRefreshToken === tokens.refreshToken &&
      lastRefresh.tokens.refreshToken === current.refreshToken
    )
      return current;
    throw new ApiRequestError(401, 'Your session changed.', 'REFRESH_INVALID');
  }

  if (lastRefresh?.consumedRefreshToken === tokens.refreshToken) return lastRefresh.tokens;
  const inFlight = refreshInFlight;
  if (inFlight?.refreshToken === tokens.refreshToken) return inFlight.promise;

  const promise = (async () => {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });

    if (response.status === 401) {
      let error: unknown;
      try {
        await parseResponse<AuthTokens>(response);
      } catch (cause) {
        error = cause;
      }
      await clearTokensIfCurrent(tokens.refreshToken);
      if (error instanceof ApiRequestError)
        throw new ApiRequestError(401, error.message, 'REFRESH_INVALID');
      throw new ApiRequestError(401, 'Invalid refresh token', 'REFRESH_INVALID');
    }

    const next = await parseResponse<AuthTokens>(response);
    await tokenStore.replace(next);
    lastRefresh = { consumedRefreshToken: tokens.refreshToken, tokens: next };
    return next;
  })();

  refreshInFlight = { refreshToken: tokens.refreshToken, promise };
  try {
    return await promise;
  } finally {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  }
}
export interface GuildaApi {
  getCurrentUser(): Promise<User>;
  updateProfile(input: UpdateProfileRequest): Promise<User>;
  register(input: RegisterRequest): Promise<AuthResponse>;
  login(input: LoginRequest): Promise<AuthResponse>;
  logout(): Promise<void>;
  getServers(): Promise<GuildServer[]>;
  getServerSnapshot(serverId: string): Promise<ServerSnapshot>;
  createServer(
    input: CreateServerRequest,
  ): Promise<{ server: GuildServer; defaultChannel: Channel }>;
  acceptInvite(code: string): Promise<{ server: GuildServer }>;
  createChannel(serverId: string, input: CreateChannelRequest): Promise<Channel>;
  createInvite(serverId: string, input: CreateInviteRequest): Promise<InviteResponse>;
  getMessages(channelId: string, cursor?: string | null): Promise<MessagePage>;
  searchMessages(serverId: string, query: string, cursor?: string | null): Promise<MessagePage>;
  sendMessage(
    channelId: string,
    input: Omit<SendMessageRequest, 'clientNonce'> & { clientNonce?: string },
  ): Promise<Message>;
  updateMessage(messageId: string, input: UpdateMessageRequest): Promise<Message>;
  deleteMessage(messageId: string): Promise<void>;
  getFriendships(): Promise<FriendshipListResponse>;
  createFriendRequest(input: CreateFriendRequestRequest): Promise<Friendship>;
  acceptFriendRequest(requesterId: string): Promise<Friendship>;
  deleteFriendRequest(otherUserId: string): Promise<void>;
  deleteFriendship(userId: string): Promise<void>;
  getBlocks(): Promise<BlockListResponse>;
  blockUser(userId: string): Promise<PersonalBlock>;
  unblockUser(userId: string): Promise<void>;
  getDirectConversations(): Promise<DirectConversationListResponse>;
  createDirectConversation(input: CreateDirectConversationRequest): Promise<DirectConversation>;
  getDirectMessages(conversationId: string, cursor?: string | null): Promise<DirectMessagePage>;
  sendDirectMessage(
    conversationId: string,
    input: SendDirectMessageRequest,
  ): Promise<DirectMessage>;
  updateDirectMessage(messageId: string, input: UpdateDirectMessageRequest): Promise<DirectMessage>;
  deleteDirectMessage(messageId: string): Promise<void>;
  getRoles(serverId: string): Promise<RoleListResponse>;
  getMemberRoles(serverId: string, userId: string): Promise<RoleListResponse>;
  createRole(serverId: string, input: CreateRoleRequest): Promise<Role>;
  updateRole(serverId: string, roleId: string, input: UpdateRoleRequest): Promise<Role>;
  deleteRole(serverId: string, roleId: string): Promise<void>;
  assignMemberRoles(
    serverId: string,
    userId: string,
    input: AssignMemberRolesRequest,
  ): Promise<RoleListResponse>;
  moderate(serverId: string, input: ModerateMemberRequest): Promise<AuditLog>;
  getBans(serverId: string): Promise<BanListResponse>;
  removeBan(serverId: string, userId: string): Promise<void>;
  createReport(input: CreateReportRequest): Promise<Report>;
  getReports(serverId: string, cursor?: string | null): Promise<ReportPage>;
  updateReport(serverId: string, input: UpdateReportRequest): Promise<Report>;
  getAuditLog(serverId: string, cursor?: string | null): Promise<AuditLogPage>;
  createUpload(channelId: string, file: File): Promise<Attachment>;
  getAttachmentContent(attachmentId: string): Promise<Blob>;
  getMediaToken(channelId: string): Promise<MediaTokenResponse>;
  getVoiceState(serverId: string): Promise<MediaVoiceStateResponse>;
}
class HttpApi implements GuildaApi {
  getCurrentUser() {
    return this.request<User>('/auth/me');
  }
  updateProfile(input: UpdateProfileRequest) {
    return this.request<User>('/users/@me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  private async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    const tokens = await tokenStore.get();
    if (tokens?.accessToken) headers.set('Authorization', `Bearer ${tokens.accessToken}`);
    const response = await fetch(`${API_URL}${path}`, { ...init, headers });
    if (response.status === 401 && retry && tokens?.refreshToken) {
      await refreshTokens(tokens);
      return this.request<T>(path, init, false);
    }
    if (response.status === 401 && tokens?.refreshToken)
      await clearTokensIfCurrent(tokens.refreshToken);
    return parseResponse<T>(response);
  }
  private async requestBlob(path: string, init: RequestInit = {}, retry = true): Promise<Blob> {
    const tokens = await tokenStore.get();
    const headers = new Headers(init.headers);
    if (tokens?.accessToken) headers.set('Authorization', `Bearer ${tokens.accessToken}`);
    const response = await fetch(`${API_URL}${path}`, { ...init, headers });
    if (response.status === 401 && retry && tokens?.refreshToken) {
      await refreshTokens(tokens);
      return this.requestBlob(path, init, false);
    }
    if (response.status === 401 && tokens?.refreshToken)
      await clearTokensIfCurrent(tokens.refreshToken);
    if (!response.ok)
      throw new ApiRequestError(
        response.status,
        `Could not download attachment (${response.status})`,
      );
    return response.blob();
  }
  register(input: RegisterRequest) {
    return this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  login(input: LoginRequest) {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  async logout() {
    const tokens = await tokenStore.get();
    if (tokens?.refreshToken)
      await this.request('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      }).catch(() => undefined);
    await tokenStore.clear();
  }
  async getServers() {
    const response = await this.request<{ items: GuildServer[] }>('/servers');
    return response.items;
  }
  getServerSnapshot(serverId: string) {
    return this.request<ServerSnapshot>(`/servers/${serverId}/snapshot`);
  }
  createServer(input: CreateServerRequest) {
    return this.request<{ server: GuildServer; defaultChannel: Channel }>('/servers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  acceptInvite(code: string) {
    return this.request<{ server: GuildServer }>(`/invites/${encodeURIComponent(code)}/accept`, {
      method: 'POST',
    });
  }
  createChannel(serverId: string, input: CreateChannelRequest) {
    return this.request<Channel>(`/servers/${serverId}/channels`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  createInvite(serverId: string, input: CreateInviteRequest) {
    return this.request<InviteResponse>(`/servers/${serverId}/invites`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  getMessages(channelId: string, cursor?: string | null) {
    return this.request<MessagePage>(
      `/channels/${channelId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
  }
  searchMessages(serverId: string, query: string, cursor?: string | null) {
    const search = new URLSearchParams({ query });
    if (cursor) search.set('cursor', cursor);
    return this.request<MessagePage>(
      `/servers/${encodeURIComponent(serverId)}/messages/search?${search.toString()}`,
    );
  }
  sendMessage(
    channelId: string,
    input: Omit<SendMessageRequest, 'clientNonce'> & { clientNonce?: string },
  ) {
    const body = { ...input, clientNonce: input.clientNonce ?? nonce() };
    return this.request<Message>(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
  updateMessage(messageId: string, input: UpdateMessageRequest) {
    return this.request<Message>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  async deleteMessage(messageId: string) {
    await this.request(`/messages/${messageId}`, { method: 'DELETE' });
  }
  getFriendships() {
    return this.request<FriendshipListResponse>('/friendships');
  }
  createFriendRequest(input: CreateFriendRequestRequest) {
    return this.request<Friendship>('/friend-requests', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  acceptFriendRequest(requesterId: string) {
    return this.request<Friendship>(`/friend-requests/${encodeURIComponent(requesterId)}/accept`, {
      method: 'POST',
    });
  }
  async deleteFriendRequest(otherUserId: string) {
    await this.request(`/friend-requests/${encodeURIComponent(otherUserId)}`, {
      method: 'DELETE',
    });
  }
  async deleteFriendship(userId: string) {
    await this.request(`/friendships/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  }
  getBlocks() {
    return this.request<BlockListResponse>('/blocks');
  }
  blockUser(userId: string) {
    return this.request<PersonalBlock>(`/users/${encodeURIComponent(userId)}/block`, {
      method: 'PUT',
    });
  }
  async unblockUser(userId: string) {
    await this.request(`/users/${encodeURIComponent(userId)}/block`, { method: 'DELETE' });
  }
  getDirectConversations() {
    return this.request<DirectConversationListResponse>('/direct-conversations');
  }
  createDirectConversation(input: CreateDirectConversationRequest) {
    return this.request<DirectConversation>('/direct-conversations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  getDirectMessages(conversationId: string, cursor?: string | null) {
    return this.request<DirectMessagePage>(
      `/direct-conversations/${encodeURIComponent(conversationId)}/messages${
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      }`,
    );
  }
  sendDirectMessage(conversationId: string, input: SendDirectMessageRequest) {
    const body = input;
    return this.request<DirectMessage>(
      `/direct-conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: 'POST', body: JSON.stringify(body) },
    );
  }
  updateDirectMessage(messageId: string, input: UpdateDirectMessageRequest) {
    return this.request<DirectMessage>(`/direct-messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  async deleteDirectMessage(messageId: string) {
    await this.request(`/direct-messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  }
  getRoles(serverId: string) {
    return this.request<RoleListResponse>(`/servers/${encodeURIComponent(serverId)}/roles`);
  }
  getMemberRoles(serverId: string, userId: string) {
    return this.request<RoleListResponse>(
      `/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/roles`,
    );
  }
  createRole(serverId: string, input: CreateRoleRequest) {
    return this.request<Role>(`/servers/${encodeURIComponent(serverId)}/roles`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  updateRole(serverId: string, roleId: string, input: UpdateRoleRequest) {
    return this.request<Role>(
      `/servers/${encodeURIComponent(serverId)}/roles/${encodeURIComponent(roleId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
  }
  async deleteRole(serverId: string, roleId: string) {
    await this.request(
      `/servers/${encodeURIComponent(serverId)}/roles/${encodeURIComponent(roleId)}`,
      { method: 'DELETE' },
    );
  }
  assignMemberRoles(serverId: string, userId: string, input: AssignMemberRolesRequest) {
    return this.request<RoleListResponse>(
      `/servers/${encodeURIComponent(serverId)}/members/${encodeURIComponent(userId)}/roles`,
      { method: 'PUT', body: JSON.stringify(input) },
    );
  }
  moderate(serverId: string, input: ModerateMemberRequest) {
    return this.request<AuditLog>(`/servers/${encodeURIComponent(serverId)}/moderation`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  getBans(serverId: string) {
    return this.request<BanListResponse>(`/servers/${encodeURIComponent(serverId)}/bans`);
  }
  async removeBan(serverId: string, userId: string) {
    await this.request(
      `/servers/${encodeURIComponent(serverId)}/bans/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
  }
  createReport(input: CreateReportRequest) {
    return this.request<Report>('/reports', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  getReports(serverId: string, cursor?: string | null) {
    return this.request<ReportPage>(
      `/servers/${encodeURIComponent(serverId)}/reports${
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      }`,
    );
  }
  updateReport(serverId: string, input: UpdateReportRequest) {
    return this.request<Report>(`/servers/${encodeURIComponent(serverId)}/reports`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }
  getAuditLog(serverId: string, cursor?: string | null) {
    return this.request<AuditLogPage>(
      `/servers/${encodeURIComponent(serverId)}/audit${
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      }`,
    );
  }
  async createUpload(channelId: string, file: File): Promise<Attachment> {
    if (file.size === 0)
      throw new ApiRequestError(400, 'Choose a non-empty file to upload.', 'EMPTY_ATTACHMENT');
    if (file.size > MAX_ATTACHMENT_SIZE)
      throw new ApiRequestError(
        400,
        'Attachments must be 50 MB or smaller.',
        'ATTACHMENT_TOO_LARGE',
      );
    const result = await this.request<CreateAttachmentResponse>(
      `/channels/${encodeURIComponent(channelId)}/attachments`,
      {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
        }),
      },
    );
    const uploadResponse = await fetch(result.uploadUrl, {
      method: 'PUT',
      headers: result.headers,
      body: file,
    });
    if (!uploadResponse.ok)
      throw new ApiRequestError(
        uploadResponse.status,
        `Upload failed (${uploadResponse.status}). Check the storage service and try again.`,
        'UPLOAD_FAILED',
      );
    const completed = await this.request<CompleteAttachmentResponse>(
      `/attachments/${encodeURIComponent(result.attachmentId)}/complete`,
      { method: 'POST' },
    );
    return completed.attachment;
  }
  getAttachmentContent(attachmentId: string): Promise<Blob> {
    return this.requestBlob(`/attachments/${encodeURIComponent(attachmentId)}/content`);
  }
  getMediaToken(channelId: string) {
    return this.request<MediaTokenResponse>('/media/token', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    });
  }
  getVoiceState(serverId: string) {
    return this.request<MediaVoiceStateResponse>(
      `/servers/${encodeURIComponent(serverId)}/voice-state`,
    );
  }
}

const now = new Date().toISOString();
const mockUser: User = {
  id: 'mock-user',
  username: 'mira',
  displayName: 'Mira Sol',
  email: 'mira@guilda.local',
  avatarUrl: null,
  pronouns: null,
  bio: 'Making small spaces for big ideas.',
  bannerUrl: null,
  profileColor: '#9684FF',
  status: 'ONLINE',
  createdAt: now,
  updatedAt: now,
};
const mockServer: GuildServer = {
  id: 'mock-server',
  name: 'Moonroom',
  iconUrl: null,
  ownerId: mockUser.id,
  createdAt: now,
  updatedAt: now,
};
const mockChannels: Channel[] = [
  {
    id: 'lobby',
    serverId: mockServer.id,
    name: 'lobby',
    type: 'TEXT',
    position: 0,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'ideas',
    serverId: mockServer.id,
    name: 'ideas',
    type: 'TEXT',
    position: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'quiet-room',
    serverId: mockServer.id,
    name: 'quiet room',
    type: 'VOICE',
    position: 2,
    createdAt: now,
    updatedAt: now,
  },
];
const mockNoa: User = {
  ...mockUser,
  id: 'noa',
  username: 'noa',
  displayName: 'Noa T.',
  status: 'IDLE',
};
const mockAri: User = {
  ...mockUser,
  id: 'ari',
  username: 'ari',
  displayName: 'Ari Vale',
  status: 'DND',
};
const mockMembers: User[] = [mockUser, mockNoa, mockAri];
let mockMessages: Message[] = [
  {
    id: 'm1',
    channelId: 'lobby',
    authorId: mockNoa.id,
    content: 'Welcome to Moonroom ✦ a small corner for big ideas.',
    replyToId: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    updatedAt: now,
    deletedAt: null,
    author: mockNoa,
    attachments: [],
  },
  {
    id: 'm2',
    channelId: 'lobby',
    authorId: mockUser.id,
    content: 'I brought the soft launch checklist. What should we make together?',
    replyToId: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    updatedAt: now,
    deletedAt: null,
    author: mockUser,
    attachments: [],
  },
  {
    id: 'm3',
    channelId: 'lobby',
    authorId: mockAri.id,
    content: 'A tiny community garden for our best experiments 🌱',
    replyToId: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    updatedAt: now,
    deletedAt: null,
    author: mockAri,
    attachments: [],
  },
];
let mockFriendships: Friendship[] = [
  {
    pairKey: `${mockNoa.id}:${mockUser.id}`,
    requesterId: mockNoa.id,
    addresseeId: mockUser.id,
    status: 'PENDING',
    requestedAt: now,
    respondedAt: null,
    requester: mockNoa,
    addressee: mockUser,
  },
];
let mockBlocks: PersonalBlock[] = [];
let mockConversations: DirectConversation[] = [
  {
    id: 'mock-direct-noa',
    pairKey: `${mockNoa.id}:${mockUser.id}`,
    createdById: mockUser.id,
    createdAt: now,
    updatedAt: now,
    members: [mockUser, mockNoa],
  },
];
let mockDirectMessages: DirectMessage[] = [
  {
    id: 'mock-direct-message',
    conversationId: 'mock-direct-noa',
    authorId: mockNoa.id,
    content: 'The launch notes are lovely.',
    clientNonce: 'mock-direct-message-nonce',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    author: mockNoa,
  },
];
let mockRoles: Role[] = [
  {
    id: 'mock-everyone-role',
    serverId: mockServer.id,
    name: '@everyone',
    permissions: DEFAULT_EVERYONE_PERMISSIONS,
    color: null,
    position: 0,
    createdAt: now,
  },
];
const mockMemberRoleIds = new Map<string, string[]>();
let mockReports: Report[] = [];
let mockBans: Ban[] = [];
let mockAuditLog: AuditLog[] = [];
class MockApi implements GuildaApi {
  async getCurrentUser() {
    return mockUser;
  }
  async updateProfile(input: UpdateProfileRequest) {
    Object.assign(mockUser, {
      displayName: input.displayName?.trim() ?? mockUser.displayName,
      pronouns: input.pronouns === undefined ? mockUser.pronouns : input.pronouns?.trim() || null,
      bio: input.bio === undefined ? mockUser.bio : input.bio?.trim() || null,
      avatarUrl: input.avatarUrl === undefined ? mockUser.avatarUrl : input.avatarUrl,
      bannerUrl: input.bannerUrl === undefined ? mockUser.bannerUrl : input.bannerUrl,
      profileColor: input.profileColor === undefined ? mockUser.profileColor : input.profileColor,
      updatedAt: new Date().toISOString(),
    });
    return mockUser;
  }
  async register() {
    return {
      accessToken: 'mock-access',
      refreshToken: 'mock-refresh',
      expiresIn: 3600,
      user: mockUser,
    };
  }
  async login() {
    return {
      accessToken: 'mock-access',
      refreshToken: 'mock-refresh',
      expiresIn: 3600,
      user: mockUser,
    };
  }
  async logout() {
    await tokenStore.clear();
  }
  async getServers() {
    return [mockServer];
  }
  async getServerSnapshot() {
    return {
      server: mockServer,
      channels: mockChannels,
      members: mockMembers,
      currentUserPermissions: ALL_PERMISSIONS,
    };
  }
  async createServer(input: CreateServerRequest) {
    const server: GuildServer = { ...mockServer, id: `server-${Date.now()}`, name: input.name };
    const defaultChannel: Channel = {
      id: `channel-${Date.now()}`,
      serverId: server.id,
      name: 'lobby',
      type: 'TEXT',
      position: 0,
      createdAt: now,
      updatedAt: now,
    };
    return { server, defaultChannel };
  }
  async acceptInvite(code: string) {
    if (!code.trim()) throw new ApiRequestError(400, 'Invite code is required', 'INVALID_INVITE');
    return { server: mockServer };
  }
  async createChannel(serverId: string, input: CreateChannelRequest) {
    const channel: Channel = {
      id: `channel-${Date.now()}`,
      serverId,
      name: input.name,
      type: input.type,
      position: mockChannels.length,
      createdAt: now,
      updatedAt: now,
    };
    return channel;
  }
  async createInvite() {
    return {
      invite: {
        code: 'MOON-7H2K',
        serverId: mockServer.id,
        createdById: mockUser.id,
        expiresAt: null,
        maxUses: null,
        uses: 0,
      },
      deepLink: 'https://noxera.online/invite/MOON-7H2K',
    };
  }
  async getMessages(channelId: string) {
    return {
      items: mockMessages.filter((message) => message.channelId === channelId),
      nextCursor: null,
    };
  }
  async searchMessages(serverId: string, query: string) {
    const channelIds = new Set(
      mockChannels.filter((channel) => channel.serverId === serverId).map((channel) => channel.id),
    );
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return {
      items: mockMessages.filter(
        (message) =>
          channelIds.has(message.channelId) &&
          !message.deletedAt &&
          message.content.toLocaleLowerCase().includes(normalizedQuery),
      ),
      nextCursor: null,
    };
  }
  async sendMessage(
    channelId: string,
    input: Omit<SendMessageRequest, 'clientNonce'> & { clientNonce?: string },
  ) {
    const message: Message = {
      id: `message-${Date.now()}`,
      channelId,
      authorId: mockUser.id,
      content: input.content,
      replyToId: input.replyToId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      author: mockUser,
      attachments: [],
    };
    mockMessages = [...mockMessages, message];
    return message;
  }
  async updateMessage(id: string, input: UpdateMessageRequest) {
    const current = mockMessages.find((message) => message.id === id);
    if (!current) throw new ApiRequestError(404, 'Message not found');
    const next = { ...current, content: input.content, updatedAt: new Date().toISOString() };
    mockMessages = mockMessages.map((message) => (message.id === id ? next : message));
    return next;
  }
  async deleteMessage(id: string) {
    mockMessages = mockMessages.map((message) =>
      message.id === id ? { ...message, deletedAt: new Date().toISOString() } : message,
    );
  }
  async getFriendships() {
    return { items: mockFriendships };
  }
  async createFriendRequest(input: CreateFriendRequestRequest) {
    const addressee = mockMembers.find((member) => member.id === input.addresseeId);
    if (!addressee) throw new ApiRequestError(404, 'User not found');
    const friendship: Friendship = {
      pairKey: [mockUser.id, addressee.id].sort().join(':'),
      requesterId: mockUser.id,
      addresseeId: addressee.id,
      status: 'PENDING',
      requestedAt: new Date().toISOString(),
      respondedAt: null,
      requester: mockUser,
      addressee,
    };
    mockFriendships = [...mockFriendships, friendship];
    return friendship;
  }
  async acceptFriendRequest(requesterId: string) {
    const friendship = mockFriendships.find(
      (item) => item.requesterId === requesterId && item.addresseeId === mockUser.id,
    );
    if (!friendship) throw new ApiRequestError(404, 'Friend request not found');
    const accepted: Friendship = {
      ...friendship,
      status: 'ACCEPTED',
      respondedAt: new Date().toISOString(),
    };
    mockFriendships = mockFriendships.map((item) =>
      item.pairKey === accepted.pairKey ? accepted : item,
    );
    return accepted;
  }
  async deleteFriendRequest(otherUserId: string) {
    mockFriendships = mockFriendships.filter(
      (item) => item.requesterId !== otherUserId && item.addresseeId !== otherUserId,
    );
  }
  async deleteFriendship(userId: string) {
    await this.deleteFriendRequest(userId);
  }
  async getBlocks() {
    return { items: mockBlocks };
  }
  async blockUser(userId: string) {
    const blocked = mockMembers.find((member) => member.id === userId);
    if (!blocked) throw new ApiRequestError(404, 'User not found');
    const block: PersonalBlock = {
      blockerId: mockUser.id,
      blockedId: userId,
      createdAt: new Date().toISOString(),
      blocked,
    };
    mockBlocks = [...mockBlocks.filter((item) => item.blockedId !== userId), block];
    return block;
  }
  async unblockUser(userId: string) {
    mockBlocks = mockBlocks.filter((item) => item.blockedId !== userId);
  }
  async getDirectConversations() {
    return { items: mockConversations };
  }
  async createDirectConversation(input: CreateDirectConversationRequest) {
    const existing = mockConversations.find((conversation) =>
      conversation.members.some((member) => member.id === input.otherUserId),
    );
    if (existing) return existing;
    const other = mockMembers.find((member) => member.id === input.otherUserId);
    if (!other) throw new ApiRequestError(404, 'User not found');
    const conversation: DirectConversation = {
      id: `direct-${Date.now()}`,
      pairKey: [mockUser.id, other.id].sort().join(':'),
      createdById: mockUser.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      members: [mockUser, other],
    };
    mockConversations = [...mockConversations, conversation];
    return conversation;
  }
  async getDirectMessages(conversationId: string) {
    return {
      items: mockDirectMessages.filter((message) => message.conversationId === conversationId),
      nextCursor: null,
    };
  }
  async sendDirectMessage(conversationId: string, input: SendDirectMessageRequest) {
    const message: DirectMessage = {
      id: `direct-message-${Date.now()}`,
      conversationId,
      authorId: mockUser.id,
      content: input.content,
      clientNonce: input.clientNonce,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      author: mockUser,
    };
    mockDirectMessages = [...mockDirectMessages, message];
    return message;
  }
  async updateDirectMessage(id: string, input: UpdateDirectMessageRequest) {
    const current = mockDirectMessages.find((message) => message.id === id);
    if (!current) throw new ApiRequestError(404, 'Direct message not found');
    const updated = { ...current, content: input.content, updatedAt: new Date().toISOString() };
    mockDirectMessages = mockDirectMessages.map((message) =>
      message.id === id ? updated : message,
    );
    return updated;
  }
  async deleteDirectMessage(id: string) {
    mockDirectMessages = mockDirectMessages.map((message) =>
      message.id === id
        ? { ...message, deletedAt: new Date().toISOString(), content: '' }
        : message,
    );
  }
  async getRoles(serverId: string) {
    return { items: mockRoles.filter((role) => role.serverId === serverId) };
  }
  async getMemberRoles(serverId: string, userId: string) {
    const roleIds = mockMemberRoleIds.get(`${serverId}:${userId}`) ?? [];
    return {
      items: mockRoles.filter((role) => role.serverId === serverId && roleIds.includes(role.id)),
    };
  }
  async createRole(serverId: string, input: CreateRoleRequest) {
    const role: Role = {
      id: `mock-role-${Date.now()}`,
      serverId,
      name: input.name,
      permissions: input.permissions,
      color: input.color ?? null,
      position: input.position ?? mockRoles.length,
      createdAt: new Date().toISOString(),
    };
    mockRoles = [...mockRoles, role];
    return role;
  }
  async updateRole(serverId: string, roleId: string, input: UpdateRoleRequest) {
    const current = mockRoles.find((role) => role.id === roleId && role.serverId === serverId);
    if (!current) throw new ApiRequestError(404, 'Role not found');
    if (current.name === '@everyone') {
      throw new ApiRequestError(409, '@everyone is managed by the server');
    }
    const updated = { ...current, ...input };
    mockRoles = mockRoles.map((role) => (role.id === roleId ? updated : role));
    return updated;
  }
  async deleteRole(serverId: string, roleId: string) {
    const role = mockRoles.find((item) => item.id === roleId && item.serverId === serverId);
    if (role?.name === '@everyone') {
      throw new ApiRequestError(409, '@everyone cannot be deleted');
    }
    mockRoles = mockRoles.filter((item) => item.id !== roleId || item.serverId !== serverId);
  }
  async assignMemberRoles(serverId: string, userId: string, input: AssignMemberRolesRequest) {
    const items = mockRoles.filter(
      (role) => role.serverId === serverId && input.roleIds.includes(role.id),
    );
    if (items.length !== new Set(input.roleIds).size)
      throw new ApiRequestError(400, 'One or more roles do not belong to this server');
    mockMemberRoleIds.set(`${serverId}:${userId}`, input.roleIds);
    return { items };
  }
  async moderate(serverId: string, input: ModerateMemberRequest): Promise<AuditLog> {
    const createdAt = new Date().toISOString();
    const audit: AuditLog = {
      id: `mock-audit-${nonce()}`,
      serverId,
      actorId: mockUser.id,
      action: input.action,
      targetType: 'USER',
      targetId: input.userId,
      metadata: input.reason ? { reason: input.reason } : {},
      createdAt,
    };
    if (input.action === 'BAN') {
      const bannedUser = mockMembers.find((member) => member.id === input.userId);
      if (!bannedUser) throw new ApiRequestError(404, 'Member not found');
      mockBans = [
        {
          serverId,
          userId: input.userId,
          bannedById: mockUser.id,
          reason: input.reason ?? null,
          expiresAt: null,
          createdAt,
          user: bannedUser,
        },
        ...mockBans.filter((ban) => ban.serverId !== serverId || ban.userId !== input.userId),
      ];
    }
    mockAuditLog = [audit, ...mockAuditLog];
    return audit;
  }
  async getBans(serverId: string) {
    return { items: mockBans.filter((ban) => ban.serverId === serverId) };
  }
  async removeBan(serverId: string, userId: string) {
    const existing = mockBans.find((ban) => ban.serverId === serverId && ban.userId === userId);
    if (!existing) throw new ApiRequestError(404, 'Ban not found');
    mockBans = mockBans.filter((ban) => ban !== existing);
    mockAuditLog = [
      {
        id: `mock-audit-${nonce()}`,
        serverId,
        actorId: mockUser.id,
        action: 'UNBAN',
        targetType: 'USER',
        targetId: userId,
        metadata: {},
        createdAt: new Date().toISOString(),
      },
      ...mockAuditLog,
    ];
  }
  async createReport(input: CreateReportRequest) {
    const report: Report = {
      id: `mock-report-${Date.now()}`,
      reporterId: mockUser.id,
      serverId: input.serverId ?? null,
      messageId: input.messageId ?? null,
      targetUserId: input.targetUserId ?? null,
      reason: input.reason,
      status: 'OPEN',
      resolution: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    mockReports = [...mockReports, report];
    if (report.serverId) {
      mockAuditLog = [
        {
          id: `mock-audit-${nonce()}`,
          serverId: report.serverId,
          actorId: mockUser.id,
          action: 'REPORT_CREATE',
          targetType: 'REPORT',
          targetId: report.id,
          metadata: {},
          createdAt: report.createdAt,
        },
        ...mockAuditLog,
      ];
    }
    return report;
  }
  async getReports(serverId: string) {
    return {
      items: mockReports.filter((report) => report.serverId === serverId),
      nextCursor: null,
    };
  }
  async updateReport(serverId: string, input: UpdateReportRequest) {
    const current = mockReports.find(
      (report) => report.id === input.reportId && report.serverId === serverId,
    );
    if (!current) throw new ApiRequestError(404, 'Report not found');
    const updated: Report = {
      ...current,
      status: input.status,
      resolution: input.resolution ?? current.resolution,
      resolvedAt:
        input.status === 'RESOLVED' || input.status === 'DISMISSED'
          ? new Date().toISOString()
          : null,
    };
    mockReports = mockReports.map((report) => (report.id === updated.id ? updated : report));
    mockAuditLog = [
      {
        id: `mock-audit-${nonce()}`,
        serverId,
        actorId: mockUser.id,
        action: 'REPORT_UPDATE',
        targetType: 'REPORT',
        targetId: updated.id,
        metadata: { status: updated.status },
        createdAt: new Date().toISOString(),
      },
      ...mockAuditLog,
    ];
    return updated;
  }
  async getAuditLog(serverId: string) {
    return {
      items: mockAuditLog.filter((entry) => entry.serverId === serverId),
      nextCursor: null,
    };
  }
  async createUpload(): Promise<Attachment> {
    throw new ApiRequestError(
      503,
      'Uploads require the local Guilda backend',
      'UPLOAD_UNAVAILABLE',
    );
  }
  async getAttachmentContent(): Promise<Blob> {
    throw new ApiRequestError(503, 'Attachments require the local Guilda backend');
  }
  async getMediaToken(): Promise<MediaTokenResponse> {
    throw new ApiRequestError(503, 'Media requires the local Guilda backend', 'MEDIA_UNAVAILABLE');
  }
  async getVoiceState(): Promise<MediaVoiceStateResponse> {
    return {
      channels: [
        {
          channelId: 'quiet-room',
          participants: [
            {
              identity: mockUser.id,
              displayName: mockUser.displayName,
              isSpeaking: true,
              microphoneEnabled: true,
              cameraEnabled: true,
              screenShareEnabled: false,
              deafened: false,
            },
            {
              identity: mockNoa.id,
              displayName: mockNoa.displayName,
              isSpeaking: false,
              microphoneEnabled: false,
              cameraEnabled: false,
              screenShareEnabled: false,
              deafened: true,
            },
            {
              identity: mockAri.id,
              displayName: mockAri.displayName,
              isSpeaking: false,
              microphoneEnabled: true,
              cameraEnabled: false,
              screenShareEnabled: true,
              deafened: false,
            },
          ],
        },
      ],
    };
  }
}

export const api: GuildaApi = isMockMode ? new MockApi() : new HttpApi();
export { API_URL };
