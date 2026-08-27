import {
  ConnectionQuality,
  LocalVideoTrack,
  Room,
  RoomEvent,
  Track,
  type LocalParticipant,
  type Participant,
  type TrackPublication,
} from 'livekit-client';
import type {
  MediaDevice,
  MediaParticipantState,
  MediaTokenResponse,
  PlatformMediaCapabilities,
} from '@guilda/types';
import { nativeBridge } from '../../lib/nativeBridge';
import {
  detectPlatformMediaCapabilities,
  enumerateMediaDevices,
  MediaPlatformError,
  requestScreenShare,
  type ScreenShareRequest,
  WINDOWS_CAPTURE_ERROR_EVENT,
} from './platform';
import { MediaSoundEffects } from './soundEffects';
export type MediaConnectionState =
  'idle' | 'joining' | 'reconnecting' | 'joined' | 'leaving' | 'disconnected' | 'error';

export type MediaConnectionQuality = 'excellent' | 'good' | 'poor' | 'unknown';

export interface MediaRoomSnapshot {
  state: MediaConnectionState;
  connectionQuality: MediaConnectionQuality;
  pingMs: number | null;
  participants: MediaParticipantState[];
  devices: MediaDevice[];
  capabilities: PlatformMediaCapabilities;
  activeInputDeviceId: string | null;
  activeOutputDeviceId: string | null;
  activeCameraDeviceId: string | null;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  deafened: boolean;
  focusedShareIdentity: string | null;
  error: MediaRoomError | null;
}

export interface MediaRoomError {
  code: string;
  message: string;
}

export interface MediaRoomControllerOptions {
  sourcePicker?: (request: ScreenShareRequest) => Promise<MediaStream>;
}

type Listener = (snapshot: MediaRoomSnapshot) => void;

const emptySnapshot = (): MediaRoomSnapshot => ({
  state: 'idle',
  connectionQuality: 'unknown',
  pingMs: null,
  participants: [],
  devices: [],
  capabilities: detectPlatformMediaCapabilities(),
  activeInputDeviceId: null,
  activeOutputDeviceId: null,
  activeCameraDeviceId: null,
  microphoneEnabled: false,
  cameraEnabled: false,
  screenShareEnabled: false,
  deafened: false,
  focusedShareIdentity: null,
  error: null,
});

export class MediaRoomController {
  private room: Room | null = null;
  private screenShareTrack: LocalVideoTrack | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly audioElements = new Set<HTMLAudioElement>();
  private readonly options: MediaRoomControllerOptions;
  private snapshot: MediaRoomSnapshot = emptySnapshot();
  private screenShareAudioTrack: MediaStreamTrack | null = null;
  private screenShareOperationId = 0;
  private operationId = 0;
  private soundEffects: MediaSoundEffects | null = new MediaSoundEffects();
  private telemetryRequestId = 0;
  constructor(options: MediaRoomControllerOptions = {}) {
    this.options = options;
  }

  getSnapshot(): MediaRoomSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async join(token: MediaTokenResponse): Promise<void> {
    const operationId = ++this.operationId;
    const previousRoom = this.room;
    this.room = null;
    if (previousRoom) await this.cleanupRoom(previousRoom);
    if (operationId !== this.operationId) return;
    this.getSoundEffects().preload();
    this.update({
      state: 'joining',
      participants: [],
      activeInputDeviceId: null,
      activeOutputDeviceId: null,
      activeCameraDeviceId: null,
      microphoneEnabled: false,
      cameraEnabled: false,
      screenShareEnabled: false,
      deafened: false,
      focusedShareIdentity: null,
      error: null,
    });

    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    this.bindRoomEvents(room);

    try {
      await room.connect(token.url, token.token);
      if (operationId !== this.operationId) {
        await this.cleanupRoom(room);
        return;
      }
      this.refreshParticipants();
      const transitionedToJoined = this.snapshot.state !== 'joined';
      this.update({ state: 'joined' });
      if (transitionedToJoined) this.soundEffects?.play('voice-joined');
      this.refreshConnectionTelemetry(room);
      await this.refreshDevices();
    } catch (error) {
      await this.cleanupRoom(room);
      if (operationId !== this.operationId) return;
      this.room = null;
      this.update({
        state: 'error',
        error: toMediaRoomError(error, 'MEDIA_JOIN_FAILED', 'Could not join the voice channel.'),
      });
      throw error;
    }
  }

