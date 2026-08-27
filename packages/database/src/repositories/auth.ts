import { createHash, randomUUID } from 'node:crypto';
import type { RegisterRequest, UpdateProfileRequest, User as UserContract } from '@guilda/types';
import type { Prisma, Session, User as PrismaUser } from '@prisma/client';
import { prisma } from '../client';

export type CreateUserInput = RegisterRequest & {
  passwordHash: string;
};

export type CreateSessionInput = {
  userId: string;
  refreshToken: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
};

export function hashRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

export function toUserContract(
  user: Pick<
    PrismaUser,
    | 'id'
    | 'username'
    | 'displayName'
    | 'email'
    | 'avatarUrl'
    | 'pronouns'
    | 'bio'
    | 'bannerUrl'
    | 'profileColor'
    | 'status'
    | 'createdAt'
    | 'updatedAt'
  >,
): UserContract {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl,
    pronouns: user.pronouns,
    bio: user.bio,
    bannerUrl: user.bannerUrl,
    profileColor: user.profileColor,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function createUser(input: CreateUserInput): Promise<UserContract> {
  const user = await prisma.user.create({
    data: {
      username: input.username,
      displayName: input.displayName,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
    },
  });
  return toUserContract(user);
}

export function findUserByEmail(email: string): Promise<PrismaUser | null> {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

export async function findUserContractById(id: string): Promise<UserContract | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toUserContract(user) : null;
}

export async function updateUserProfile(
  id: string,
  input: UpdateProfileRequest,
): Promise<UserContract | null> {
  const user = await prisma.user.update({
    where: { id },
    data: input,
  });
  return toUserContract(user);
}

export function createSession(input: CreateSessionInput): Promise<Session> {
  const data: Prisma.SessionUncheckedCreateInput = {
    id: randomUUID(),
    userId: input.userId,
    refreshTokenHash: hashRefreshToken(input.refreshToken),
    expiresAt: input.expiresAt,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
  };
  return prisma.session.create({ data });
}

export function findSessionByRefreshToken(refreshToken: string): Promise<Session | null> {
  return prisma.session.findUnique({ where: { refreshTokenHash: hashRefreshToken(refreshToken) } });
}

export async function rotateSession(input: {
  refreshToken: string;
  nextRefreshToken: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}): Promise<Session> {
  const currentHash = hashRefreshToken(input.refreshToken);
  const nextHash = hashRefreshToken(input.nextRefreshToken);

  return prisma.$transaction(async (tx) => {
    const current = await tx.session.findUnique({ where: { refreshTokenHash: currentHash } });
    if (!current || current.revokedAt || current.expiresAt <= new Date()) {
      throw new Error('Invalid or expired refresh token');
    }

    const next = await tx.session.create({
      data: {
        userId: current.userId,
        refreshTokenHash: nextHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent ?? current.userAgent,
        ipAddress: input.ipAddress ?? current.ipAddress,
      },
    });
    const revoked = await tx.session.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: new Date(), rotatedAt: new Date(), replacedById: next.id },
    });
    if (revoked.count !== 1) {
      throw new Error('Refresh token was already rotated');
    }
    return next;
  });
}

export async function revokeSessionByRefreshToken(refreshToken: string): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
