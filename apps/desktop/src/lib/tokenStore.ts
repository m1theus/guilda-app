import type { AuthTokens } from '@guilda/types/api';
import { nativeBridge } from './nativeBridge';

const BROWSER_TOKEN_KEY = 'noxera.auth.tokens';
const NATIVE_PERSISTENCE_KEY = 'noxera.auth.persist-session';

function isAuthTokens(value: unknown): value is AuthTokens {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.accessToken === 'string' &&
    typeof record.refreshToken === 'string' &&
    typeof record.expiresIn === 'number'
  );
}

function getBrowserTokens(): AuthTokens | null {
  const stored = globalThis.localStorage.getItem(BROWSER_TOKEN_KEY);
  if (stored === null) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (isAuthTokens(value)) return value;
  } catch {
    // Invalid browser sessions are discarded below.
  }
  globalThis.localStorage.removeItem(BROWSER_TOKEN_KEY);
  return null;
}

async function clearDisabledNativeTokens(): Promise<void> {
  try {
    await nativeBridge.auth.clearTokens();
  } catch {
    // The tombstone still prevents restoration; retry cleanup on the next launch.
    console.error('Secure token cleanup failed; the saved session remains disabled.');
  }
}

async function getPersistedTokens(): Promise<AuthTokens | null> {
  if (!nativeBridge.isAvailable()) return getBrowserTokens();
  if (globalThis.localStorage.getItem(NATIVE_PERSISTENCE_KEY) === 'false') {
    await clearDisabledNativeTokens();
    return null;
  }
  const result = await nativeBridge.auth.getTokens();
  if (result === null || isAuthTokens(result)) return result;
  throw new Error('Secure token storage returned an invalid session.');
}

async function persistTokens(tokens: AuthTokens): Promise<void> {
  if (nativeBridge.isAvailable()) {
    // Write the opt-out first: an interrupted Keychain write must never make a
    // session eligible for restoration until both operations have succeeded.
    globalThis.localStorage.setItem(NATIVE_PERSISTENCE_KEY, 'false');
    await nativeBridge.auth.setTokens(tokens);
    globalThis.localStorage.setItem(NATIVE_PERSISTENCE_KEY, 'true');
    return;
  }
  globalThis.localStorage.setItem(BROWSER_TOKEN_KEY, JSON.stringify(tokens));
}
async function clearPersistedTokens(): Promise<void> {
  if (nativeBridge.isAvailable()) {
    // This non-sensitive tombstone preserves opt-out even if Keychain deletion
    // is denied or the process exits before the native command completes.
    globalThis.localStorage.setItem(NATIVE_PERSISTENCE_KEY, 'false');
    await clearDisabledNativeTokens();
    return;
  }
  globalThis.localStorage.removeItem(BROWSER_TOKEN_KEY);
}

type TokenPersistence = 'persistent' | 'session';

let activeTokens: AuthTokens | null | undefined;
let activePersistence: TokenPersistence | null = null;
let initialLoad: Promise<AuthTokens | null> | null = null;

export interface TokenStore {
  get(): Promise<AuthTokens | null>;
  set(tokens: AuthTokens, persist: boolean): Promise<void>;
  replace(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

export const tokenStore: TokenStore = {
  async get() {
    if (activeTokens !== undefined) return activeTokens;
    initialLoad ??= getPersistedTokens()
      .then((tokens) => {
        activeTokens = tokens;
        activePersistence = tokens ? 'persistent' : null;
        return tokens;
      })
      .catch((error: unknown) => {
        initialLoad = null;
        throw error;
      });
    return initialLoad;
  },
  async set(tokens, persist) {
    if (persist) {
      await persistTokens(tokens);
      activePersistence = 'persistent';
    } else {
      await clearPersistedTokens();
      activePersistence = 'session';
    }
    activeTokens = tokens;
  },
  async replace(tokens) {
    await this.get();
    if (activePersistence === null) {
      throw new Error('Cannot refresh a session that is no longer active.');
    }
    if (activePersistence === 'persistent') await persistTokens(tokens);
    activeTokens = tokens;
  },
  async clear() {
    activeTokens = null;
    activePersistence = null;
    await clearPersistedTokens();
  },
};