  async leave(): Promise<void> {
    ++this.operationId;
    const room = this.room;
    this.room = null;
    if (!room) {
      this.disposeSoundEffects();
      this.update({
        state: 'idle',
        connectionQuality: 'unknown',
        pingMs: null,
        participants: [],
        activeInputDeviceId: null,
        activeOutputDeviceId: null,
        activeCameraDeviceId: null,
        microphoneEnabled: false,
        cameraEnabled: false,
        screenShareEnabled: false,
        deafened: false,
        error: null,
        focusedShareIdentity: null,
      });
      return;
    }

    this.update({ state: 'leaving' });
    await this.cleanupRoom(room);
    this.update({
      state: 'idle',
      connectionQuality: 'unknown',
      pingMs: null,
      participants: [],
      activeInputDeviceId: null,
      activeOutputDeviceId: null,
      activeCameraDeviceId: null,
      microphoneEnabled: false,
      cameraEnabled: false,
      screenShareEnabled: false,
      deafened: false,
      focusedShareIdentity: null,
      error: null,
    });
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    const wasEnabled = this.snapshot.microphoneEnabled;
    try {
      const participant = this.requireLocalParticipant();
      if (enabled) await requireNativeMediaPermission('microphone');
      if (this.room?.localParticipant !== participant || this.snapshot.state !== 'joined') return;
      await participant.setMicrophoneEnabled(enabled);
      if (!this.isCurrentParticipant(participant)) return;
      this.refreshParticipants();
      this.update({ error: null });
      if (wasEnabled !== this.snapshot.microphoneEnabled) {
        this.soundEffects?.play(
          this.snapshot.microphoneEnabled ? 'microphone-unmute' : 'microphone-mute',
        );
      }
    } catch (error) {
      this.fail('MICROPHONE_FAILED', 'Microphone permission or device access failed.', error);
      throw error;
    }
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    try {
      const participant = this.requireLocalParticipant();
      if (enabled) await requireNativeMediaPermission('camera');
      if (!this.isCurrentParticipant(participant)) return;
      await participant.setCameraEnabled(enabled);
      if (!this.isCurrentParticipant(participant)) return;
      this.refreshParticipants();
      this.update({ error: null });
    } catch (error) {
      this.fail('CAMERA_FAILED', 'Camera permission or device access failed.', error);
      throw error;
    }
  }

