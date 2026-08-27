import { AccessToken } from 'livekit-server-sdk';
import { Permission, type MediaTokenResponse } from '@guilda/types';

export interface MediaUser {
  id: string;
  displayName: string;
}

export interface VoiceChannel {
  id: string;
  serverId: string;
  name: string;
  type: 'VOICE';
}

export interface MediaMembershipRepository {
  findVoiceChannel(channelId: string): Promise<VoiceChannel | null>;
  isMember(userId: string, serverId: string): Promise<boolean>;
  getPermissionBits(userId: string, channelId: string): Promise<number>;
}

export interface MediaTokenConfig {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
}

export class MediaAuthorizationError extends Error {
  readonly statusCode: 403 | 404;
  readonly code: 'VOICE_CHANNEL_NOT_FOUND' | 'VOICE_CHANNEL_ACCESS_DENIED';

  constructor(
    code: 'VOICE_CHANNEL_NOT_FOUND' | 'VOICE_CHANNEL_ACCESS_DENIED',
    message: string,
    statusCode: 403 | 404,
  ) {
    super(message);
    this.name = 'MediaAuthorizationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const REQUIRED_PERMISSIONS = Permission.CONNECT | Permission.SPEAK | Permission.STREAM;

export class MediaAuthorizationService {
  constructor(
    private readonly memberships: MediaMembershipRepository,
    private readonly config: MediaTokenConfig,
  ) {}

  async issueToken(user: MediaUser, channelId: string): Promise<MediaTokenResponse> {
    const channel = await this.memberships.findVoiceChannel(channelId);
    if (!channel) {
      throw new MediaAuthorizationError(
        'VOICE_CHANNEL_NOT_FOUND',
        'The requested voice channel does not exist.',
        404,
      );
    }

    const [isMember, permissionBits] = await Promise.all([
      this.memberships.isMember(user.id, channel.serverId),
      this.memberships.getPermissionBits(user.id, channel.id),
    ]);
    if (!isMember || (permissionBits & REQUIRED_PERMISSIONS) !== REQUIRED_PERMISSIONS) {
      throw new MediaAuthorizationError(
        'VOICE_CHANNEL_ACCESS_DENIED',
        'You need channel membership and CONNECT, SPEAK, and STREAM permissions.',
        403,
      );
    }

    const roomName = `voice:${channel.id}`;
    const participantIdentity = user.id;
    const token = new AccessToken(this.config.livekitApiKey, this.config.livekitApiSecret, {
      identity: participantIdentity,
      name: user.displayName,
      ttl: '1h',
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe: true,
      canPublish: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    });

    return {
      url: this.config.livekitUrl,
      token: await token.toJwt(),
      roomName,
      participantIdentity,
    };
  }
}
