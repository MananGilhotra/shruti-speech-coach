/* Small UI primitives shared by every page (no external UI kit). */
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { IconAlert, IconInfo, IconRefresh, IconX } from './icons';

// ----------------------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'xs' | 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-accent',
  secondary: 'bg-white text-ink border border-line-strong hover:bg-slate-50',
  ghost: 'bg-transparent text-ink-soft border border-transparent hover:bg-slate-100',
  danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50',
  success: 'bg-emerald-700 text-white border border-emerald-700 hover:bg-emerald-800',
};
const SIZE: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs gap-1',
  sm: 'h-8 px-2.5 text-sm gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shown as a tooltip; for disabled buttons the tooltip is placed on a wrapper so it still appears. */
  hint?: string;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', hint, loading, className = '', children, disabled, ...rest },
  ref,
) {
  const btn = (
    <button
      ref={ref}
      type="button"
      title={disabled ? undefined : hint}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
  if (disabled && hint) {
    return (
      <span title={hint} className="inline-flex cursor-not-allowed">
        {btn}
      </span>
    );
  }
  return btn;
});

// ----------------------------------------------------------------------------- Spinner
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ----------------------------------------------------------------------------- Panel
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4',
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`rounded-lg border border-line bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

// ----------------------------------------------------------------------------- Badge / Chip
type Tone = 'neutral' | 'accent' | 'amber' | 'green' | 'red' | 'blue';
const TONE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-ink-soft border-slate-200',
  accent: 'bg-accent-soft text-accent border-indigo-200',
  amber: 'bg-amber-50 text-amber-900 border-amber-200',
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  red: 'bg-red-50 text-red-800 border-red-200',
  blue: 'bg-sky-50 text-sky-900 border-sky-200',
};

export function Badge({
  tone = 'neutral',
  children,
  className = '',
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs font-medium ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.4rem] items-center justify-center rounded border border-line-strong bg-slate-50 px-1 font-mono text-2xs text-ink-soft">
      {children}
    </kbd>
  );
}

/** A colour swatch that carries identity next to (never instead of) a text label. */
export function Swatch({ color, texture, className = '' }: { color: string; texture?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 shrink-0 rounded-[3px] border ${className}`}
      style={{ backgroundColor: `${color}33`, borderColor: color, backgroundImage: texture }}
    />
  );
}

// ----------------------------------------------------------------------------- Segmented control
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'xs' | 'sm';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-slate-50 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring disabled:cursor-not-allowed disabled:opacity-40 ${
              size === 'xs' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
            } ${active ? 'bg-white text-accent shadow-[0_0_0_1px_rgba(55,48,163,0.35)]' : 'text-ink-soft hover:text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------- states
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-muted">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  icon,
  action,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-sunken px-6 py-12 text-center">
      <div className="mb-3 text-ink-faint">{icon ?? <IconInfo size={28} />}</div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <IconAlert size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 break-words text-red-800">{message}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <IconRefresh size={14} /> Retry
        </Button>
      )}
    </div>
  );
}

export function Notice({
  tone = 'amber',
  children,
  className = '',
}: {
  tone?: 'amber' | 'blue' | 'neutral' | 'green';
  children: ReactNode;
  className?: string;
}) {
  const cls =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-950'
      : tone === 'blue'
        ? 'border-sky-200 bg-sky-50 text-sky-950'
        : tone === 'green'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
          : 'border-line bg-surface-sunken text-ink-soft';
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls} ${className}`}>{children}</div>;
}

// ----------------------------------------------------------------------------- Modal
export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-3xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={`mt-10 w-full ${width} rounded-lg border border-line bg-white outline-none`}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-muted hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            <IconX size={18} />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Popover (click-to-toggle)
export function Popover({
  trigger,
  children,
  align = 'right',
  label,
  open: openProp,
  onOpenChange,
}: {
  trigger: (open: boolean) => ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(open) : v;
    setOpenState(next);
    onOpenChange?.(next);
  };
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenRef.current(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
      >
        {trigger(open)}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`absolute top-full z-40 mt-2 w-max max-w-[420px] rounded-lg border border-line bg-white p-3 text-sm shadow-[0_4px_16px_rgba(15,23,42,0.08)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- Stat tile
export function Stat({
  label,
  value,
  unit,
  hint,
  className = '',
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line bg-white px-3 py-2.5 ${className}`}>
      <div className="text-2xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums text-ink">{value}</span>
        {unit && <span className="text-xs text-ink-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-2xs text-ink-muted">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-base font-semibold text-ink">{children}</h2>
      {aside}
    </div>
  );
}

export function CloseButton({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-md p-1 text-ink-muted hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
    >
      <IconX size={16} />
    </button>
  );
}