  async setScreenShareEnabled(enabled: boolean, request: ScreenShareRequest = {}): Promise<void> {
    const participant = this.requireLocalParticipant();
    const shareOperationId = ++this.screenShareOperationId;
    if (!enabled) {
      const wasEnabled = this.snapshot.screenShareEnabled;
      try {
        await this.stopScreenShare(participant);
        if (wasEnabled && !this.snapshot.screenShareEnabled) {
          this.soundEffects?.play('screen-share-stop');
        }
        this.update({ error: null });
      } catch (error) {
        this.fail(
          'SCREEN_SHARE_STOP_FAILED',
          'Screen sharing could not be stopped cleanly.',
          error,
        );
        throw error;
      }
      return;
    }

    if (this.snapshot.screenShareEnabled) return;

    let stream: MediaStream | null = null;
    let localTrack: LocalVideoTrack | null = null;
    let audioTrack: MediaStreamTrack | null = null;
    try {
      stream = await requestScreenShare(request, this.options.sourcePicker);
      if (!this.isCurrentShareOperation(shareOperationId, participant)) {
        stopStream(stream);
        return;
      }
      const [videoTrack] = stream.getVideoTracks();
      if (!videoTrack) {
        stopStream(stream);
        throw new MediaPlatformError(
          'SCREEN_SHARE_UNAVAILABLE',
          'No shareable video source was selected.',
        );
      }

      localTrack = new LocalVideoTrack(videoTrack, undefined, true);
      this.screenShareTrack = localTrack;
      await participant.publishTrack(localTrack, {
        source: Track.Source.ScreenShare,
        name: 'screen-share',
      });
      if (!this.isCurrentShareOperation(shareOperationId, participant)) {
        await this.unpublishScreenShareTracks(participant);
        stopStream(stream);
        return;
      }

      audioTrack = stream.getAudioTracks()[0] ?? null;
      if (audioTrack) {
        this.screenShareAudioTrack = audioTrack;
        await participant.publishTrack(audioTrack, {
          source: Track.Source.ScreenShareAudio,
          name: 'screen-share-audio',
        });
      }
      if (!this.isCurrentShareOperation(shareOperationId, participant)) {
        await this.unpublishScreenShareTracks(participant);
        stopStream(stream);
        return;
      }

      let captureFailed = false;
      videoTrack.addEventListener(
        WINDOWS_CAPTURE_ERROR_EVENT,
        () => {
          captureFailed = true;
        },
        { once: true },
      );
      videoTrack.addEventListener(
        'ended',
        () => {
          if (!this.isCurrentParticipant(participant)) return;
          void this.setScreenShareEnabled(false).then(
            () => {
              if (captureFailed) {
                this.fail(
                  'SCREEN_SHARE_CAPTURE_FAILED',
                  'Screen capture stopped because the selected source became unavailable.',
                  null,
                );
              }
            },
            (error: unknown) => {
              this.fail(
                'SCREEN_SHARE_STOP_FAILED',
                'Screen sharing ended, but its tracks could not be stopped cleanly.',
                error,
              );
            },
          );
        },
        { once: true },
      );
      this.refreshParticipants();
      this.update({ screenShareEnabled: true, error: null });
      this.soundEffects?.play('screen-share-start');
    } catch (error) {
      try {
        await this.unpublishScreenShareTracks(participant);
      } catch {
        // The original action error remains the actionable failure.
      }
      localTrack?.stop();
      audioTrack?.stop();
      if (this.screenShareTrack === localTrack) this.screenShareTrack = null;
      if (this.screenShareAudioTrack === audioTrack) this.screenShareAudioTrack = null;
      if (this.isCurrentShareOperation(shareOperationId, participant)) {
        this.fail(
          error instanceof MediaPlatformError ? error.code : 'SCREEN_SHARE_FAILED',
          error instanceof MediaPlatformError
            ? error.message
            : 'Screen sharing could not be started.',
          error,
        );
      }
      throw error;
    }
  }

  async setInputDevice(deviceId: string): Promise<void> {
    const room = this.requireRoom();
    try {
      const switched = await room.switchActiveDevice('audioinput', deviceId);
      if (this.room !== room || this.snapshot.state !== 'joined') return;
      if (!switched) {
        throw new MediaPlatformError(
          'DEVICE_UNAVAILABLE',
          'The selected microphone is unavailable.',
        );
      }
      this.update({
        activeInputDeviceId: room.getActiveDevice('audioinput') ?? deviceId,
        error: null,
      });
      await this.refreshDevices();
    } catch (error) {
      this.fail('INPUT_DEVICE_FAILED', 'The selected microphone is unavailable.', error);
      throw error;
    }
  }

  async setCameraDevice(deviceId: string): Promise<void> {
    const room = this.requireRoom();
    try {
      const switched = await room.switchActiveDevice('videoinput', deviceId);
      if (this.room !== room || this.snapshot.state !== 'joined') return;
      if (!switched) {
        throw new MediaPlatformError('DEVICE_UNAVAILABLE', 'The selected camera is unavailable.');
      }
      this.update({
        activeCameraDeviceId: room.getActiveDevice('videoinput') ?? deviceId,
        error: null,
      });
      await this.refreshDevices();
    } catch (error) {
      this.fail('CAMERA_DEVICE_FAILED', 'The selected camera is unavailable.', error);
      throw error;
    }
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    const room = this.requireRoom();
    if (!this.snapshot.capabilities.outputSelection) {
      const error = new MediaPlatformError(
        'DEVICE_UNAVAILABLE',
        'This platform does not support selecting an audio output device.',
      );
      this.fail(error.code, error.message, error);
      throw error;
    }

    try {
      const switched = await room.switchActiveDevice('audiooutput', deviceId);
      if (this.room !== room || this.snapshot.state !== 'joined') return;
      if (!switched) {
        throw new MediaPlatformError(
          'DEVICE_UNAVAILABLE',
          'The selected audio output is unavailable.',
        );
      }
      this.update({
        activeOutputDeviceId: room.getActiveDevice('audiooutput') ?? deviceId,
        error: null,
      });
      await this.refreshDevices();
    } catch (error) {
      this.fail('OUTPUT_DEVICE_FAILED', 'The selected audio output is unavailable.', error);
      throw error;
    }
  }

