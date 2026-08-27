import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server } from 'socket.io';
import type { RedisPresenceClient } from './contracts.js';

export interface RedisResources {
  presence: RedisPresenceClient;
  configureAdapter(io: Server): void;
  close(): Promise<void>;
}

/** Small local fallback keeps development and isolated tests deterministic. */
export class MemoryPresenceClient implements RedisPresenceClient {
  private readonly values = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(message: string) => void>>();

  public async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  public async set(key: string, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return 'OK';
  }

  public async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }

  public async publish(channel: string, message: string): Promise<number> {
    const listeners = this.listeners.get(channel);
    if (!listeners) return 0;
    for (const listener of listeners) listener(message);
    return listeners.size;
  }

  public async subscribe(channel: string, listener: (message: string) => void): Promise<void> {
    const listeners = this.listeners.get(channel) ?? new Set<(message: string) => void>();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }
}

export const createRedisResources = async (
  redisUrl: string | undefined,
): Promise<RedisResources> => {
  if (!redisUrl) {
    return {
      presence: new MemoryPresenceClient(),
      configureAdapter: () => {},
      async close(): Promise<void> {},
    };
  }
  const publisher = createClient({ url: redisUrl });
  const adapterSubscriber = publisher.duplicate();
  const presenceSubscriber = publisher.duplicate();
  await Promise.all([
    publisher.connect(),
    adapterSubscriber.connect(),
    presenceSubscriber.connect(),
  ]);

  const presence: RedisPresenceClient = {
    get: (key) => publisher.get(key),
    async set(key, value, ...args): Promise<unknown> {
      const mode = args[0];
      const seconds = args[1];
      if (mode === 'EX' && typeof seconds === 'number') {
        return publisher.set(key, value, { EX: seconds });
      }
      return publisher.set(key, value);
    },
    del: (key) => publisher.del(key),
    publish: (channel, message) => publisher.publish(channel, message),
    subscribe: async (channel, listener) => {
      await presenceSubscriber.subscribe(channel, listener);
    },
  };
  return {
    presence,
    configureAdapter(io: Server): void {
      io.adapter(createAdapter(publisher, adapterSubscriber));
    },
    async close(): Promise<void> {
      await Promise.allSettled([
        publisher.quit(),
        adapterSubscriber.quit(),
        presenceSubscriber.quit(),
      ]);
    },
  };
};
