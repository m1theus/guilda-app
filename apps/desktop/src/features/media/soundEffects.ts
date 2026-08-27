export type MediaSoundEffectName =
  | 'voice-joined'
  | 'microphone-mute'
  | 'microphone-unmute'
  | 'screen-share-start'
  | 'screen-share-stop';

const SOUND_EFFECT_SOURCES: Record<MediaSoundEffectName, string> = {
  'voice-joined': '/audio/voice-joined.ogg',
  'microphone-mute': '/audio/microphone-mute.ogg',
  'microphone-unmute': '/audio/microphone-unmute.ogg',
  'screen-share-start': '/audio/screen-share-start.ogg',
  'screen-share-stop': '/audio/screen-share-stop.ogg',
};

const EFFECT_VOLUME = 0.16;

/**
 * Owns the small set of local media feedback sounds. Playback is best-effort:
 * browser autoplay policy, missing assets, and unsupported audio are all silent.
 */
export class MediaSoundEffects {
  private readonly audio = new Map<MediaSoundEffectName, HTMLAudioElement>();
  private disposed = false;
  private preloaded = false;

  preload(): void {
    if (this.disposed || this.preloaded || typeof Audio === 'undefined') return;
    this.preloaded = true;

    for (const [name, source] of Object.entries(SOUND_EFFECT_SOURCES) as Array<
      [MediaSoundEffectName, string]
    >) {
      try {
        const element = new Audio(source);
        element.preload = 'auto';
        element.volume = EFFECT_VOLUME;
        this.audio.set(name, element);
      } catch {
        // Sound feedback must never block a media action.
      }
    }
  }

  play(name: MediaSoundEffectName): void {
    if (this.disposed) return;
    this.preload();

    const element = this.audio.get(name);
    if (!element || !element.paused) return;

    try {
      element.currentTime = 0;
      const result = element.play();
      if (result && typeof result.catch === 'function') {
        void result.catch(() => undefined);
      }
    } catch {
      // Autoplay policy and unavailable local audio are non-fatal.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const element of this.audio.values()) {
      try {
        element.pause();
        element.removeAttribute('src');
        element.load();
      } catch {
        // Cleanup is best-effort and bounded.
      }
    }
    this.audio.clear();
  }
}