  async setDeafened(deafened: boolean): Promise<void> {
    const participant = this.requireLocalParticipant();
    for (const element of this.audioElements) {
      element.volume = deafened ? 0 : 1;
    }
    this.update({ deafened });
    this.refreshParticipants();

    try {
      await participant.setAttributes({ 'guilda.deafened': deafened ? 'true' : '' });
      if (this.isCurrentParticipant(participant)) this.update({ error: null });
    } catch (error) {
      this.fail('MEDIA_STATE_SYNC_FAILED', 'Could not share the headphone state.', error);
      throw error;
    }
  }

  focusShare(identity: string | null): void {
    const focused = identity && this.isScreenSharePublished(identity) ? identity : null;
    this.update({ focusedShareIdentity: focused });
  }

  attachParticipantVideo(
    identity: string,
    element: HTMLVideoElement,
    source: 'camera' | 'screen' = 'camera',
  ): () => void {
    const room = this.room;
    let attachedTrack: TrackPublication['track'];
    let attachedElement: HTMLMediaElement | undefined;
    const attachAvailableTrack = () => {
      if (this.room !== room) return;
      const track = this.findVideoPublication(identity, source === 'screen')?.track;
      if (track === attachedTrack) return;
      if (attachedTrack && attachedElement) attachedTrack.detach(attachedElement);
      attachedTrack = track;
      attachedElement = track?.attach(element);
    };

    attachAvailableTrack();
    room?.on(RoomEvent.TrackSubscribed, attachAvailableTrack);
    room?.on(RoomEvent.TrackUnsubscribed, attachAvailableTrack);
    room?.on(RoomEvent.LocalTrackPublished, attachAvailableTrack);
    room?.on(RoomEvent.LocalTrackUnpublished, attachAvailableTrack);

    return () => {
      room?.off(RoomEvent.TrackSubscribed, attachAvailableTrack);
      room?.off(RoomEvent.TrackUnsubscribed, attachAvailableTrack);
      room?.off(RoomEvent.LocalTrackPublished, attachAvailableTrack);
      room?.off(RoomEvent.LocalTrackUnpublished, attachAvailableTrack);
      if (attachedTrack && attachedElement) attachedTrack.detach(attachedElement);
    };
  }

  attachParticipantAudio(identity: string, element: HTMLAudioElement): () => void {
    const room = this.room;
    if (!room || room.localParticipant.identity === identity) {
      return () => undefined;
    }

    let attachedTrack: TrackPublication['track'];
    let attachedElement: HTMLMediaElement | undefined;
    const attachAvailableTrack = () => {
      if (this.room !== room) return;
      const track = this.findAudioPublication(identity)?.track;
      if (track === attachedTrack) return;
      if (attachedTrack && attachedElement) attachedTrack.detach(attachedElement);
      attachedTrack = track;
      attachedElement = track?.attach(element);
    };

    this.audioElements.add(element);
    element.dataset.livekitRemote = identity;
    element.volume = this.snapshot.deafened ? 0 : 1;
    attachAvailableTrack();
    room.on(RoomEvent.TrackSubscribed, attachAvailableTrack);
    room.on(RoomEvent.TrackUnsubscribed, attachAvailableTrack);
    return () => {
      room.off(RoomEvent.TrackSubscribed, attachAvailableTrack);
      room.off(RoomEvent.TrackUnsubscribed, attachAvailableTrack);
      if (attachedTrack && attachedElement) attachedTrack.detach(attachedElement);
      this.audioElements.delete(element);
      delete element.dataset.livekitRemote;
    };
  }

