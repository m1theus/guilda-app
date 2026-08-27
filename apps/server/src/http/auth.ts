import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { registerRequestSchema, updateProfileRequestSchema } from '@guilda/validation';
import type { AuthService } from '../modules/auth.js';
import { badRequest, unauthorized } from './errors.js';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const refreshSchema = z.object({ refreshToken: z.string().min(20) });

export interface AuthenticatedRequest extends FastifyRequest {
  userId: string;
}
export function parse<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw badRequest(
      'Invalid request',
      result.error.flatten().fieldErrors as Record<string, string[]>,
    );
  return result.data;
}
export async function authenticate(request: FastifyRequest, auth: AuthService): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  (request as AuthenticatedRequest).userId = await auth.verifyAccessToken(header.slice(7));
}

export async function registerAuthRoutes(app: FastifyInstance, auth: AuthService): Promise<void> {
  app.post('/auth/register', async (request) =>
    auth.register(parse(registerRequestSchema, request.body)),
  );
  app.post('/auth/login', async (request) => auth.login(parse(loginSchema, request.body)));
  app.post('/auth/refresh', async (request) =>
    auth.refresh(parse(refreshSchema, request.body).refreshToken),
  );
  app.post('/auth/logout', async (request) => {
    await auth.logout(parse(refreshSchema, request.body).refreshToken);
    return { ok: true };
  });
  const current = async (request: FastifyRequest) =>
    auth.currentUser((request as AuthenticatedRequest).userId);
  app.get('/auth/me', { preHandler: async (request) => authenticate(request, auth) }, current);
  app.patch(
    '/users/@me',
    { preHandler: async (request) => authenticate(request, auth) },
    async (request) => {
      const body = parse(updateProfileRequestSchema, request.body);
      return auth.updateProfile((request as AuthenticatedRequest).userId, {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.pronouns !== undefined ? { pronouns: body.pronouns } : {}),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        ...(body.bannerUrl !== undefined ? { bannerUrl: body.bannerUrl } : {}),
        ...(body.profileColor !== undefined ? { profileColor: body.profileColor } : {}),
      });
    },
  );
  app.get('/users/@me', { preHandler: async (request) => authenticate(request, auth) }, current);
}
