import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, RefreshCw } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import type { Update } from '@tauri-apps/plugin-updater';
import packageMetadata from '../../package.json';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15_000;
const APP_VERSION = packageMetadata.version;
const STORE_MANAGED = import.meta.env.VITE_DISTRIBUTION_CHANNEL === 'microsoft-store';

type UpdatePhase =
  | 'unavailable'
  | 'store-managed'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'offline'
  | 'error'
  | 'downloading'
  | 'ready'
  | 'failed';

interface UpdateViewState {
  phase: UpdatePhase;
  version: string | null;
  downloadedBytes: number;
  contentLength: number | null;
  error: string | null;
}

const nativeInitialState: UpdateViewState = {
  phase: 'idle',
  version: null,
  downloadedBytes: 0,
  contentLength: null,
  error: null,
};

const browserInitialState: UpdateViewState = {
  ...nativeInitialState,
  phase: 'unavailable',
};

const storeInitialState: UpdateViewState = {
  ...nativeInitialState,
  phase: 'store-managed',
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The update could not be installed.';
}

function isOfflineError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    (typeof navigator !== 'undefined' && !navigator.onLine) ||
    /offline|network|fetch|connect|timeout|timed out|internet/i.test(message)
  );
}

function isPromptPhase(phase: UpdatePhase): boolean {
  return (
    phase === 'available' || phase === 'downloading' || phase === 'ready' || phase === 'failed'
  );
}

