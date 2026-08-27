import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';

export function Button({
  className = '',
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'soft';
}) {
  const variants = {
    primary: 'bg-violet text-white hover:bg-violetDark shadow-[0_8px_24px_rgba(150,132,255,.18)]',
    ghost: 'text-muted hover:text-ink hover:bg-white/[.06]',
    danger: 'bg-coral/15 text-coral hover:bg-coral/25',
    soft: 'bg-white/[.07] text-ink hover:bg-white/[.12]',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-white/[.07] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

export function Modal({
  title,
  description,
  size = 'default',
  onClose,
  closeDisabled = false,
  children,
}: {
  title: string;
  description?: string;
  size?: 'default' | 'wide';
  closeDisabled?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !closeDisabled && onClose()}
    >
      <section
        className={`w-full overflow-hidden rounded-3xl border border-line bg-panel shadow-2xl ${
          size === 'wide' ? 'max-w-5xl' : 'max-w-md'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-start justify-between border-b border-line px-6 py-5">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose} disabled={closeDisabled}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="p-6">{children}</div>
      </section>
    </div>
  );
}

export function Avatar({
  name,
  src,
  size = 'md',
  status,
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  status?: string;
}) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const sizing = { sm: 'h-7 w-7 text-[10px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' };
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className={`inline-flex ${sizing[size]} items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet to-mint font-bold text-canvas`}
      >
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials}
      </span>
      {status && <StatusDot status={status} />}
    </span>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ONLINE'
      ? 'bg-mint'
      : status === 'DND'
        ? 'bg-coral'
        : status === 'IDLE'
          ? 'bg-amber-300'
          : 'bg-muted';
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel ${color}`}
      aria-label={status.toLowerCase()}
    />
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet/30 border-t-violet" />
      {label}
    </span>
  );
}
export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-violet/10 text-violet">
        {icon}
      </span>
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}
