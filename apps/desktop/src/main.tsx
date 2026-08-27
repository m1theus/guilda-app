import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthScreen } from './components/AuthScreen';
import { LandingPage } from './components/LandingPage';
import { PrivacyPolicyPage } from './components/PrivacyPolicyPage';
import { Workspace } from './components/Workspace';
import { UpdatePrompt } from './components/UpdatePrompt';
import { nativeBridge, onNativeEvent, type NativeEvent } from './lib/nativeBridge';
import { useAuthStore } from './store/appStore';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false }, mutations: { retry: 0 } },
});
function inviteCodeFromPath(pathname: string): string | null {
  const match = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const code = decodeURIComponent(match[1]!);
    return /^[A-Za-z0-9_-]{4,100}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

const rendersPrivacyPolicy =
  globalThis.location.pathname === '/privacy' || globalThis.location.pathname === '/privacy/';

function App() {
  const invitePathCode = inviteCodeFromPath(globalThis.location.pathname);
  const { user, hydrated, hydrate } = useAuthStore();
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(invitePathCode);
  const previousUserId = useRef<string | null | undefined>(undefined);
  const isNativeApp = nativeBridge.isAvailable();
  const isWebAppPath =
    globalThis.location.pathname === '/app' || globalThis.location.pathname.startsWith('/app/');
  const showLandingPage = !isNativeApp && !isWebAppPath && !rendersPrivacyPolicy && !invitePathCode;
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  useEffect(() => {
    if (showLandingPage && hydrated && user) globalThis.location.replace('/app');
  }, [hydrated, showLandingPage, user]);
  useEffect(() => {
    const userId = user?.id ?? null;
    if (previousUserId.current !== userId) {
      queryClient.clear();
      previousUserId.current = userId;
    }
  }, [user?.id]);
  useEffect(() => {
    if (!isNativeApp) return;
    let disposed = false;
    let stopListening: (() => void) | undefined;
    const handleNativeEvent = (event: NativeEvent) => {
      switch (event.type) {
        case 'inviteDeepLink':
          setPendingInviteCode(event.code);
          break;
        case 'windowVisibility':
          focusManager.setFocused(event.visibility === 'shown');
          if (event.visibility === 'shown') document.title = 'Guilda';
          break;
        case 'singleInstance':
          focusManager.setFocused(true);
          document.title = 'Guilda';
          break;
        case 'tray':
          if (event.action === 'show') focusManager.setFocused(true);
          if (event.action === 'hide') focusManager.setFocused(false);
          break;
        case 'notificationShown':
          if (!focusManager.isFocused()) document.title = `${event.title} • Guilda`;
          break;
        case 'integrationError':
          console.error(`Native ${event.integration} failed (${event.code}): ${event.message}`);
          break;
      }
    };
    void onNativeEvent(handleNativeEvent).then(
      (unlisten) => {
        if (disposed) unlisten();
        else stopListening = unlisten;
      },
      (error: unknown) => {
        console.error('Native event bridge failed to start.', error);
      },
    );
    return () => {
      disposed = true;
      stopListening?.();
      focusManager.setFocused(undefined);
    };
  }, [isNativeApp]);
  if (!isNativeApp && rendersPrivacyPolicy) return <PrivacyPolicyPage />;
  if (showLandingPage && hydrated && !user) return <LandingPage />;
  if (!hydrated || showLandingPage) return <LoadingScreen />;
  return user ? (
    <Workspace
      key={user.id}
      pendingInviteCode={pendingInviteCode}
      onInviteConsumed={() => setPendingInviteCode(null)}
    />
  ) : (
    <AuthScreen />
  );
}
function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas">
      <div className="h-10 w-10 animate-pulse rounded-2xl bg-violet" />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {!rendersPrivacyPolicy && <UpdatePrompt />}
    </QueryClientProvider>
  </StrictMode>,
);
