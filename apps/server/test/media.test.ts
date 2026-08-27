import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { Permission } from '@guilda/types';
import { TrackSource } from 'livekit-server-sdk';
import { decodeJwt } from 'jose';
import type { Config } from '../src/config.js';
import { errorHandler } from '../src/http/errors.js';
import type { AuthService } from '../src/modules/auth.js';
import { registerMediaRoutes } from '../src/modules/media/routes.js';
import type { Repository } from '../src/repository.js';
import {
  type MediaAuthorizationError,
  MediaAuthorizationService,
  type MediaMembershipRepository,
} from '../src/modules/media/authorization.js';
import { loadVoiceChannelStates } from '../src/modules/media/voiceState.js';

const config = {
  livekitUrl: 'https://livekit.example.test',
  livekitApiKey: 'key',
  livekitApiSecret: 'secret-secret-secret',
};

function repository(overrides: Partial<MediaMembershipRepository> = {}): MediaMembershipRepository {
  return {
    findVoiceChannel: async () => ({
      id: 'voice-1',
      serverId: 'server-1',
      name: 'Lounge',
      type: 'VOICE',
    }),
    isMember: async () => true,
    getPermissionBits: async () => Permission.CONNECT | Permission.SPEAK | Permission.STREAM,
    ...overrides,
  };
}

describe('media authorization boundary', () => {
  it('allows clients to publish their own headphone state', async () => {
    const service = new MediaAuthorizationService(repository(), config);
    const response = await service.issueToken({ id: 'member', displayName: 'Member' }, 'voice-1');

    expect(decodeJwt(response.token)).toMatchObject({
      video: { canUpdateOwnMetadata: true, room: 'voice:voice-1' },
    });
  });

  it('denies a valid user who is not a server member', async () => {
    const service = new MediaAuthorizationService(
      repository({ isMember: async () => false }),
      config,
    );
    await expect(
      service.issueToken({ id: 'outsider', displayName: 'Outsider' }, 'voice-1'),
    ).rejects.toMatchObject<Partial<MediaAuthorizationError>>({
      code: 'VOICE_CHANNEL_ACCESS_DENIED',
      statusCode: 403,
    });
  });

  it('denies a member missing any required media capability', async () => {
    const service = new MediaAuthorizationService(
      repository({ getPermissionBits: async () => Permission.CONNECT | Permission.SPEAK }),
      config,
    );
    await expect(
      service.issueToken({ id: 'member', displayName: 'Member' }, 'voice-1'),
    ).rejects.toMatchObject({
      code: 'VOICE_CHANNEL_ACCESS_DENIED',
      statusCode: 403,
    });
  });

  it('does not disclose channel access when the channel is not voice', async () => {
    const service = new MediaAuthorizationService(
      repository({ findVoiceChannel: async () => null }),
      config,
    );
    await expect(
      service.issueToken({ id: 'member', displayName: 'Member' }, 'missing'),
    ).rejects.toMatchObject({
      code: 'VOICE_CHANNEL_NOT_FOUND',
      statusCode: 404,
    });
  });
});

describe('voice channel state', () => {
  it('reports connected participants and their published media state', async () => {
    const state = await loadVoiceChannelStates(
      {
        listRooms: async () => [{ name: 'voice:voice-1' }],
        listParticipants: async () => [
          {
            identity: 'member-1',
            name: 'Mira',
            attributes: { 'guilda.deafened': 'true' },
            tracks: [
              { source: TrackSource.MICROPHONE, muted: true },
              { source: TrackSource.CAMERA, muted: false },
              { source: TrackSource.SCREEN_SHARE, muted: false },
            ],
          },
          {
            identity: 'member-2',
            name: 'Alex',
            attributes: {},
            tracks: [{ source: TrackSource.MICROPHONE, muted: false }],
          },
        ],
      },
      ['voice-1', 'voice-2'],
    );

    expect(state).toEqual({
      channels: [
        {
          channelId: 'voice-1',
          participants: [
            {
              identity: 'member-2',
              displayName: 'Alex',
              isSpeaking: false,
              microphoneEnabled: true,
              cameraEnabled: false,
              screenShareEnabled: false,
              deafened: false,
            },
            {
              identity: 'member-1',
              displayName: 'Mira',
              isSpeaking: false,
              microphoneEnabled: false,
              cameraEnabled: true,
              screenShareEnabled: true,
              deafened: true,
            },
          ],
        },
        { channelId: 'voice-2', participants: [] },
      ],
    });
  });

  it('serves state only to authenticated server members', async () => {
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    const repo = {
      getMembership: async () => ({
        serverId: 'server-1',
        userId: 'member-1',
        permissions: Permission.VIEW_CHANNEL,
      }),
      getSnapshot: async () => ({
        channels: [
          { id: 'voice-1', serverId: 'server-1', name: 'Lounge', type: 'VOICE' },
          { id: 'text-1', serverId: 'server-1', name: 'general', type: 'TEXT' },
        ],
      }),
    } as unknown as Repository;
    const auth = {
      verifyAccessToken: async () => 'member-1',
    } as unknown as AuthService;

    await registerMediaRoutes(
      app,
      repo,
      auth,
      {
        LIVEKIT_URL: config.livekitUrl,
        LIVEKIT_API_KEY: config.livekitApiKey,
        LIVEKIT_API_SECRET: config.livekitApiSecret,
      } as Config,
      {
        listRooms: async (names) => (names ?? []).map((name) => ({ name })),
        listParticipants: async () => [],
      },
    );

    const unauthenticated = await app.inject({
      method: 'GET',
      url: '/servers/server-1/voice-state',
    });
    expect(unauthenticated.statusCode).toBe(401);

    const response = await app.inject({
      method: 'GET',
      url: '/servers/server-1/voice-state',
      headers: { authorization: 'Bearer member-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      channels: [{ channelId: 'voice-1', participants: [] }],
    });
    await app.close();
  });
});
