import { z } from 'zod';

import type { ChannelType } from '@guilda/types';

const entityIdSchema = z.string().trim().min(1).max(128);
const isoDateStringSchema = z.string().datetime({ offset: true });

export const registerRequestSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[a-zA-Z0-9_]+$/),
    displayName: z.string().trim().min(1).max(64),
    email: z.string().trim().email().max(320),
    password: z.string().min(8).max(128),
  })
  .strict();

export const profileUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https:\/\//i.test(value), 'URL must use HTTPS');

export const updateProfileRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(64).optional(),
    pronouns: z.string().trim().max(40).nullable().optional(),
    bio: z.string().trim().max(190).nullable().optional(),
    avatarUrl: profileUrlSchema.nullable().optional(),
    bannerUrl: profileUrlSchema.nullable().optional(),
    profileColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
  })
  .strict();

export type UpdateProfileRequestInput = z.infer<typeof updateProfileRequestSchema>;

export const loginRequestSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(1).max(128),
  })
  .strict();

export const refreshRequestSchema = z
  .object({
    refreshToken: z.string().min(1),
  })
  .strict();

export const logoutRequestSchema = refreshRequestSchema;

export const createServerRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
  })
  .strict();

export const channelTypeSchema = z.enum(['TEXT', 'VOICE'] satisfies [
  ChannelType,
  ...ChannelType[],
]);

export const createChannelRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: channelTypeSchema,
  })
  .strict();

export const createInviteRequestSchema = z
  .object({
    expiresAt: isoDateStringSchema.optional(),
    maxUses: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict();

export const sendMessageRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(4_000),
    replyToId: entityIdSchema.optional(),
    attachmentIds: z.array(entityIdSchema).max(10).optional(),
    clientNonce: z.string().trim().min(1).max(128),
  })
  .strict();

export const updateMessageRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(4_000),
  })
  .strict();

export type RegisterRequestInput = z.infer<typeof registerRequestSchema>;
export type LoginRequestInput = z.infer<typeof loginRequestSchema>;
export type CreateServerRequestInput = z.infer<typeof createServerRequestSchema>;
export type CreateChannelRequestInput = z.infer<typeof createChannelRequestSchema>;
export type CreateInviteRequestInput = z.infer<typeof createInviteRequestSchema>;
export type SendMessageRequestInput = z.infer<typeof sendMessageRequestSchema>;
export type UpdateMessageRequestInput = z.infer<typeof updateMessageRequestSchema>;
