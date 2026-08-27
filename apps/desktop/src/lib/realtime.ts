import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@guilda/types/events';
import type { AuthTokens } from '@guilda/types/api';
import type { PresenceStatus } from '@guilda/types/entities';
import { API_URL, isMockMode } from './api';
import { tokenStore } from './tokenStore';

export type GuildaSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function connectRealtime(tokens: AuthTokens | null): GuildaSocket | null {
  if (isMockMode || !tokens?.accessToken) return null;
  const socket = io(API_URL.replace(/\/api$/, ''), {
    auth: (callback) => {
      void tokenStore.get().then(
        (current) => callback({ accessToken: current?.accessToken ?? '' }),
        () => callback({ accessToken: tokens.accessToken }),
      );
    },
    autoConnect: true,
    transports: ['websocket'],
  });
  socket.on('connect', () => socket.emit('presence:update', { status: 'ONLINE' }));
  socket.on('connect_error', (error) => console.warn('[Guilda realtime]', error.message));
  return socket;
}

export function setPresence(socket: GuildaSocket | null, status: PresenceStatus) {
  socket?.emit('presence:update', { status });
}
