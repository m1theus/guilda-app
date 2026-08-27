import { TrackSource } from 'livekit-server-sdk';
import type { MediaVoiceStateResponse } from '@guilda/types';

interface RoomSummary {
  name: string;
}

interface TrackSummary {
  source: TrackSource;
  muted: boolean;
}

interface ParticipantSummary {
  identity: string;
  name: string;
  attributes: Record<string, string>;
  tracks: TrackSummary[];
}

export interface MediaRoomAdmin {
  listRooms(names?: string[]): Promise<readonly RoomSummary[]>;
  listParticipants(room: string): Promise<readonly ParticipantSummary[]>;
}

export async function loadVoiceChannelStates(
  roomAdmin: MediaRoomAdmin,
  channelIds: readonly string[],
): Promise<MediaVoiceStateResponse> {
  const roomNames = channelIds.map((channelId) => roomName(channelId));
  const activeRooms = new Set((await roomAdmin.listRooms(roomNames)).map((room) => room.name));

  return {
    channels: await Promise.all(
      channelIds.map(async (channelId) => {
        const name = roomName(channelId);
        if (!activeRooms.has(name)) return { channelId, participants: [] };

        const participants = (await roomAdmin.listParticipants(name))
          .map((participant) => {
            const microphone = participant.tracks.find(
              (track) => track.source === TrackSource.MICROPHONE,
            );
            return {
              identity: participant.identity,
              displayName: participant.name || participant.identity,
              isSpeaking: false,
              microphoneEnabled: Boolean(microphone && !microphone.muted),
              cameraEnabled: hasEnabledTrack(participant, TrackSource.CAMERA),
              screenShareEnabled: hasEnabledTrack(participant, TrackSource.SCREEN_SHARE),
              deafened: participant.attributes['guilda.deafened'] === 'true',
            };
          })
          .sort((left, right) => left.displayName.localeCompare(right.displayName));

        return { channelId, participants };
      }),
    ),
  };
}

function roomName(channelId: string): string {
  return `voice:${channelId}`;
}

function hasEnabledTrack(participant: ParticipantSummary, source: TrackSource): boolean {
  return participant.tracks.some((track) => track.source === source && !track.muted);
}
