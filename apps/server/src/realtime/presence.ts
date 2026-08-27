import type { PresenceStatus } from '@guilda/types';
import type { RedisPresenceClient, RealtimeStatus } from './contracts.js';

export const PRESENCE_CHANNEL = 'guilda:presence';
const INSTANCE_ID = Math.random().toString(36).slice(2);
const PRESENCE_TTL_SECONDS = 90;
const DEFAULT_DISCONNECT_GRACE_MS = 5_000;

export interface PresenceBroadcast {
  userId: string;
  status: PresenceStatus;
}

type RedisPresenceMessage = PresenceBroadcast & { source?: string };

export const presenceKey = (userId: string): string => `guilda:presence:${userId}`;
export const isRealtimeStatus = (status: unknown): status is RealtimeStatus =>
  status === 'ONLINE' || status === 'IDLE' || status === 'DND';

export interface PresenceStoreOptions {
  redis: RedisPresenceClient;
  disconnectGraceMs?: number | undefined;
  onStatus: (event: PresenceBroadcast) => void;
}

/** Presence is Redis-only; disconnect grace prevents reconnect flapping. */
export class PresenceStore {
  private readonly disconnectGraceMs: number;
  private readonly connections = new Map<string, number>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly options: PresenceStoreOptions;

  public constructor(options: PresenceStoreOptions) {
    this.options = options;
    this.disconnectGraceMs = options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
  }

  public async start(): Promise<void> {
    await this.options.redis.subscribe(PRESENCE_CHANNEL, (message) => {
      try {
        const event = JSON.parse(message) as RedisPresenceMessage;
        if (event.source === INSTANCE_ID) return;
        if (typeof event.userId !== 'string' || typeof event.status !== 'string') return;
        this.options.onStatus({ userId: event.userId, status: event.status });
      } catch {
        // Redis messages are untrusted input; ignore malformed broadcasts.
      }
    });
  }

  public async connect(userId: string): Promise<void> {
    const current = this.connections.get(userId) ?? 0;
    this.connections.set(userId, current + 1);
    const timer = this.disconnectTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(userId);
    }
    await this.setStatus(userId, 'ONLINE');
  }

  public disconnect(userId: string): void {
    const current = this.connections.get(userId) ?? 0;
    const remaining = Math.max(0, current - 1);
    if (remaining > 0) {
      this.connections.set(userId, remaining);
      return;
    }
    this.connections.delete(userId);
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(userId);
      if (!this.connections.has(userId)) void this.setStatus(userId, 'OFFLINE');
    }, this.disconnectGraceMs);
    this.disconnectTimers.set(userId, timer);
  }

  public async setClientStatus(userId: string, status: unknown): Promise<boolean> {
    if (!isRealtimeStatus(status)) return false;
    await this.setStatus(userId, status);
    return true;
  }

  public async close(): Promise<void> {
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
    this.connections.clear();
  }

  private async setStatus(userId: string, status: PresenceStatus): Promise<void> {
    await this.options.redis.set(presenceKey(userId), status, 'EX', PRESENCE_TTL_SECONDS);
    const event: RedisPresenceMessage = { userId, status, source: INSTANCE_ID };
    await this.options.redis.publish(PRESENCE_CHANNEL, JSON.stringify(event));
    this.options.onStatus({ userId, status });
  }
}
