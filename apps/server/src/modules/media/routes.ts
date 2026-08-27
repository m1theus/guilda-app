import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Permission, type MediaTokenRequest } from '@guilda/types';
import { RoomServiceClient } from 'livekit-server-sdk';
import { z } from 'zod';
import type { Config } from '../../config.js';
import type { Repository } from '../../repository.js';
import { authenticate, type AuthenticatedRequest, parse } from '../../http/auth.js';
import { requireServerPermission } from '../permissions.js';
import { unauthorized } from '../../http/errors.js';
import {
  MediaAuthorizationError,
  MediaAuthorizationService,
  type MediaUser,
} from './authorization.js';
import type { MediaMembershipRepository } from './authorization.js';
import type { AuthService } from '../auth.js';
import { loadVoiceChannelStates, type MediaRoomAdmin } from './voiceState.js';

const mediaTokenSchema = z.object({ channelId: z.string().min(1) });
const serverParamsSchema = z.object({ serverId: z.string().min(1) });

function userId(request: FastifyRequest): string {
  return (request as AuthenticatedRequest).userId;
}

function mediaMemberships(repo: Repository): MediaMembershipRepository {
  return {
    findVoiceChannel: async (channelId) => {
      const channel = await repo.getChannel(channelId);
      if (!channel || channel.type !== 'VOICE') {
        return null;
      }
      return { id: channel.id, serverId: channel.serverId, name: channel.name, type: 'VOICE' };
    },
    isMember: async (memberId, serverId) => Boolean(await repo.getMembership(serverId, memberId)),
    getPermissionBits: async (memberId, channelId) => {
      const channel = await repo.getChannel(channelId);
      if (!channel) {
        return 0;
      }
      const member = await repo.getMembership(channel.serverId, memberId);
      return member?.permissions ?? 0;
    },
  };
}

async function currentMediaUser(repo: Repository, request: FastifyRequest): Promise<MediaUser> {
  const user = await repo.findUserById(userId(request));
  if (!user) {
    throw unauthorized();
  }
  return { id: user.id, displayName: user.displayName };
}

function sendMediaError(reply: FastifyReply, error: MediaAuthorizationError): void {
  reply.code(error.statusCode).send({ code: error.code, message: error.message });
}

/** Registers authenticated LiveKit token and voice-state routes. */
export async function registerMediaRoutes(
  app: FastifyInstance,
  repo: Repository,
  auth: AuthService,
  config: Config,
  roomAdmin: MediaRoomAdmin = new RoomServiceClient(
    config.LIVEKIT_URL,
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
  ),
): Promise<void> {
  const authorization = new MediaAuthorizationService(mediaMemberships(repo), {
    livekitUrl: config.LIVEKIT_URL,
    livekitApiKey: config.LIVEKIT_API_KEY,
    livekitApiSecret: config.LIVEKIT_API_SECRET,
  });

  app.get(
    '/servers/:serverId/voice-state',
    { preHandler: async (request) => authenticate(request, auth) },
    async (request) => {
      const { serverId } = parse(serverParamsSchema, request.params);
      const currentUserId = userId(request);
      await requireServerPermission(repo, serverId, currentUserId, Permission.VIEW_CHANNEL);
      const snapshot = await repo.getSnapshot(serverId, currentUserId);
      return loadVoiceChannelStates(
        roomAdmin,
        snapshot.channels
          .filter((channel) => channel.type === 'VOICE')
          .map((channel) => channel.id),
      );
    },
  );

  app.post(
    '/media/token',
    { preHandler: async (request) => authenticate(request, auth) },
    async (request, reply) => {
      const body = parse(mediaTokenSchema, request.body) as MediaTokenRequest;
      try {
        return await authorization.issueToken(
          await currentMediaUser(repo, request),
          body.channelId,
        );
      } catch (error) {
        if (error instanceof MediaAuthorizationError) {
          sendMediaError(reply, error);
          return;
        }
        throw error;
      }
    },
  );
}