  private bindRoomEvents(room: Room): void {
    const refreshParticipants = () => {
      if (this.room === room) this.refreshParticipants();
    };
    room.on(RoomEvent.ConnectionStateChanged, () => {
      if (this.room === room) this.refreshConnectionTelemetry(room);
    });
    room.on(RoomEvent.ConnectionQualityChanged, () => {
      if (this.room === room) this.refreshConnectionTelemetry(room);
    });
    room.on(RoomEvent.ParticipantConnected, refreshParticipants);
    room.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
    room.on(RoomEvent.ActiveSpeakersChanged, refreshParticipants);
    room.on(RoomEvent.TrackSubscribed, refreshParticipants);
    room.on(RoomEvent.TrackUnsubscribed, refreshParticipants);
    room.on(RoomEvent.LocalTrackPublished, refreshParticipants);
    room.on(RoomEvent.TrackPublished, refreshParticipants);
    room.on(RoomEvent.TrackMuted, refreshParticipants);
    room.on(RoomEvent.TrackUnmuted, refreshParticipants);
    room.on(RoomEvent.TrackUnpublished, refreshParticipants);
    room.on(RoomEvent.ParticipantAttributesChanged, refreshParticipants);
    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (this.room !== room) return;
      if (publication.source === Track.Source.ScreenShare) {
        this.screenShareTrack?.stop();
        this.screenShareAudioTrack?.stop();
        this.screenShareTrack = null;
        this.screenShareAudioTrack = null;
        this.update({ screenShareEnabled: false, focusedShareIdentity: null });
      } else if (publication.source === Track.Source.ScreenShareAudio) {
        this.screenShareAudioTrack?.stop();
        this.screenShareAudioTrack = null;
      }
      this.refreshParticipants();
    });
    room.on(RoomEvent.MediaDevicesChanged, () => {
      if (this.room === room) void this.refreshDevices();
    });
    room.on(RoomEvent.Disconnected, () => {
      if (this.room !== room) return;
      this.room = null;
      this.disposeRoomMedia(room);
      this.update({
        state: 'disconnected',
        connectionQuality: 'unknown',
        pingMs: null,
        participants: [],
        activeInputDeviceId: null,
        activeOutputDeviceId: null,
        activeCameraDeviceId: null,
        microphoneEnabled: false,
        cameraEnabled: false,
        screenShareEnabled: false,
        deafened: false,
        focusedShareIdentity: null,
        error: {
          code: 'MEDIA_DISCONNECTED',
          message: 'Voice connection ended unexpectedly. You can retry or leave the channel.',
        },
      });
    });
  }

  private getSoundEffects(): MediaSoundEffects {
    if (!this.soundEffects) this.soundEffects = new MediaSoundEffects();
    return this.soundEffects;
  }

  private disposeSoundEffects(): void {
    this.soundEffects?.dispose();
    this.soundEffects = null;
  }

  private async stopScreenShare(participant: LocalParticipant): Promise<void> {
    try {
      await this.unpublishScreenShareTracks(participant);
    } finally {
      this.screenShareTrack?.stop();
      this.screenShareAudioTrack?.stop();
      this.screenShareTrack = null;
      this.screenShareAudioTrack = null;
      if (this.isCurrentParticipant(participant)) {
        this.refreshParticipants();
        this.update({ screenShareEnabled: false, focusedShareIdentity: null });
      }
    }
  }

  private async unpublishScreenShareTracks(participant: LocalParticipant): Promise<void> {
    const publications = [...participant.trackPublications.values()].filter(
      (item) =>
        item.source === Track.Source.ScreenShare || item.source === Track.Source.ScreenShareAudio,
    );
    let failure: unknown;
    for (const publication of publications) {
      if (!publication.track) continue;
      try {
        await participant.unpublishTrack(publication.track, true);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }

  private async cleanupRoom(room: Room): Promise<void> {
    room.removeAllListeners();
    try {
      await room.disconnect(true);
    } catch {
      // Local media is still disposed below; a broken transport cannot keep the user in voice.
    } finally {
      this.disposeRoomMedia(room);
    }
  }

  private disposeRoomMedia(room: Room): void {
    this.screenShareOperationId += 1;
    this.screenShareTrack?.stop();
    this.screenShareAudioTrack?.stop();
    this.screenShareTrack = null;
    this.screenShareAudioTrack = null;
    for (const publication of room.localParticipant.trackPublications.values()) {
      publication.track?.stop();
    }
    room.removeAllListeners();
    this.audioElements.clear();
    this.disposeSoundEffects();
  }

  private refreshConnectionTelemetry(room: Room): void {
    const requestId = ++this.telemetryRequestId;
    const quality = toConnectionQuality(room.localParticipant.connectionQuality);
    const state =
      room.state === 'reconnecting'
        ? 'reconnecting'
        : room.state === 'connected' && this.snapshot.state === 'reconnecting'
          ? 'joined'
          : undefined;
    this.update({ connectionQuality: quality, ...(state ? { state } : {}) });
    void readPingMs(room).then((pingMs) => {
      if (this.room === room && this.telemetryRequestId === requestId) {
        this.update({ pingMs });
      }
    });
  }

  private async refreshDevices(): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      const devices = await enumerateMediaDevices();
      if (this.room !== room) return;
      this.update({
        devices,
        activeInputDeviceId: room.getActiveDevice('audioinput') ?? null,
        activeOutputDeviceId: room.getActiveDevice('audiooutput') ?? null,
        activeCameraDeviceId: room.getActiveDevice('videoinput') ?? null,
        ...(this.snapshot.error?.code === 'DEVICE_ENUMERATION_FAILED' ? { error: null } : {}),
      });
    } catch (error) {
      if (this.room === room) {
        this.fail('DEVICE_ENUMERATION_FAILED', 'Media devices could not be enumerated.', error);
      }
    }
  }

  private refreshParticipants(): void {
    const room = this.room;
    if (!room) {
      return;
    }

    const localParticipant = toParticipantState(room.localParticipant, this.snapshot.deafened);
    const remoteParticipants = [...room.remoteParticipants.values()].map((participant) =>
      toParticipantState(participant),
    );
    const focusedShareIdentity =
      this.snapshot.focusedShareIdentity &&
      this.isScreenSharePublished(this.snapshot.focusedShareIdentity)
        ? this.snapshot.focusedShareIdentity
        : null;
    this.update({
      participants: [localParticipant, ...remoteParticipants],
      microphoneEnabled: localParticipant.microphoneEnabled,
      cameraEnabled: localParticipant.cameraEnabled,
      screenShareEnabled: localParticipant.screenShareEnabled,
      focusedShareIdentity,
    });
  }

  private isScreenSharePublished(identity: string): boolean {
    return this.findVideoPublication(identity, true) !== undefined;
  }

  private findVideoPublication(identity: string, screen: boolean): TrackPublication | undefined {
    const participant = this.findParticipant(identity);
    if (!participant) {
      return undefined;
    }
    return [...participant.trackPublications.values()].find(
      (publication) =>
        publication.kind === Track.Kind.Video &&
        (screen
          ? publication.source === Track.Source.ScreenShare
          : publication.source === Track.Source.Camera),
    );
  }

  private findAudioPublication(identity: string): TrackPublication | undefined {
    const participant = this.findParticipant(identity);
    if (!participant) {
      return undefined;
    }
    return [...participant.trackPublications.values()].find(
      (publication) =>
        publication.kind === Track.Kind.Audio && publication.source === Track.Source.Microphone,
    );
  }

  private findParticipant(identity: string): Participant | undefined {
    const room = this.room;
    if (!room) {
      return undefined;
    }
    if (room.localParticipant.identity === identity) {
      return room.localParticipant;
    }
    return room.remoteParticipants.get(identity);
  }

  private requireRoom(): Room {
    if (!this.room || this.snapshot.state !== 'joined') {
      throw new Error('Not connected to a voice channel.');
    }
    return this.room;
  }

  private requireLocalParticipant(): LocalParticipant {
    return this.requireRoom().localParticipant;
  }

  private isCurrentParticipant(participant: LocalParticipant): boolean {
    return this.room?.localParticipant === participant && this.snapshot.state === 'joined';
  }

  private isCurrentShareOperation(
    shareOperationId: number,
    participant: LocalParticipant,
  ): boolean {
    return (
      this.screenShareOperationId === shareOperationId && this.isCurrentParticipant(participant)
    );
  }

  private fail(code: string, message: string, _cause: unknown): void {
    void _cause;
    this.update({ error: { code, message } });
  }

  private update(patch: Partial<MediaRoomSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}
