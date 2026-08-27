import type { MediaDevice, PlatformMediaCapabilities } from '@guilda/types';
import { isWindowsTauri, nativeBridge } from '../../lib/nativeBridge';

export type MediaPlatform = 'browser' | 'tauri';
export const WINDOWS_CAPTURE_ERROR_EVENT = 'guilda-screen-capture-error';

export class MediaPlatformError extends Error {
  readonly code:
    | 'MEDIA_UNAVAILABLE'
    | 'SCREEN_SHARE_UNAVAILABLE'
    | 'SCREEN_SHARE_SOURCE_REQUIRED'
    | 'PERMISSION_DENIED'
    | 'DEVICE_UNAVAILABLE';

  constructor(code: MediaPlatformError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MediaPlatformError';
    this.code = code;
  }
}

export interface ScreenShareRequest {
  sourceId?: string;
  includeSystemAudio?: boolean;
}

export function getMediaPlatform(): MediaPlatform {
  if (nativeBridge.isAvailable()) {
    return 'tauri';
  }
  return 'browser';
}

export function detectPlatformMediaCapabilities(): PlatformMediaCapabilities {
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const hasDisplayCapture = Boolean(mediaDevices?.getDisplayMedia);
  const hasSinkSelection =
    typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const windowsTauri = isWindowsTauri();
  const windowsCaptureSupported =
    windowsTauri &&
    typeof createImageBitmap !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';

  return {
    microphone: Boolean(mediaDevices?.getUserMedia),
    camera: Boolean(mediaDevices?.getUserMedia),
    screenShare: windowsTauri ? windowsCaptureSupported : hasDisplayCapture,
    systemAudio: !windowsTauri && getMediaPlatform() === 'browser' && hasDisplayCapture,
    outputSelection: hasSinkSelection,
  };
}

export async function enumerateMediaDevices(): Promise<MediaDevice[]> {
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!mediaDevices?.enumerateDevices) {
    throw new MediaPlatformError(
      'MEDIA_UNAVAILABLE',
      'This platform does not expose media device enumeration.',
    );
  }

  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices
      .filter(
        (device): device is MediaDeviceInfo =>
          device.kind === 'audioinput' ||
          device.kind === 'audiooutput' ||
          device.kind === 'videoinput',
      )
      .map((device) => ({ deviceId: device.deviceId, label: device.label, kind: device.kind }));
  } catch (error) {
    throw new MediaPlatformError('DEVICE_UNAVAILABLE', 'Media devices could not be listed.', {
      cause: error,
    });
  }
}

/**
 * Browser uses the native picker. Windows Tauri uses the in-app native-source
 * picker and paints native JPEG frames into a canvas-backed MediaStream.
 */
export async function requestScreenShare(
  request: ScreenShareRequest = {},
  sourcePicker?: (request: ScreenShareRequest) => Promise<MediaStream>,
): Promise<MediaStream> {
  if (isWindowsTauri()) {
    return requestWindowsScreenShare(request.sourceId);
  }

  if (sourcePicker) {
    try {
      return await sourcePicker(request);
    } catch (error) {
      throw new MediaPlatformError('PERMISSION_DENIED', 'Screen sharing was cancelled or denied.', {
        cause: error,
      });
    }
  }

  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  const getDisplayMedia = mediaDevices?.getDisplayMedia;
  if (!getDisplayMedia || !mediaDevices) {
    throw new MediaPlatformError(
      getMediaPlatform() === 'tauri' ? 'SCREEN_SHARE_SOURCE_REQUIRED' : 'SCREEN_SHARE_UNAVAILABLE',
      getMediaPlatform() === 'tauri'
        ? 'Tauri needs a native screen-source picker plugin for screen sharing.'
        : 'This browser does not support screen sharing.',
    );
  }

  try {
    const video: MediaTrackConstraints = {
      frameRate: { ideal: 30, max: 60 },
      ...(request.sourceId ? { deviceId: { exact: request.sourceId } } : {}),
    };
    return await getDisplayMedia.call(mediaDevices, {
      video,
      audio: request.includeSystemAudio ?? false,
    });
  } catch (error) {
    const denied =
      error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.name === 'SecurityError');
    throw new MediaPlatformError(
      denied ? 'PERMISSION_DENIED' : 'SCREEN_SHARE_UNAVAILABLE',
      denied ? 'Screen sharing permission was denied.' : 'Screen sharing could not be started.',
      { cause: error },
    );
  }
}

async function requestWindowsScreenShare(sourceId?: string): Promise<MediaStream> {
  if (!sourceId) {
    throw new MediaPlatformError(
      'SCREEN_SHARE_SOURCE_REQUIRED',
      'Select a screen or window before starting screen sharing.',
    );
  }
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new MediaPlatformError(
      'SCREEN_SHARE_UNAVAILABLE',
      'Windows screen capture is unavailable in this desktop shell.',
    );
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.captureStream !== 'function') {
    throw new MediaPlatformError(
      'SCREEN_SHARE_UNAVAILABLE',
      'Windows screen capture is unavailable in this desktop shell.',
    );
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const drawFrame = async (): Promise<void> => {
    let bitmap: ImageBitmap | undefined;
    try {
      const bytes = await nativeBridge.media.captureScreenFrame(sourceId);
      if (stopped) return;
      bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      if (stopped) return;
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      context.drawImage(bitmap, 0, 0);
    } finally {
      bitmap?.close();
    }
  };

  try {
    await drawFrame();
  } catch (error) {
    throw new MediaPlatformError('SCREEN_SHARE_UNAVAILABLE', 'Native screen capture failed.', {
      cause: error,
    });
  }

  const stream = canvas.captureStream(15);
  const [track] = stream.getVideoTracks();
  if (!track) {
    throw new MediaPlatformError(
      'SCREEN_SHARE_UNAVAILABLE',
      'The native screen capture stream has no video track.',
    );
  }

  const originalStop = track.stop.bind(track);
  const cleanup = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    track.removeEventListener('ended', cleanup);
  };
  const stop = (notifyEnded: boolean): void => {
    if (stopped) return;
    stopped = true;
    cleanup();
    originalStop();
    if (notifyEnded) track.dispatchEvent(new Event('ended'));
  };
  track.addEventListener('ended', cleanup);
  track.stop = () => stop(false);

  const scheduleFrame = (): void => {
    if (stopped) return;
    timer = setTimeout(async () => {
      timer = undefined;
      try {
        await drawFrame();
      } catch {
        track.dispatchEvent(new Event(WINDOWS_CAPTURE_ERROR_EVENT));
        stop(true);
        return;
      }
      scheduleFrame();
    }, 1000 / 15);
  };
  scheduleFrame();
  return stream;
}
