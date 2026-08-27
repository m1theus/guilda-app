import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  HeadphoneOff,
  Headphones,
  LoaderCircle,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Settings2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { MediaDevice } from '@guilda/types';
import {
  isWindowsTauri,
  nativeBridge,
  type NativeScreenCaptureSource,
} from '../../lib/nativeBridge';
import type { MediaRoomSnapshot } from './roomController';
import type { ScreenShareRequest } from './platform';

export interface MediaControlsProps extends Pick<
  MediaRoomSnapshot,
  | 'devices'
  | 'capabilities'
  | 'state'
  | 'connectionQuality'
  | 'pingMs'
  | 'activeInputDeviceId'
  | 'activeOutputDeviceId'
  | 'activeCameraDeviceId'
  | 'microphoneEnabled'
  | 'cameraEnabled'
  | 'screenShareEnabled'
  | 'deafened'
> {
  onMicrophoneChange(enabled: boolean): Promise<void>;
  onCameraChange(enabled: boolean): Promise<void>;
  onScreenShareChange(enabled: boolean, request?: ScreenShareRequest): Promise<void>;
  onDeafenedChange(deafened: boolean): Promise<void>;
  onInputDeviceChange(deviceId: string): Promise<void>;
  onOutputDeviceChange(deviceId: string): Promise<void>;
  onCameraDeviceChange(deviceId: string): Promise<void>;
  onLeave?: () => Promise<void>;
}

type ScreenPickerState =
  | { status: 'loading'; requestId: number }
  | { status: 'ready'; requestId: number; sources: NativeScreenCaptureSource[] }
  | { status: 'error'; requestId: number; message: string };

type PendingAction =
  | 'microphone'
  | 'deafen'
  | 'camera'
  | 'screen-share'
  | 'leave'
  | 'input-device'
  | 'output-device'
  | 'camera-device';