function toConnectionQuality(value: unknown): MediaConnectionQuality {
  if (value === ConnectionQuality.Excellent || value === 'excellent' || value === 3) {
    return 'excellent';
  }
  if (value === ConnectionQuality.Good || value === 'good' || value === 2) {
    return 'good';
  }
  if (value === ConnectionQuality.Poor || value === 'poor' || value === 1) {
    return 'poor';
  }
  return 'unknown';
}

type InternalStatsSource = {
  getStats(): Promise<unknown>;
};

type InternalRoomStatsSurface = {
  engine?: {
    pcManager?: {
      publisher?: InternalStatsSource;
      subscriber?: InternalStatsSource;
    };
  };
};

/**
 * Read one bounded stats snapshot. LiveKit's peer connection stats are
 * internal, so unsupported or malformed reports intentionally yield null.
 */
async function readPingMs(room: Room): Promise<number | null> {
  const surface = room as unknown as InternalRoomStatsSurface;
  const sources = [surface.engine?.pcManager?.publisher, surface.engine?.pcManager?.subscriber];
  try {
    for (const source of sources) {
      if (!source) continue;
      const raw = await source.getStats();
      const reports = Array.isArray(raw) ? raw : [raw];
      for (const report of reports) {
        if (!report || typeof report !== 'object') continue;
        const values =
          'values' in report && typeof report.values === 'function'
            ? [...report.values()]
            : [report];
        for (const stat of values) {
          if (!stat || typeof stat !== 'object') continue;
          if (!('type' in stat) || stat.type !== 'candidate-pair') continue;
          const currentRoundTripTime =
            'currentRoundTripTime' in stat ? stat.currentRoundTripTime : undefined;
          const roundTripTime = 'roundTripTime' in stat ? stat.roundTripTime : undefined;
          const seconds =
            typeof currentRoundTripTime === 'number' ? currentRoundTripTime : roundTripTime;
          if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
            return Math.round(seconds * 1000);
          }
        }
      }
    }
  } catch {
    // Stats are best effort and must never affect media state.
  }
  return null;
}

