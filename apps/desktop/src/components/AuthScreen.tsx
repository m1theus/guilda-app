import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, Sparkles } from 'lucide-react';
import { Button } from '@guilda/ui';
import { useAuthStore } from '../store/appStore';

export function AuthScreen() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '' });
  const [persistSession, setPersistSession] = useState(true);
  const { login, register, busy, error, clearError } = useAuthStore();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (isRegistering) await register(form, persistSession);
      else await login(form.email, form.password, persistSession);
    } catch {
      // The auth store exposes the request error in the form.
    }
  };
  return (
    <main className="min-h-screen overflow-hidden bg-canvas text-ink">
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(circle at 10% 10%, rgba(150,132,255,.2), transparent 32%), radial-gradient(circle at 90% 75%, rgba(117,224,189,.14), transparent 30%)',
        }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center px-5 py-10 lg:px-12">
        <div className="grid w-full gap-14 lg:grid-cols-[1fr_440px] lg:items-center">
          <section className="hidden lg:block">
            <div className="mb-10 flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet text-canvas">
                <Sparkles size={21} />
              </span>
              <span className="text-lg font-bold tracking-tight">guilda</span>
            </div>
            <p className="mb-5 max-w-xl text-6xl font-semibold leading-[1.04] tracking-[-.055em]">
              Find your people.
              <br />
              <span className="text-violet">Make a little noise.</span>
            </p>
            <p className="max-w-md text-lg leading-8 text-muted">
              A warm, focused home for the communities and conversations that matter.
            </p>
            <div className="mt-12 grid max-w-lg grid-cols-3 gap-3">
              <div className="rounded-2xl border border-line bg-panel/70 p-4">
                <p className="text-2xl font-semibold text-mint">24k</p>
                <p className="mt-1 text-xs text-muted">circles gathering</p>
              </div>
              <div className="rounded-2xl border border-line bg-panel/70 p-4">
                <p className="text-2xl font-semibold text-violet">8.4m</p>
                <p className="mt-1 text-xs text-muted">ideas shared</p>
              </div>
              <div className="rounded-2xl border border-line bg-panel/70 p-4">
                <p className="text-2xl font-semibold text-coral">∞</p>
                <p className="mt-1 text-xs text-muted">room to belong</p>
              </div>
            </div>
          </section>
          <section className="mx-auto w-full max-w-md rounded-[2rem] border border-line bg-panel/95 p-7 shadow-glow backdrop-blur-xl sm:p-9">
            <div className="mb-8 lg:hidden">
              <div className="mb-5 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet text-canvas">
                  <Sparkles size={21} />
                </span>
                <span className="text-lg font-bold">guilda</span>
              </div>
            </div>
            <div className="mb-8">
              <p className="mb-2 text-sm font-medium text-violet">
                {isRegistering ? 'Start your circle' : 'Welcome back'}
              </p>
              <h1 className="text-3xl font-semibold tracking-tight">
                {isRegistering ? 'Create your account' : 'Step back into Guilda'}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                {isRegistering
                  ? 'Your next favorite room is a few details away.'
                  : 'Your spaces, people, and unfinished conversations are waiting.'}
              </p>
            </div>
            <form className="space-y-4" onSubmit={submit}>
              {isRegistering && (
                <>
                  <Field
                    label="Username"
                    value={form.username}
                    onChange={(value) => setForm({ ...form, username: value })}
                    placeholder="mira"
                    minLength={2}
                    maxLength={32}
                    pattern="[A-Za-z0-9_]+"
                    autoComplete="username"
                    disabled={busy}
                  />
                  <Field
                    label="Display name"
                    value={form.displayName}
                    onChange={(value) => setForm({ ...form, displayName: value })}
                    placeholder="Mira Sol"
                    maxLength={64}
                    autoComplete="name"
                    disabled={busy}
                  />
                </>
              )}
              <Field
                label="Email"
                type="email"
                value={form.email}
                onChange={(value) => setForm({ ...form, email: value })}
                placeholder="you@example.com"
                maxLength={320}
                autoComplete="email"
                disabled={busy}
              />
              <label className="block text-sm font-medium text-ink">
                Password
                <div className="relative mt-2">
                  <input
                    required
                    minLength={isRegistering ? 8 : 1}
                    type={showPassword ? 'text' : 'password'}
                    maxLength={128}
                    autoComplete={isRegistering ? 'new-password' : 'current-password'}
                    disabled={busy}
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    className="h-12 w-full rounded-xl border border-line bg-canvas px-4 pr-12 text-sm outline-none transition placeholder:text-muted/60 focus:border-violet disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder={isRegistering ? '8+ characters' : 'Your password'}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-muted hover:text-ink"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={persistSession}
                  onChange={(event) => setPersistSession(event.target.checked)}
                  className="h-4 w-4 rounded border-line accent-violet disabled:cursor-not-allowed disabled:opacity-50"
                />
                Keep me signed in on this device
              </label>
              {error && (
                <p
                  className="rounded-xl border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral"
                  role="alert"
                >
                  {error}
                </p>
              )}
              <Button className="h-12 w-full" disabled={busy}>
                {busy ? 'Connecting…' : isRegistering ? 'Create account' : 'Sign in'}{' '}
                {!busy && <ArrowRight size={17} />}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted">
              {isRegistering ? 'Already have an account?' : 'New to Guilda?'}{' '}
              <button
                type="button"
                className="font-semibold text-violet hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={() => {
                  clearError();
                  setIsRegistering((current) => !current);
                }}
              >
                {isRegistering ? 'Sign in' : 'Create one'}
              </button>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  minLength,
  maxLength,
  pattern,
  autoComplete,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  autoComplete?: string;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      <input
        required
        type={type}
        minLength={minLength}
        maxLength={maxLength}
        pattern={pattern}
        autoComplete={autoComplete}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-12 w-full rounded-xl border border-line bg-canvas px-4 text-sm outline-none transition placeholder:text-muted/60 focus:border-violet disabled:cursor-not-allowed disabled:opacity-60"
        placeholder={placeholder}
      />
    </label>
  );
}
