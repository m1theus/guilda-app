export type MediaSource = 'microphone' | 'camera' | 'screen_share';

export interface MediaTokenRequest {
  channelId: string;
}

export interface MediaTokenResponse {
  url: string;
  token: string;
  roomName: string;
  participantIdentity: string;
}

export interface MediaDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
}

export interface MediaParticipantState {
  identity: string;
  displayName: string;
  isSpeaking: boolean;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  deafened: boolean;
}

export interface VoiceChannelState {
  channelId: string;
  participants: MediaParticipantState[];
}

export interface MediaVoiceStateResponse {
  channels: VoiceChannelState[];
}

export interface PlatformMediaCapabilities {
  microphone: boolean;
  camera: boolean;
  screenShare: boolean;
  systemAudio: boolean;
  outputSelection: boolean;
}