export function UpdatePrompt() {
  const nativeUpdaterAvailable = isTauri() && !STORE_MANAGED;
  const updateRef = useRef<Update | null>(null);
  const checkingRef = useRef(false);
  const stateRef = useRef<UpdateViewState>(
    STORE_MANAGED
      ? storeInitialState
      : nativeUpdaterAvailable
        ? nativeInitialState
        : browserInitialState,
  );
  const mountedRef = useRef(false);
  const [state, setState] = useState<UpdateViewState>(stateRef.current);

  const updateState = (next: UpdateViewState | ((current: UpdateViewState) => UpdateViewState)) => {
    setState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      stateRef.current = resolved;
      return resolved;
    });
  };

  const checkForUpdate = async () => {
    if (!nativeUpdaterAvailable || checkingRef.current || stateRef.current.phase === 'downloading')
      return;
    checkingRef.current = true;
    let installAfterCheck = false;
    const previousUpdate = updateRef.current;
    updateRef.current = null;
    if (previousUpdate) void previousUpdate.close();
    updateState({
      phase: 'checking',
      version: null,
      downloadedBytes: 0,
      contentLength: null,
      error: null,
    });

    try {
      // Load the native updater only after confirming the Tauri runtime; browser bundles must not execute it.
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (!mountedRef.current) {
        if (update) await update.close();
        return;
      }
      if (!update) {
        updateState({
          phase: 'up-to-date',
          version: null,
          downloadedBytes: 0,
          contentLength: null,
          error: null,
        });
        return;
      }
      updateRef.current = update;
      updateState({
        phase: 'available',
        version: update.version,
        downloadedBytes: 0,
        contentLength: null,
        error: null,
      });
      installAfterCheck = true;
    } catch (error) {
      if (mountedRef.current) {
        updateState((current) => ({
          ...current,
          phase: isOfflineError(error) ? 'offline' : 'error',
          version: null,
          error: errorMessage(error),
        }));
      }
    } finally {
      checkingRef.current = false;
      if (installAfterCheck) void install();
    }
  };
  useEffect(() => {
    mountedRef.current = true;
    if (!nativeUpdaterAvailable) {
      return () => {
        mountedRef.current = false;
      };
    }

    const initialCheck = globalThis.setTimeout(() => void checkForUpdate(), 1_500);
    const interval = globalThis.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      globalThis.clearTimeout(initialCheck);
      globalThis.clearInterval(interval);
      const update = updateRef.current;
      updateRef.current = null;
      if (update) void update.close();
    };
  }, [nativeUpdaterAvailable]);

  const restart = async () => {
    try {
      // The process plugin is native-only, so keep it out of browser execution.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      updateState((current) => ({ ...current, phase: 'ready', error: errorMessage(error) }));
    }
  };

  const install = async () => {
    const update = updateRef.current;
    if (!update || checkingRef.current) return;

    checkingRef.current = true;
    updateState((current) => ({
      ...current,
      phase: 'downloading',
      downloadedBytes: 0,
      contentLength: null,
      error: null,
    }));

    let downloadedBytes = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          updateState((current) => ({
            ...current,
            contentLength: event.data.contentLength ?? null,
          }));
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          updateState((current) => ({ ...current, downloadedBytes }));
        }
      });
      updateRef.current = null;
      updateState((current) => ({ ...current, phase: 'ready', error: null }));
      await restart();
    } catch (error) {
      updateState((current) => ({ ...current, phase: 'failed', error: errorMessage(error) }));
    } finally {
      checkingRef.current = false;
    }
  };

  const progress = state.contentLength
    ? Math.min(100, Math.round((state.downloadedBytes / state.contentLength) * 100))
    : null;
  const showPrompt = isPromptPhase(state.phase);
  const status =
    state.phase === 'store-managed'
      ? 'Updates managed by Microsoft Store'
      : state.phase === 'unavailable'
        ? 'Updater unavailable in browser mode'
        : state.phase === 'idle'
          ? 'Updates not checked'
          : state.phase === 'checking'
            ? 'Checking for updates…'
            : state.phase === 'up-to-date'
              ? 'Up to date'
              : state.phase === 'available'
                ? `Update available: ${state.version}`
                : state.phase === 'offline'
                  ? 'Offline — update check unavailable'
                  : state.phase === 'error'
                    ? `Update check failed${state.error ? `: ${state.error}` : ''}`
                    : state.phase === 'downloading'
                      ? progress === null
                        ? 'Downloading update…'
                        : `Downloading update… ${progress}%`
                      : state.phase === 'ready'
                        ? 'Update installed — restart required'
                        : 'Update installation failed';
  const checking = state.phase === 'checking' || state.phase === 'downloading';

  return (
    <>
      <footer className="app-status-bar" aria-label="Application status">
        <span className="text-xs font-semibold text-ink">Guilda v{APP_VERSION}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted" aria-live="polite">
          {status}
        </span>
        <button
          type="button"
          onClick={() => void checkForUpdate()}
          disabled={!nativeUpdaterAvailable || checking}
          aria-busy={checking}
          aria-label={
            STORE_MANAGED
              ? 'Updates managed by Microsoft Store'
              : !nativeUpdaterAvailable
                ? 'Check for updates (unavailable in browser mode)'
                : checking
                  ? 'Checking for updates'
                  : 'Check for updates'
          }
          title={
            STORE_MANAGED
              ? 'Updates managed by Microsoft Store'
              : !nativeUpdaterAvailable
                ? 'Updater unavailable in browser mode'
                : 'Check for updates'
          }
          className="rounded-md p-1 text-muted transition hover:bg-white/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={checking ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
        </button>
      </footer>

      {showPrompt && (
        <aside
          aria-live="polite"
          className="fixed bottom-14 left-1/2 z-[100] w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border border-violet/40 bg-panel/95 p-4 shadow-2xl shadow-black/40 backdrop-blur"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-violet/15 p-2 text-violet">
              {state.phase === 'downloading' ? (
                <RefreshCw size={18} className="animate-spin" />
              ) : (
                <ArrowDownToLine size={18} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {state.phase === 'ready'
                  ? 'Update installed'
                  : `Guilda ${state.version} is available`}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                {state.phase === 'available' && 'Required update. Download starting automatically…'}
                {state.phase === 'downloading' &&
                  (progress === null ? 'Downloading update…' : `Downloading update… ${progress}%`)}
                {state.phase === 'ready' && 'Restart Guilda to finish applying the update.'}
                {state.phase === 'failed' && (state.error ?? 'The update could not be installed.')}
              </p>
              {state.phase === 'downloading' && state.contentLength && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div
                    className="h-full rounded-full bg-violet transition-[width]"
                    style={{ width: `${progress ?? 0}%` }}
                  />
                </div>
              )}
              <div className="mt-3 flex gap-2">
                {state.phase === 'failed' && (
                  <button
                    type="button"
                    onClick={() => void install()}
                    className="rounded-lg bg-violet px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet/90"
                  >
                    Try again
                  </button>
                )}
                {state.phase === 'ready' && (
                  <button
                    type="button"
                    onClick={() => void restart()}
                    className="rounded-lg bg-violet px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet/90"
                  >
                    Restart Guilda
                  </button>
                )}
              </div>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
