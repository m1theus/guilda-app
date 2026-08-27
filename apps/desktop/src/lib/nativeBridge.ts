import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AuthTokens } from '@guilda/types/api';

export const NATIVE_EVENT = 'guilda://native-event' as const;

export type WindowVisibility = 'shown' | 'hidden';
export type TrayAction = 'show' | 'hide' | 'toggle';
export type MediaResource = 'microphone' | 'camera' | 'screen';
export type MediaPermissionStatus = 'granted' | 'denied' | 'browserManaged';
export type NativeScreenCaptureSourceKind = 'screen' | 'window';

export interface NativeScreenCaptureSource {
  id: string;
  name: string;
  kind: NativeScreenCaptureSourceKind;
}

export type NativeEvent =
  | { type: 'inviteDeepLink'; code: string }
  | { type: 'singleInstance' }
  | { type: 'notificationShown'; title: string }
  | { type: 'windowVisibility'; visibility: WindowVisibility }
  | { type: 'tray'; action: TrayAction }
  | { type: 'integrationError'; integration: string; code: string; message: string };

const commands = {
  eventsReady: 'native_events_ready',
  authGetTokens: 'auth_get_tokens',
  authSetTokens: 'auth_set_tokens',
  authClearTokens: 'auth_clear_tokens',
  windowShow: 'window_show',
  windowHide: 'window_hide',
  windowToggle: 'window_toggle',
  notificationShow: 'notification_show',
  requestMediaPermission: 'request_media_permission',
  screenCaptureSources: 'screen_capture_sources',
  screenCaptureFrame: 'screen_capture_frame',
} as const;

function requireTauri(): void {
  if (!isTauri()) {
    throw new Error('This operation is only available inside the Guilda desktop shell.');
  }
}

class NativeCommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'NativeCommandError';
    this.code = code;
  }
}

function normalizeNativeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object') {
    const payload = error as Record<string, unknown>;
    if (typeof payload.code === 'string' && typeof payload.message === 'string') {
      return new NativeCommandError(payload.code, payload.message);
    }
  }
  return new NativeCommandError(
    'native_command_failed',
    'The Guilda desktop shell could not complete the operation.',
  );
}

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  requireTauri();
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeNativeError(error);
  }
}

/** True only for the Windows Tauri webview, never for a browser on Windows. */
export function isWindowsTauri(): boolean {
  if (!isTauri() || typeof navigator === 'undefined') return false;
  return /Windows/i.test(`${navigator.userAgent} ${navigator.platform}`);
}
const nativeEventHandlers = new Set<(event: NativeEvent) => void>();
const bufferedNativeEvents: NativeEvent[] = [];
let nativeEventsStarted: Promise<void> | null = null;

function deliverNativeEvent(event: NativeEvent): void {
  if (nativeEventHandlers.size === 0) {
    bufferedNativeEvents.push(event);
    return;
  }
  nativeEventHandlers.forEach((handler) => handler(event));
}

function startNativeEvents(): Promise<void> {
  nativeEventsStarted ??= (async () => {
    const stopListening = await listen<NativeEvent>(NATIVE_EVENT, ({ payload }) =>
      deliverNativeEvent(payload),
    );
    try {
      const pending = await invokeNative<NativeEvent[]>(commands.eventsReady);
      pending.forEach(deliverNativeEvent);
    } catch (error) {
      stopListening();
      throw error;
    }
  })();
  return nativeEventsStarted;
}

/**
 * Install the process-lifetime native listener before completing the Rust
 * handshake. Rust retains cold-start events until this call; the bridge also
 * buffers while React has no mounted subscriber (including StrictMode remounts).
 */
export async function onNativeEvent(handler: (event: NativeEvent) => void): Promise<UnlistenFn> {
  requireTauri();
  nativeEventHandlers.add(handler);
  try {
    await startNativeEvents();
    bufferedNativeEvents.splice(0).forEach(deliverNativeEvent);
  } catch (error) {
    nativeEventHandlers.delete(handler);
    nativeEventsStarted = null;
    throw error;
  }
  return () => {
    nativeEventHandlers.delete(handler);
  };
}

export const nativeBridge = {
  isAvailable: isTauri,
  auth: {
    getTokens(): Promise<AuthTokens | null> {
      return invokeNative(commands.authGetTokens);
    },
    setTokens(tokens: AuthTokens): Promise<void> {
      return invokeNative(commands.authSetTokens, { tokens });
    },
    clearTokens(): Promise<void> {
      return invokeNative(commands.authClearTokens);
    },
  },
  window: {
    show(): Promise<void> {
      return invokeNative(commands.windowShow);
    },
    hide(): Promise<void> {
      return invokeNative(commands.windowHide);
    },
    toggle(): Promise<WindowVisibility> {
      return invokeNative(commands.windowToggle);
    },
  },
  notification: {
    show(title: string, body: string): Promise<void> {
      return invokeNative(commands.notificationShow, { title, body });
    },
  },
  media: {
    requestPermission(resource: MediaResource): Promise<MediaPermissionStatus> {
      return invokeNative(commands.requestMediaPermission, { resource });
    },
    listScreenCaptureSources(): Promise<NativeScreenCaptureSource[]> {
      return invokeNative(commands.screenCaptureSources);
    },
    captureScreenFrame(sourceId: string): Promise<Uint8Array<ArrayBuffer>> {
      return invokeNative(commands.screenCaptureFrame, { sourceId });
    },
  },
} as const;
