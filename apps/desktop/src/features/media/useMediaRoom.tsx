import { useEffect, useRef, useState } from 'react';
import type { MediaTokenResponse } from '@guilda/types';
import {
  MediaRoomController,
  type MediaRoomControllerOptions,
  type MediaRoomSnapshot,
} from './roomController';
import type { ScreenShareRequest } from './platform';

export interface UseMediaRoomResult extends MediaRoomSnapshot {
  controller: MediaRoomController;
  join(token: MediaTokenResponse): Promise<void>;
  leave(): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  setScreenShareEnabled(enabled: boolean, request?: ScreenShareRequest): Promise<void>;
  setInputDevice(deviceId: string): Promise<void>;
  setOutputDevice(deviceId: string): Promise<void>;
  setCameraDevice(deviceId: string): Promise<void>;
  setDeafened(deafened: boolean): Promise<void>;
  focusShare(identity: string | null): void;
  attachParticipantVideo: MediaRoomController['attachParticipantVideo'];
  attachParticipantAudio: MediaRoomController['attachParticipantAudio'];
}

export function useMediaRoom(options: MediaRoomControllerOptions = {}): UseMediaRoomResult {
  const controller = useRef<MediaRoomController | null>(null);
  if (!controller.current) {
    controller.current = new MediaRoomController(options);
  }
  const room = controller.current;
  const [snapshot, setSnapshot] = useState<MediaRoomSnapshot>(room.getSnapshot());

  useEffect(() => {
    const unsubscribe = room.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      void room.leave().catch(() => {
        console.error('[media:MEDIA_CLEANUP_FAILED]');
      });
    };
  }, [room]);
  return {
    ...snapshot,
    controller: room,
    join: room.join.bind(room),
    leave: room.leave.bind(room),
    setMicrophoneEnabled: room.setMicrophoneEnabled.bind(room),
    setCameraEnabled: room.setCameraEnabled.bind(room),
    setScreenShareEnabled: room.setScreenShareEnabled.bind(room),
    setInputDevice: room.setInputDevice.bind(room),
    setOutputDevice: room.setOutputDevice.bind(room),
    setCameraDevice: room.setCameraDevice.bind(room),
    setDeafened: room.setDeafened.bind(room),
    focusShare: room.focusShare.bind(room),
    attachParticipantVideo: room.attachParticipantVideo.bind(room),
    attachParticipantAudio: room.attachParticipantAudio.bind(room),
  };
}
