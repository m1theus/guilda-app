import { useEffect, useState } from 'react';
import type { MediaTokenResponse } from '@guilda/types';
import { MediaControls } from './MediaControls';
import { ParticipantGrid, type ParticipantProfile } from './ParticipantGrid';
import { useMediaRoom } from './useMediaRoom';
import type { MediaRoomControllerOptions, MediaRoomSnapshot } from './roomController';

export interface MediaRoomPanelProps extends MediaRoomControllerOptions {
  token?: MediaTokenResponse;
  members?: readonly ParticipantProfile[];
  mutedMemberIds?: ReadonlySet<string>;
  onLeave?: () => void;
  onVoiceStateChange?: (state: Pick<MediaRoomSnapshot, 'state' | 'participants'>) => void;
}
export function MediaRoomPanel({
  token,
  members,
  mutedMemberIds,
  sourcePicker,
  onLeave,
  onVoiceStateChange,
}: MediaRoomPanelProps): JSX.Element {
  const room = useMediaRoom(sourcePicker ? { sourcePicker } : {});
  const [joinAttempt, setJoinAttempt] = useState(0);
  const [joinError, setJoinError] = useState<string | null>(null);
  const leaveVoice = async (): Promise<void> => {
    await room.controller.leave();
    onLeave?.();
  };

  useEffect(() => {
    if (!token) return;
    setJoinError(null);
    void room.controller.join(token).then(
      () => setJoinError(null),
      () => setJoinError('Could not join the voice channel. Check the connection and retry.'),
    );
  }, [joinAttempt, room.controller, token?.token]);
  useEffect(() => {
    onVoiceStateChange?.({ state: room.state, participants: room.participants });
  }, [onVoiceStateChange, room.participants, room.state]);
  return (
    <section className="media-room-panel" aria-label="Voice channel" data-media-state={room.state}>
      {room.error || joinError ? (
        <p role="alert" data-media-error={room.error?.code ?? 'MEDIA_JOIN_FAILED'}>
          {room.error?.message ?? joinError}
        </p>
      ) : null}
      {(room.state === 'error' || room.state === 'disconnected') && token ? (
        <button
          type="button"
          className="media-retry"
          onClick={() => setJoinAttempt((attempt) => attempt + 1)}
        >
          Retry connection
        </button>
      ) : null}
      <ParticipantGrid
        controller={room.controller}
        participants={room.participants}
        {...(members ? { members } : {})}
        {...(mutedMemberIds ? { mutedParticipantIds: mutedMemberIds } : {})}
        focusedShareIdentity={room.focusedShareIdentity}
        onFocusShare={room.focusShare}
      />
      <MediaControls
        devices={room.devices}
        capabilities={room.capabilities}
        state={room.state}
        connectionQuality={room.connectionQuality}
        pingMs={room.pingMs}
        activeInputDeviceId={room.activeInputDeviceId}
        activeOutputDeviceId={room.activeOutputDeviceId}
        activeCameraDeviceId={room.activeCameraDeviceId}
        microphoneEnabled={room.microphoneEnabled}
        cameraEnabled={room.cameraEnabled}
        screenShareEnabled={room.screenShareEnabled}
        deafened={room.deafened}
        onMicrophoneChange={room.setMicrophoneEnabled}
        onCameraChange={room.setCameraEnabled}
        onScreenShareChange={room.setScreenShareEnabled}
        onDeafenedChange={room.setDeafened}
        onInputDeviceChange={room.setInputDevice}
        onOutputDeviceChange={room.setOutputDevice}
        onCameraDeviceChange={room.setCameraDevice}
        {...(room.state !== 'leaving' ? { onLeave: leaveVoice } : {})}
      />
    </section>
  );
}
