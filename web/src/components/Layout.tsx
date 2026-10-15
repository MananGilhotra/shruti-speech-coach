import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { sampleAnalysis } from '../api';
import { useAppState } from '../lib/appState';
import { shortHash } from '../lib/format';
import { IconRefresh } from './icons';
import { Spinner } from './ui';

const NAV = [
  { to: '/analyse', label: 'Analyse' },
  { to: '/explore', label: 'Benchmark' },
  { to: '/evaluation', label: 'Evaluation' },
  { to: '/studio', label: 'Flaw Studio' },
  { to: '/study', label: 'Study' },
  { to: '/method', label: 'Method' },
];

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="#3730a3" />
        <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
          <line x1="8" y1="13" x2="8" y2="19" />
          <line x1="13" y1="9" x2="13" y2="23" />
          <line x1="18" y1="12" x2="18" y2="20" />
        </g>
        <line x1="23.5" y1="7" x2="23.5" y2="25" stroke="#fbbf24" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      {!compact && <span className="text-[15px] font-bold tracking-[0.14em] text-ink">SHRUTI</span>}
    </span>
  );
}

function ApiIndicator() {
  const { status, recheck } = useAppState();
  if (status === 'checking')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
        <Spinner size={12} /> Connecting…
      </span>
    );
  if (status === 'online')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft" title="The SHRUTI API is reachable">
        <span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden="true" /> API online
      </span>
    );
  return (
    <button
      type="button"
      onClick={recheck}
      className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-amber-900 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
      title="The API is unreachable — click to retry"
    >
      <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" /> Offline demo
      <IconRefresh size={12} />
    </button>
  );
}

function OfflineBanner() {
  const { status, recheck } = useAppState();
  if (status !== 'offline') return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-page items-center justify-between gap-4 px-6 py-2 text-sm text-amber-950">
        <p>
          <strong className="font-semibold">Offline demo mode.</strong> The SHRUTI API isn’t reachable, so recording,
          audio playback and the Ghost Coach are disabled. The bundled{' '}
          <Link to="/analysis/sample" className="link">
            sample analysis
          </Link>{' '}
          is fully browsable.
        </p>
        <button
          type="button"
          onClick={recheck}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          <IconRefresh size={12} /> Retry connection
        </button>
      </div>
    </div>
  );
}

function Footer() {
  const { version, online, status } = useAppState();
  const fp = sampleAnalysis.fingerprint;
  return (
    <footer className="mt-16 border-t border-line bg-white">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-3 px-6 py-4 text-xs text-ink-muted">
        <div className="flex items-center gap-3">
          <Logo compact />
          <span>
            SHRUTI · contrastive speech analytics with temporal flaw grounding · IIT Mandi Multimodal AI Hackathon 2026
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs">
          {status === 'checking' || (online && !version) ? (
            <span>fetching version…</span>
          ) : online && version ? (
            <>
              <span>v{version.version}</span>
              <span title="Hash of the active configuration file">config {shortHash(version.config_hash, 12)}</span>
              <span title="Forced-alignment acoustic model">model {version.model}</span>
            </>
          ) : (
            <>
              <span>v{sampleAnalysis.version} (bundled)</span>
              <span>config {fp.config}</span>
              <span>model {fp.model}</span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const isAnalysis = loc.pathname.startsWith('/analysis/');
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-page items-center gap-8 px-6">
          <Link to="/" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring" aria-label="SHRUTI home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                    isActive ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-slate-100 hover:text-ink'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <ApiIndicator />
          </div>
        </div>
      </header>
      <OfflineBanner />
      <main id="main" className={`mx-auto w-full max-w-page flex-1 px-6 ${isAnalysis ? 'py-5' : 'py-8'}`}>
        {children}
      </main>
      <Footer />
    </div>
  );
}
