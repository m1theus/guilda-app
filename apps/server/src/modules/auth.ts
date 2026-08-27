import argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthResponse, AuthTokens, UpdateProfileRequest, User } from '@guilda/types';
import type { Config } from '../config.js';
import { conflict, unauthorized } from '../http/errors.js';
import type { RefreshSession, Repository, StoredUser } from '../repository.js';

const encoder = new TextEncoder();

function publicUser(user: StoredUser): User {
  const { passwordHash, ...safe } = user;
  if (!passwordHash) throw new Error('Stored user password hash missing');
  return safe;
}
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  constructor(
    private readonly repo: Repository,
    private readonly config: Config,
  ) {}

  async register(input: {
    username: string;
    displayName: string;
    email: string;
    password: string;
  }): Promise<AuthResponse> {
    const email = input.email.trim().toLowerCase();
    if (
      (await this.repo.findUserByEmail(email)) ||
      (await this.repo.findUserByUsername(input.username.trim()))
    )
      throw conflict('Email or username already in use');
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const user = await this.repo.createUser({
      username: input.username.trim(),
      displayName: input.displayName.trim(),
      email,
      passwordHash,
    });
    return { ...(await this.issueTokens(user.id)), user: publicUser(user) };
  }

  async login(input: { email: string; password: string }): Promise<AuthResponse> {
    const user = await this.repo.findUserByEmail(input.email.trim().toLowerCase());
    if (!user || !(await argon2.verify(user.passwordHash, input.password)))
      throw unauthorized('Invalid credentials');
    return { ...(await this.issueTokens(user.id)), user: publicUser(user) };
  }

  async currentUser(userId: string): Promise<User> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw unauthorized();
    return publicUser(user);
  }

  async updateProfile(userId: string, input: UpdateProfileRequest): Promise<User> {
    const user = await this.repo.updateUserProfile(userId, input);
    if (!user) throw unauthorized();
    return publicUser(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const [sessionId, secret] = refreshToken.split('.', 2);
    if (!sessionId || !secret) throw unauthorized('Invalid refresh token');
    const session = await this.repo.findRefreshSession(sessionId);
    if (!session || session.expiresAt <= new Date()) throw unauthorized('Invalid refresh token');
    if (session.revokedAt || session.tokenHash !== hashRefreshToken(secret)) {
      await this.repo.revokeRefreshFamily(session?.familyId ?? sessionId);
      throw unauthorized('Refresh token replay detected');
    }
    const user = await this.repo.findUserById(session.userId);
    if (!user) throw unauthorized();
    const nextSecret = randomBytes(48).toString('base64url');
    const nextId = randomUUID();
    const replacement: Omit<RefreshSession, 'revokedAt' | 'replacedBy'> = {
      id: nextId,
      userId: session.userId,
      familyId: session.familyId,
      tokenHash: hashRefreshToken(nextSecret),
      expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000),
    };
    await this.repo.rotateRefreshSession(session.id, {
      ...replacement,
      revokedAt: null,
      replacedBy: nextId,
    });
    const accessToken = await this.signAccessToken(user.id);
    return {
      accessToken,
      refreshToken: `${nextId}.${nextSecret}`,
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const [sessionId] = refreshToken.split('.', 2);
    if (!sessionId) return;
    const session = await this.repo.findRefreshSession(sessionId);
    if (session) await this.repo.revokeRefreshFamily(session.familyId);
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const accessToken = await this.signAccessToken(userId);
    const secret = randomBytes(48).toString('base64url');
    const id = randomUUID();
    await this.repo.createRefreshSession({
      id,
      userId,
      familyId: randomUUID(),
      tokenHash: hashRefreshToken(secret),
      expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    return {
      accessToken,
      refreshToken: `${id}.${secret}`,
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
    };
  }
  private async signAccessToken(userId: string): Promise<string> {
    return new SignJWT({ sub: userId, type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SECONDS}s`)
      .setJti(randomUUID())
      .sign(encoder.encode(this.config.JWT_SECRET));
  }
  async verifyAccessToken(token: string): Promise<string> {
    try {
      const result = await jwtVerify(token, encoder.encode(this.config.JWT_SECRET));
      if (result.payload.type !== 'access' || typeof result.payload.sub !== 'string')
        throw new Error('invalid claims');
      return result.payload.sub;
    } catch {
      throw unauthorized('Invalid access token');
    }
  }
}
