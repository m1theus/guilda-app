import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { AccessTokenVerifier, RedisPresenceClient, RealtimeDatabase } from './contracts.js';
import { PresenceStore } from './presence.js';
import { createRedisResources } from './redis.js';
import { createRealtimeServer, type RealtimeServer } from './server.js';

export interface RealtimePluginOptions {
  database: RealtimeDatabase;
  tokenVerifier: AccessTokenVerifier;
  /** Defaults to REALTIME_REDIS_URL or REDIS_URL. */
  redisUrl?: string;
  /** Inject a connected Redis-like client for presence tests or custom infra. */
  presenceRedis?: RedisPresenceClient;
  disconnectGraceMs?: number;
  corsOrigin?: string | string[] | undefined;
}
declare module 'fastify' {
  interface FastifyInstance {
    realtime: RealtimeServer;
  }
}

const plugin = async (app: FastifyInstance, options: RealtimePluginOptions): Promise<void> => {
  const redisResources = options.presenceRedis
    ? {
        presence: options.presenceRedis,
        configureAdapter: (): void => {},
        close: async (): Promise<void> => {},
      }
    : await createRedisResources(
        options.redisUrl ?? process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL,
      );

  const presence = new PresenceStore({
    redis: redisResources.presence,
    disconnectGraceMs: options.disconnectGraceMs,
    onStatus: (event) => app.realtime?.emitPresence(event.userId, event.status),
  });
  await presence.start();
  const realtime = createRealtimeServer(app.server, {
    database: options.database,
    tokenVerifier: options.tokenVerifier,
    presence,
    corsOrigin: options.corsOrigin,
  });
  redisResources.configureAdapter(realtime.io);
  app.decorate('realtime', realtime);
  app.addHook('onClose', async () => {
    await realtime?.close();
    await redisResources.close();
  });
};

/** Register after Fastify has an HTTP server and the database/auth adapters. */
export const createRealtimePlugin = (options: RealtimePluginOptions): FastifyPluginAsync =>
  fp((app: FastifyInstance) => plugin(app, options), { name: '@guilda/realtime' });

/** Direct hook for apps that do not use `app.register`. */
export const attachRealtime = async (
  app: FastifyInstance,
  options: RealtimePluginOptions,
): Promise<RealtimeServer> => {
  const redisResources = options.presenceRedis
    ? {
        presence: options.presenceRedis,
        configureAdapter: (): void => {},
        close: async (): Promise<void> => {},
      }
    : await createRedisResources(
        options.redisUrl ?? process.env.REALTIME_REDIS_URL ?? process.env.REDIS_URL,
      );
  const presence = new PresenceStore({
    redis: redisResources.presence,
    disconnectGraceMs: options.disconnectGraceMs,
    onStatus: (event) => app.realtime?.emitPresence(event.userId, event.status),
  });
  await presence.start();
  const realtime = createRealtimeServer(app.server, {
    database: options.database,
    tokenVerifier: options.tokenVerifier,
    presence,
    corsOrigin: options.corsOrigin,
  });
  redisResources.configureAdapter(realtime.io);
  app.decorate('realtime', realtime);
  app.addHook('onClose', async () => {
    await realtime?.close();
    await redisResources.close();
  });
  return realtime;
};