function toParticipantState(
  participant: Participant,
  deafenedOverride?: boolean,
): MediaParticipantState {
  const publications = [...participant.trackPublications.values()];
  return {
    identity: participant.identity,
    displayName: participant.name || participant.identity,
    isSpeaking: participant.isSpeaking,
    microphoneEnabled: publications.some(
      (publication) => publication.source === Track.Source.Microphone && !publication.isMuted,
    ),
    cameraEnabled: publications.some(
      (publication) => publication.source === Track.Source.Camera && !publication.isMuted,
    ),
    screenShareEnabled: publications.some(
      (publication) => publication.source === Track.Source.ScreenShare && !publication.isMuted,
    ),
    deafened: deafenedOverride ?? participant.attributes['guilda.deafened'] === 'true',
  };
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

async function requireNativeMediaPermission(resource: 'microphone' | 'camera'): Promise<void> {
  if (!nativeBridge.isAvailable()) return;
  const status = await nativeBridge.media.requestPermission(resource);
  if (status === 'denied') {
    throw new MediaPlatformError(
      'PERMISSION_DENIED',
      `${resource === 'microphone' ? 'Microphone' : 'Camera'} permission was denied.`,
    );
  }
}

function toMediaRoomError(error: unknown, code: string, fallback: string): MediaRoomError {
  if (error instanceof MediaPlatformError) {
    return { code: error.code, message: error.message };
  }
  return { code, message: fallback };
}