export function MediaControls({
  devices,
  capabilities,
  state,
  connectionQuality,
  pingMs,
  activeInputDeviceId,
  activeOutputDeviceId,
  activeCameraDeviceId,
  microphoneEnabled,
  cameraEnabled,
  screenShareEnabled,
  deafened,
  onMicrophoneChange,
  onCameraChange,
  onScreenShareChange,
  onDeafenedChange,
  onInputDeviceChange,
  onOutputDeviceChange,
  onCameraDeviceChange,
  onLeave,
}: MediaControlsProps): JSX.Element {
  const audioInputs = devices.filter((device) => device.kind === 'audioinput');
  const audioOutputs = devices.filter((device) => device.kind === 'audiooutput');
  const cameras = devices.filter((device) => device.kind === 'videoinput');
  const microphoneAvailable = capabilities.microphone && audioInputs.length > 0;
  const cameraAvailable = capabilities.camera && cameras.length > 0;

  const windowsTauri = isWindowsTauri();
  const [screenPicker, setScreenPicker] = useState<ScreenPickerState | null>(null);
  const pickerRequestId = useRef(0);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingActionRef = useRef<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (
    action: PendingAction,
    failureMessage: string,
    operation: () => Promise<void>,
  ): Promise<boolean> => {
    if (pendingActionRef.current) return false;
    pendingActionRef.current = action;
    setActionError(null);
    setPendingAction(action);
    try {
      await operation();
      return true;
    } catch {
      setActionError(failureMessage);
      return false;
    } finally {
      if (pendingActionRef.current === action) pendingActionRef.current = null;
      setPendingAction((current) => (current === action ? null : current));
    }
  };

  const openScreenPicker = (): void => {
    const requestId = ++pickerRequestId.current;
    setScreenPicker({ status: 'loading', requestId });
    void nativeBridge.media
      .listScreenCaptureSources()
      .then((sources) => {
        if (pickerRequestId.current === requestId) {
          setScreenPicker({ status: 'ready', requestId, sources });
        }
      })
      .catch(() => {
        if (pickerRequestId.current !== requestId) return;
        setScreenPicker({
          status: 'error',
          requestId,
          message: 'The available screens and windows could not be listed.',
        });
      });
  };

  const cancelScreenPicker = (): void => {
    pickerRequestId.current += 1;
    setScreenPicker(null);
    if (pendingActionRef.current === 'screen-share') {
      void onScreenShareChange(false).catch(() => {
        setActionError('Screen sharing could not be cancelled cleanly. Try stopping it again.');
      });
    }
  };
  const selectScreenSource = (source: NativeScreenCaptureSource): void => {
    const requestId = ++pickerRequestId.current;
    setScreenPicker({ status: 'loading', requestId });
    void runAction('screen-share', 'The selected source could not be shared.', () =>
      onScreenShareChange(true, { sourceId: source.id }),
    ).then((shared) => {
      if (pickerRequestId.current !== requestId) return;
      if (shared) {
        setScreenPicker(null);
        return;
      }
      setScreenPicker({
        status: 'error',
        requestId,
        message: 'The selected source could not be shared.',
      });
    });
  };

  useEffect(() => {
    if (state === 'joined') return;
    pickerRequestId.current += 1;
    setScreenPicker(null);
  }, [state]);

  const connected = state === 'joined';
  const connectionStatus = connected
    ? 'connected'
    : state === 'disconnected' || state === 'error' || state === 'idle'
      ? 'disconnected'
      : 'reconnecting';
  const statusLabel =
    state === 'joining'
      ? 'Joining'
      : state === 'reconnecting'
        ? 'Reconnecting'
        : state === 'leaving'
          ? 'Leaving'
          : connected
            ? 'Connected'
            : 'Disconnected';
  const qualityLabel =
    connectionQuality === 'unknown'
      ? 'Unknown quality'
      : `${connectionQuality.charAt(0).toUpperCase()}${connectionQuality.slice(1)} quality`;
  const unavailableWhileDisconnected = 'Media controls are available after voice connects.';
  const pendingReason = 'Another media change is still in progress.';
  const controlsBlocked = !connected || pendingAction !== null;

  return (
    <div className="media-controls" aria-label="Media controls">
      <div
        className="media-connection-card"
        data-connection-status={connectionStatus}
        data-connection-quality={connectionQuality}
        role="status"
      >
        {connectionStatus === 'connected' ? <Wifi size={16} aria-hidden="true" /> : null}
        {connectionStatus === 'reconnecting' ? (
          <LoaderCircle className="media-connection-spinner" size={16} aria-hidden="true" />
        ) : null}
        {connectionStatus === 'disconnected' ? <WifiOff size={16} aria-hidden="true" /> : null}
        <span className="media-connection-copy">
          <strong>{statusLabel}</strong>
          <span>{qualityLabel}</span>
        </span>
        <span className="media-connection-ping">{pingMs === null ? '—' : `${pingMs} ms`}</span>
      </div>

      {actionError ? (
        <p role="alert" className="media-action-error">
          {actionError}
        </p>
      ) : null}

      <div className="media-control-dock" aria-busy={pendingAction !== null}>
        <button
          type="button"
          className="media-control-button"
          aria-label={microphoneEnabled ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={microphoneEnabled}
          title={
            !microphoneAvailable
              ? capabilities.microphone
                ? 'No microphone devices were detected.'
                : 'Microphone capture is unavailable on this platform.'
              : !connected
                ? unavailableWhileDisconnected
                : pendingAction
                  ? pendingReason
                  : microphoneEnabled
                    ? 'Mute microphone'
                    : 'Unmute microphone'
          }
          disabled={controlsBlocked || !microphoneAvailable}
          onClick={() =>
            void runAction(
              'microphone',
              'The microphone change failed. Check device access and try again.',
              () => onMicrophoneChange(!microphoneEnabled),
            )
          }
        >
          {microphoneEnabled ? (
            <Mic size={18} aria-hidden="true" />
          ) : (
            <MicOff size={18} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="media-control-button"
          aria-label={deafened ? 'Undeafen' : 'Deafen'}
          aria-pressed={deafened}
          title={
            !connected
              ? unavailableWhileDisconnected
              : pendingAction
                ? pendingReason
                : deafened
                  ? 'Undeafen'
                  : 'Deafen'
          }
          disabled={controlsBlocked}
          onClick={() =>
            void runAction('deafen', 'The headphone state could not be changed. Try again.', () =>
              onDeafenedChange(!deafened),
            )
          }
        >
          {deafened ? (
            <HeadphoneOff size={18} aria-hidden="true" />
          ) : (
            <Headphones size={18} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="media-control-button"
          aria-label={cameraEnabled ? 'Stop camera' : 'Start camera'}
          aria-pressed={cameraEnabled}
          title={
            !cameraAvailable
              ? capabilities.camera
                ? 'No camera devices were detected.'
                : 'Camera capture is unavailable on this platform.'
              : !connected
                ? unavailableWhileDisconnected
                : pendingAction
                  ? pendingReason
                  : cameraEnabled
                    ? 'Stop camera'
                    : 'Start camera'
          }
          disabled={controlsBlocked || !cameraAvailable}
          onClick={() =>
            void runAction(
              'camera',
              'The camera change failed. Check device access and try again.',
              () => onCameraChange(!cameraEnabled),
            )
          }
        >
          {cameraEnabled ? (
            <Camera size={18} aria-hidden="true" />
          ) : (
            <CameraOff size={18} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="media-control-button"
          aria-label={screenShareEnabled ? 'Stop sharing screen' : 'Share screen'}
          aria-pressed={screenShareEnabled}
          title={
            !capabilities.screenShare
              ? 'Screen sharing is unavailable on this platform.'
              : !connected
                ? unavailableWhileDisconnected
                : pendingAction
                  ? pendingReason
                  : screenShareEnabled
                    ? 'Stop sharing screen'
                    : 'Share screen'
          }
          disabled={controlsBlocked || !capabilities.screenShare}
          onClick={() => {
            if (screenShareEnabled) {
              cancelScreenPicker();
              void runAction(
                'screen-share',
                'Screen sharing could not be stopped. Try again.',
                () => onScreenShareChange(false),
              );
            } else if (windowsTauri) {
              setActionError(null);
              openScreenPicker();
            } else {
              void runAction(
                'screen-share',
                'Screen sharing could not be started. Check permission and try again.',
                () => onScreenShareChange(true),
              );
            }
          }}
        >
          {screenShareEnabled ? (
            <MonitorOff size={18} aria-hidden="true" />
          ) : (
            <MonitorUp size={18} aria-hidden="true" />
          )}
        </button>
        {onLeave ? (
          <button
            type="button"
            className="media-control-button media-leave"
            aria-label="Leave voice"
            title={pendingAction ? pendingReason : 'Leave voice'}
            disabled={pendingAction !== null}
            onClick={() =>
              void runAction(
                'leave',
                'The voice channel could not be left cleanly. Try again.',
                () => onLeave(),
              )
            }
          >
            <PhoneOff size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <details className="media-device-settings">
        <summary>
          <Settings2 size={16} aria-hidden="true" />
          <span>More settings</span>
        </summary>
        <div className="media-device-settings-grid">
          <DeviceSelect
            label="Microphone"
            devices={audioInputs}
            value={activeInputDeviceId}
            disabled={controlsBlocked || !microphoneAvailable}
            disabledReason={
              !microphoneAvailable
                ? capabilities.microphone
                  ? 'No microphone devices were detected.'
                  : 'Microphone selection is unavailable on this platform.'
                : !connected
                  ? unavailableWhileDisconnected
                  : pendingAction
                    ? pendingReason
                    : null
            }
            onChange={async (deviceId) => {
              await runAction(
                'input-device',
                'The selected microphone could not be activated.',
                () => onInputDeviceChange(deviceId),
              );
            }}
          />
          <DeviceSelect
            label="Camera"
            devices={cameras}
            value={activeCameraDeviceId}
            disabled={controlsBlocked || !cameraAvailable}
            disabledReason={
              !cameraAvailable
                ? capabilities.camera
                  ? 'No camera devices were detected.'
                  : 'Camera selection is unavailable on this platform.'
                : !connected
                  ? unavailableWhileDisconnected
                  : pendingAction
                    ? pendingReason
                    : null
            }
            onChange={async (deviceId) => {
              await runAction('camera-device', 'The selected camera could not be activated.', () =>
                onCameraDeviceChange(deviceId),
              );
            }}
          />
          <DeviceSelect
            label="Output"
            devices={audioOutputs}
            value={activeOutputDeviceId}
            disabled={controlsBlocked || !capabilities.outputSelection}
            disabledReason={
              !capabilities.outputSelection
                ? 'Audio output selection is not supported on this platform.'
                : !connected
                  ? unavailableWhileDisconnected
                  : pendingAction
                    ? pendingReason
                    : null
            }
            onChange={async (deviceId) => {
              await runAction(
                'output-device',
                'The selected audio output could not be activated.',
                () => onOutputDeviceChange(deviceId),
              );
            }}
          />
        </div>
      </details>

      {!microphoneAvailable ||
      !cameraAvailable ||
      !capabilities.screenShare ||
      !capabilities.outputSelection ? (
        <p className="media-capability-note" role="note">
          Some media features are unavailable on this platform or no compatible device was detected.
          {!capabilities.outputSelection ? ' Audio output follows the system default.' : ''}
        </p>
      ) : null}

      {windowsTauri && connected && screenPicker ? (
        <ScreenSourcePicker
          state={screenPicker}
          onCancel={cancelScreenPicker}
          onRetry={openScreenPicker}
          onSelect={selectScreenSource}
        />
      ) : null}
    </div>
  );
}
interface ScreenSourcePickerProps {
  state: ScreenPickerState;
  onCancel(): void;
  onRetry(): void;
  onSelect(source: NativeScreenCaptureSource): void;
}

function ScreenSourcePicker({
  state,
  onCancel,
  onRetry,
  onSelect,
}: ScreenSourcePickerProps): JSX.Element {
  const screens =
    state.status === 'ready' ? state.sources.filter((source) => source.kind === 'screen') : [];
  const windows =
    state.status === 'ready' ? state.sources.filter((source) => source.kind === 'window') : [];

  return (
    <div
      className="screen-source-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby="screen-source-picker-title"
      aria-busy={state.status === 'loading'}
    >
      <h2 id="screen-source-picker-title">Share your screen</h2>
      {state.status === 'loading' ? (
        <p role="status" aria-live="polite">
          Loading screens and windows…
        </p>
      ) : state.status === 'error' ? (
        <>
          <p role="alert">{state.message}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </>
      ) : (
        <>
          {screens.length > 0 ? (
            <ScreenSourceGroup label="Screens" sources={screens} onSelect={onSelect} />
          ) : null}
          {windows.length > 0 ? (
            <ScreenSourceGroup label="Windows" sources={windows} onSelect={onSelect} />
          ) : null}
          {screens.length === 0 && windows.length === 0 ? (
            <p role="status">No screens or windows are available to share.</p>
          ) : null}
        </>
      )}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

interface ScreenSourceGroupProps {
  label: string;
  sources: NativeScreenCaptureSource[];
  onSelect(source: NativeScreenCaptureSource): void;
}

function ScreenSourceGroup({ label, sources, onSelect }: ScreenSourceGroupProps): JSX.Element {
  return (
    <section aria-labelledby={`screen-source-group-${label.toLowerCase()}`}>
      <h3 id={`screen-source-group-${label.toLowerCase()}`}>{label}</h3>
      <ul>
        {sources.map((source) => (
          <li key={source.id}>
            <button type="button" onClick={() => onSelect(source)}>
              {source.name || source.id}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface DeviceSelectProps {
  label: string;
  devices: MediaDevice[];
  value: string | null;
  disabled: boolean;
  disabledReason: string | null;
  onChange(deviceId: string): Promise<void>;
}

function DeviceSelect({
  label,
  devices,
  value,
  disabled,
  disabledReason,
  onChange,
}: DeviceSelectProps): JSX.Element {
  const selectableDevices = devices.filter((device) => device.deviceId !== 'default');
  const selectedValue =
    value && value !== 'default' && selectableDevices.some((device) => device.deviceId === value)
      ? value
      : '';
  const reason =
    disabledReason ??
    (devices.length === 0 ? `No ${label.toLowerCase()} devices were detected.` : null);
  const reasonId = `media-device-${label.toLowerCase()}-reason`;
  const systemDefaultDeviceId =
    devices.find((device) => device.deviceId === 'default')?.deviceId ?? devices[0]?.deviceId;

  return (
    <label>
      {label}
      <select
        value={selectedValue}
        disabled={disabled || devices.length === 0}
        title={reason ?? undefined}
        aria-describedby={reason ? reasonId : undefined}
        onChange={(event) => {
          const deviceId = event.target.value || systemDefaultDeviceId;
          if (deviceId) void onChange(deviceId);
        }}
      >
        <option value="">System default</option>
        {selectableDevices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${label} ${device.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
      {reason ? (
        <span id={reasonId} className="media-device-reason">
          {reason}
        </span>
      ) : null}
    </label>
  );
}
