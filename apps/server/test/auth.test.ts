import { describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/auth.js';
import type { Config } from '../src/config.js';
import type {
  AttachmentRecord,
  CreateAttachmentRecord,
  RefreshSession,
  Repository,
  StoredUser,
} from '../src/repository.js';

const config = {
  ACCESS_TOKEN_TTL_SECONDS: 60,
  REFRESH_TOKEN_TTL_SECONDS: 3_600,
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long', // gitleaks:allow
} as Config;

const user = (id = 'user-1'): StoredUser => ({
  id,
  username: id,
  displayName: id,
  email: `${id}@example.test`,
  avatarUrl: null,
  pronouns: null,
  bio: null,
  bannerUrl: null,
  profileColor: null,
  status: 'OFFLINE',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  passwordHash: '',
});

class AuthRepository {
  readonly users = new Map<string, StoredUser>();
  readonly sessions = new Map<string, RefreshSession>();
  readonly revokedFamilies: string[] = [];
  private sequence = 0;

  findUserByEmail = async (email: string) =>
    [...this.users.values()].find((candidate) => candidate.email === email) ?? null;
  findUserByUsername = async (username: string) =>
    [...this.users.values()].find((candidate) => candidate.username === username) ?? null;
  findUserById = async (id: string) => this.users.get(id) ?? null;
  updateUserProfile = async (id: string, input: Partial<StoredUser>) => {
    const current = this.users.get(id);
    if (!current) return null;
    const updated = { ...current, ...input, updatedAt: new Date().toISOString() };
    this.users.set(id, updated);
    return updated;
  };
  createUser = async (input: {
    username: string;
    displayName: string;
    email: string;
    passwordHash: string;
  }) => {
    const created = { ...user(`user-${++this.sequence}`), ...input };
    this.users.set(created.id, created);
    return created;
  };
  createRefreshSession = async (input: Omit<RefreshSession, 'revokedAt' | 'replacedBy'>) => {
    const session = { ...input, revokedAt: null, replacedBy: null };
    this.sessions.set(session.id, session);
    return session;
  };
  findRefreshSession = async (id: string) => this.sessions.get(id) ?? null;
  revokeRefreshFamily = async (familyId: string) => {
    this.revokedFamilies.push(familyId);
    for (const session of this.sessions.values())
      if (session.familyId === familyId) session.revokedAt = new Date();
  };
  rotateRefreshSession = async (id: string, replacement: RefreshSession) => {
    const current = this.sessions.get(id);
    if (!current || current.revokedAt) throw new Error('refresh rotation lost race');
    current.revokedAt = new Date();
    current.replacedBy = replacement.id;
    this.sessions.set(replacement.id, replacement);
  };

  // These methods are intentionally unsupported: a test that accidentally reaches
  // an unrelated domain operation must fail rather than silently pass.
  private unsupported(name: string): never {
    throw new Error(`unsupported fixture operation: ${name}`);
  }
  getChannel = async (_id: string) => this.unsupported('getChannel');
  close = async () => undefined;
  listServersForUser = async (_userId: string) => this.unsupported('listServersForUser');
  createServer = async (_input: { name: string; ownerId: string }) =>
    this.unsupported('createServer');
  getServer = async (_id: string) => this.unsupported('getServer');
  getMembership = async (_serverId: string, _userId: string) => this.unsupported('getMembership');
  listMembers = async (_serverId: string) => this.unsupported('listMembers');
  getSnapshot = async (_serverId: string) => this.unsupported('getSnapshot');
  createChannel = async (_input: { serverId: string; name: string; type: 'TEXT' | 'VOICE' }) =>
    this.unsupported('createChannel');
  createInvite = async (_input: {
    serverId: string;
    createdById: string;
    expiresAt: Date | null;
    maxUses: number | null;
  }) => this.unsupported('createInvite');
  getInvite = async (_code: string) => this.unsupported('getInvite');
  acceptInvite = async (_code: string, _userId: string) => this.unsupported('acceptInvite');
  listMessages = async (_input: { channelId: string; cursor?: string; limit: number }) =>
    this.unsupported('listMessages');
  createMessage = async (_input: {
    channelId: string;
    authorId: string;
    content: string;
    replyToId: string | null;
    attachmentIds: string[];
    clientNonce: string;
  }) => this.unsupported('createMessage');
  getMessage = async (_id: string) => this.unsupported('getMessage');
  updateMessage = async (_id: string, _content: string) => this.unsupported('updateMessage');
  deleteMessage = async (_id: string) => this.unsupported('deleteMessage');
  createAttachment = async (_input: CreateAttachmentRecord) => this.unsupported('createAttachment');
  getAttachment = async (_id: string): Promise<AttachmentRecord | null> =>
    this.unsupported('getAttachment');
  markAttachmentReady = async (_id: string, _userId: string): Promise<AttachmentRecord | null> =>
    this.unsupported('markAttachmentReady');
}

describe('refresh token rotation', () => {
  it('rotates a refresh token and rejects the consumed token', async () => {
    const repo = new AuthRepository();
    const created = user();
    repo.users.set(created.id, created);
    const service = new AuthService(repo as unknown as Repository, config);
    const initial = await service
      .login({ email: created.email, password: 'wrong-but-hash-is-overridden' })
      .catch(() => null);
    // Seed through the real register path so password hashing and token issuance are exercised.
    const registered = await service.register({
      username: 'alice',
      displayName: 'Alice',
      email: 'alice@example.test',
      password: 'correct horse battery staple',
    });
    expect(initial).toBeNull();

    const rotated = await service.refresh(registered.refreshToken);
    expect(rotated.refreshToken).not.toBe(registered.refreshToken);
    await expect(service.refresh(registered.refreshToken)).rejects.toThrow(/replay|invalid/i);
    expect(repo.revokedFamilies).toHaveLength(1);
  });

  it('persists profile updates and returns the updated public user', async () => {
    const repo = new AuthRepository();
    const service = new AuthService(repo as unknown as Repository, config);
    const registered = await service.register({
      username: 'profile-user',
      displayName: 'Profile User',
      email: 'profile@example.test',
      password: 'correct horse battery staple',
    });

    const updated = await service.updateProfile(registered.user.id, {
      displayName: 'Updated User',
      pronouns: 'they/them',
      bio: 'A short bio',
      avatarUrl: 'https://cdn.example.test/avatar.png',
      bannerUrl: 'https://cdn.example.test/banner.png',
      profileColor: '#112233',
    });

    expect(updated).toMatchObject({
      id: registered.user.id,
      displayName: 'Updated User',
      pronouns: 'they/them',
      bio: 'A short bio',
      avatarUrl: 'https://cdn.example.test/avatar.png',
      bannerUrl: 'https://cdn.example.test/banner.png',
      profileColor: '#112233',
    });
    await expect(service.currentUser(registered.user.id)).resolves.toMatchObject(updated);
  });

  it('allows at most one concurrent rotation of a token', async () => {
    const repo = new AuthRepository();
    const service = new AuthService(repo as unknown as Repository, config);
    const registered = await service.register({
      username: 'bob',
      displayName: 'Bob',
      email: 'bob@example.test',
      password: 'correct horse battery staple',
    });
    const outcomes = await Promise.allSettled([
      service.refresh(registered.refreshToken),
      service.refresh(registered.refreshToken),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  });
});
