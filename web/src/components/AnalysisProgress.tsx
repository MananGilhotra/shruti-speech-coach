/* Submitting audio for analysis: upload progress, then the pipeline stages, then navigation. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, createAnalysis, errorMessage, type AnalysisUpload } from '../api';
import { prepareUpload } from '../lib/audio';
import { IconAlert, IconCheck } from './icons';
import { Button, Spinner } from './ui';

export type SubmitPhase = 'idle' | 'converting' | 'uploading' | 'processing' | 'done' | 'error';

export interface SubmitState {
  phase: SubmitPhase;
  uploadFrac: number;
  processingSince: number | null;
  error: { status: number; message: string } | null;
}

/** Converts to 16 kHz WAV, uploads with progress, waits for the analysis, then opens it. */
export function useAnalysisSubmit() {
  const navigate = useNavigate();
  const [state, setState] = useState<SubmitState>({ phase: 'idle', uploadFrac: 0, processingSince: null, error: null });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const submit = useCallback(
    async (audio: Blob, baseName: string, opts: Omit<AnalysisUpload, 'audio' | 'filename'>, convert = true) => {
      setState({ phase: 'converting', uploadFrac: 0, processingSince: null, error: null });
      try {
        const up = convert ? await prepareUpload(audio, baseName) : { blob: audio, filename: baseName };
        if (!alive.current) return;
        setState((s) => ({ ...s, phase: 'uploading' }));
        let processingSet = false;
        const a = await createAnalysis({ ...opts, audio: up.blob, filename: up.filename }, (f) => {
          if (!alive.current) return;
          if (f >= 1 && !processingSet) {
            processingSet = true;
            setState((s) => ({ ...s, uploadFrac: 1, phase: 'processing', processingSince: performance.now() }));
          } else if (!processingSet) setState((s) => ({ ...s, uploadFrac: f }));
        });
        if (!alive.current) return;
        setState((s) => ({ ...s, phase: 'done' }));
        window.setTimeout(() => navigate(`/analysis/${a.analysis_id}`), 350);
      } catch (e) {
        if (!alive.current) return;
        setState((s) => ({
          ...s,
          phase: 'error',
          error: { status: e instanceof ApiError ? e.status : -1, message: errorMessage(e) },
        }));
      }
    },
    [navigate],
  );

  const reset = useCallback(() => setState({ phase: 'idle', uploadFrac: 0, processingSince: null, error: null }), []);
  return { state, submit, reset };
}

const STEPS = [
  { label: 'Aligning words', at: 0 },
  { label: 'Measuring prosody', at: 2.5 },
  { label: 'Testing 400+ hypotheses (FDR 5%)', at: 5 },
  { label: 'Writing explanations', at: 9 },
];

export default function AnalysisProgress({ state, onRetry }: { state: SubmitState; onRetry?: () => void }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (state.phase !== 'processing' && state.phase !== 'uploading' && state.phase !== 'converting') return;
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, [state.phase]);

  if (state.phase === 'idle') return null;

  if (state.phase === 'error' && state.error) {
    const quality = state.error.status === 422;
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <IconAlert size={18} className="mt-0.5 shrink-0 text-red-800" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-red-900">{quality ? 'We couldn’t analyse this recording' : 'The analysis failed'}</p>
            <p className="mt-0.5 text-red-900">{state.error.message}</p>
            {quality && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-red-900/90">
                <li>Read the whole passage, word for word, in one take.</li>
                <li>Record somewhere quiet, about a hand’s width from the microphone.</li>
                <li>Keep it between a few seconds and the passage length plus a little slack.</li>
              </ul>
            )}
          </div>
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    );
  }

  const elapsed = state.processingSince != null ? (now - state.processingSince) / 1000 : 0;
  const done = state.phase === 'done';
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3" aria-live="polite">
      <ol className="space-y-2">
        <Step
          label={state.phase === 'converting' ? 'Preparing audio (16 kHz mono WAV)' : `Uploading${state.uploadFrac > 0 && state.uploadFrac < 1 ? ` · ${Math.round(state.uploadFrac * 100)}%` : ''}`}
          status={state.phase === 'converting' || state.phase === 'uploading' ? 'active' : 'done'}
        />
        {STEPS.map((s, i) => {
          const next = STEPS[i + 1]?.at ?? Infinity;
          const st =
            done || (state.phase === 'processing' && elapsed >= next)
              ? 'done'
              : state.phase === 'processing' && elapsed >= s.at
                ? 'active'
                : 'todo';
          return <Step key={s.label} label={s.label} status={st} />;
        })}
      </ol>
      <p className="mt-2 font-mono text-2xs text-ink-muted num">
        {done ? 'Done — opening the analysis…' : state.phase === 'processing' ? `${elapsed.toFixed(1)} s · usually 3–15 s` : ''}
      </p>
    </div>
  );
}

function Step({ label, status }: { label: string; status: 'todo' | 'active' | 'done' }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          status === 'done' ? 'bg-accent text-white' : status === 'active' ? 'text-accent' : 'border border-line-strong text-transparent'
        }`}
        aria-hidden="true"
      >
        {status === 'done' ? <IconCheck size={12} strokeWidth={3} /> : status === 'active' ? <Spinner size={16} /> : null}
      </span>
      <span className={status === 'todo' ? 'text-ink-faint' : status === 'active' ? 'font-medium text-ink' : 'text-ink-soft'}>{label}</span>
      <span className="sr-only">{status === 'done' ? '(done)' : status === 'active' ? '(in progress)' : ''}</span>
    </li>
  );
}
