/* A play/stop button for a remote audio file. One shared <audio> element, so starting one
 * button stops any other. Disabled (with a tooltip) when the API is offline. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { IconPause, IconPlay } from './icons';
import { Button, Spinner } from './ui';
import { useAppState } from '../lib/appState';

type SharedStatus = 'idle' | 'loading' | 'playing' | 'error';
const audio = typeof Audio !== 'undefined' ? new Audio() : null;
let current: string | null = null;
let status: SharedStatus = 'idle';
const listeners = new Set<() => void>();
let snapshot: { current: string | null; status: SharedStatus } = { current, status };

function emit() {
  snapshot = { current, status };
  listeners.forEach((l) => l());
}

if (audio) {
  audio.preload = 'none';
  audio.addEventListener('playing', () => {
    status = 'playing';
    emit();
  });
  audio.addEventListener('waiting', () => {
    status = 'loading';
    emit();
  });
  audio.addEventListener('ended', () => {
    status = 'idle';
    current = null;
    emit();
  });
  audio.addEventListener('error', () => {
    if (!current) return;
    status = 'error';
    emit();
  });
}

export function stopSharedAudio() {
  if (!audio) return;
  audio.pause();
  current = null;
  status = 'idle';
  emit();
}

export function playShared(url: string) {
  if (!audio) return;
  if (current === url && status !== 'error') {
    stopSharedAudio();
    return;
  }
  current = url;
  status = 'loading';
  emit();
  audio.src = url;
  audio.play().catch(() => {
    if (current === url) {
      status = 'error';
      emit();
    }
  });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSharedAudio() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

export default function AudioButton({
  url,
  label = 'Play original',
  playingLabel = 'Stop',
  size = 'sm',
  variant = 'secondary',
  className = '',
}: {
  url: string;
  label?: string;
  playingLabel?: string;
  size?: 'xs' | 'sm' | 'md';
  variant?: 'secondary' | 'ghost' | 'primary';
  className?: string;
}) {
  const { online } = useAppState();
  const s = useSharedAudio();
  const mine = s.current === url;
  const [err, setErr] = useState(false);
  useEffect(() => setErr(mine && s.status === 'error'), [mine, s.status]);
  useEffect(() => () => {
    if (snapshot.current === url) stopSharedAudio();
  }, [url]);
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={!online}
      hint={!online ? 'Audio needs the SHRUTI API (offline demo mode)' : err ? 'This audio could not be played' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        playShared(url);
      }}
      aria-label={mine && s.status !== 'error' ? playingLabel : label}
    >
      {mine && s.status === 'loading' ? <Spinner size={12} /> : mine && s.status === 'playing' ? <IconPause size={12} /> : <IconPlay size={12} />}
      {err ? 'Unavailable' : mine && s.status !== 'error' ? playingLabel : label}
    </Button>
  );
}
