import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import type { Repository } from './repository.js';
import { createRealtimeDatabase, createRealtimePlugin } from './realtime/index.js';
import { loadConfig, type Config } from './config.js';
import { errorHandler } from './http/errors.js';
import { AuthService } from './modules/auth.js';
import { registerAuthRoutes } from './http/auth.js';
import { registerServerRoutes } from './http/servers.js';
import { registerMessageRoutes } from './http/messages.js';
import { registerModerationRoutes } from './http/moderation.js';
import { registerUploadRoutes } from './http/uploads.js';
import { registerSocialRoutes } from './http/social.js';
import { registerMediaRoutes } from './modules/media/routes.js';

export interface AppOptions {
  repo: Repository;
  config?: Config;
  logger?: boolean;
}
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger ?? true,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });
  app.setErrorHandler(errorHandler);
  const allowedOrigins = new Set(config.CORS_ORIGIN);
  await app.register(cors, {
    credentials: true,
    maxAge: 600,
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => request.ip,
  });
  app.get('/health', async () => ({ status: 'ok', service: 'guilda-server' }));
  app.get('/ready', async (_request, reply) => {
    try {
      if (options.repo.healthcheck) await options.repo.healthcheck();
      else throw new Error('repository healthcheck unavailable');
      return { status: 'ready' };
    } catch (error) {
      app.log.warn({ err: error }, 'readiness dependency unavailable');
      return reply.status(503).send({ status: 'not_ready' });
    }
  });
  const auth = new AuthService(options.repo, config);
  await registerAuthRoutes(app, auth);
  await app.register(
    createRealtimePlugin({
      database: createRealtimeDatabase(options.repo),
      tokenVerifier: {
        async verifyAccessToken(token) {
          const userId = await auth.verifyAccessToken(token);
          return { userId, sessionId: token.slice(-16) };
        },
      },
      corsOrigin: config.CORS_ORIGIN,
    }),
  );
  await registerServerRoutes(app, options.repo, auth);
  await registerMessageRoutes(app, options.repo, auth);
  await registerModerationRoutes(app, options.repo, auth);
  await registerSocialRoutes(app, options.repo, auth);
  await registerMediaRoutes(app, options.repo, auth, config);
  await registerUploadRoutes(app, options.repo, auth, config);
  return app;
}
