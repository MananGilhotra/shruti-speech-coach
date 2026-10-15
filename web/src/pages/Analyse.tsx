/* /analyse and /analyse/:sid — pick a passage, record (teleprompter + level meter) or upload, analyse. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ScriptInfo } from '../types';
import { scriptAudioUrl } from '../api';
import { useAppState } from '../lib/appState';
import { useScripts } from '../lib/data';
import { useRecorder } from '../lib/useRecorder';
import { tokenizeTranscript } from '../lib/tokenize';
import { fmt, fmtTime } from '../lib/format';
import ScriptCard from '../components/ScriptCard';
import AudioButton, { stopSharedAudio } from '../components/AudioButton';
import LevelMeter from '../components/LevelMeter';
import AnalysisProgress, { useAnalysisSubmit } from '../components/AnalysisProgress';
import { Badge, Button, LoadingState, Notice, Segmented } from '../components/ui';
import { IconChevronLeft, IconMic, IconStop, IconUpload } from '../components/icons';

export default function Analyse() {
  const { sid } = useParams();
  const { scripts, loading } = useScripts();
  if (!sid) return <ScriptPicker scripts={scripts} />;
  if (sid === 'custom') return <RecordPage script={null} />;
  const script = scripts.find((s) => s.script_id === sid);
  if (!script) {
    if (loading) return <LoadingState />;
    return (
      <div className="py-10">
        <Notice tone="amber">
          Unknown passage “{sid}”. <Link to="/analyse" className="link">Choose one of the six passages</Link>.
        </Notice>
      </div>
    );
  }
  return <RecordPage key={script.script_id} script={script} />;
}

function ScriptPicker({ scripts }: { scripts: ScriptInfo[] }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Analyse a delivery</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-soft">
          Choose a passage. Listen to the original once, then read it aloud in your own voice. SHRUTI compares your delivery with the original
          orator word by word.
        </p>
      </header>
      <div className="grid grid-cols-3 gap-4">
        {scripts.map((s) => (
          <ScriptCard key={s.script_id} script={s} to={`/analyse/${s.script_id}`} />
        ))}
        <Link
          to="/analyse/custom"
          className="flex flex-col justify-center rounded-lg border border-dashed border-line-strong bg-white/60 p-4 text-sm text-ink-soft transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          <span className="font-semibold text-ink">Bring your own passage</span>
          <span className="mt-1 text-xs">
            Paste any transcript and upload a reference recording of it; SHRUTI will use that single reference as the baseline.
          </span>
        </Link>
      </div>
    </div>
  );
}

type Source = 'record' | 'upload';

function RecordPage({ script }: { script: ScriptInfo | null }) {
  const { online } = useAppState();
  const rec = useRecorder(240);
  const { state, submit, reset } = useAnalysisSubmit();
  const [source, setSource] = useState<Source>('record');
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [paceGuide, setPaceGuide] = useState(false);
  const [bootstrap, setBootstrap] = useState(true);
  const [customText, setCustomText] = useState('');
  const [refFile, setRefFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const tokens = useMemo(() => (script ? tokenizeTranscript(script.transcript) : []), [script]);
  const target = script?.duration_s ?? null;
  const busy = state.phase === 'converting' || state.phase === 'uploading' || state.phase === 'processing' || state.phase === 'done';

  useEffect(() => {
    if (!file) {
      setFileUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setFileUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const paceIndex =
    paceGuide && rec.status === 'recording' && target && tokens.length ? Math.min(tokens.length - 1, Math.floor((rec.elapsed / target) * tokens.length)) : -1;

  const take: Blob | null = source === 'record' ? rec.blob : file;
  const customReady = script != null || (customText.trim().split(/\s+/).length >= 3 && refFile != null);
  const canAnalyse = online && take != null && !busy && customReady;

  const startRec = async () => {
    stopSharedAudio();
    reset();
    await rec.start();
  };

  const analyse = () => {
    if (!take) return;
    const base = script ? `${script.script_id}_take` : 'custom_take';
    void submit(take, base, script ? { scriptId: script.script_id, bootstrap } : { transcript: customText.trim(), reference: refFile ?? undefined, referenceName: refFile?.name, bootstrap });
  };

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    reset();
  };

  return (
    <div className="space-y-5">
      <div>
        <Link to="/analyse" className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink">
          <IconChevronLeft size={13} /> All passages
        </Link>
      </div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {script ? <Badge tone="accent">{script.script_id}</Badge> : <Badge tone="neutral">Custom passage</Badge>}
            {script && <span className="text-xs text-ink-muted">{script.license}</span>}
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold text-ink">{script ? script.title : 'Your own passage and reference'}</h1>
          {script && (
            <p className="text-sm text-ink-soft">
              {script.speaker} · {script.year} · original {fmt(script.duration_s, 0)} s
            </p>
          )}
        </div>
        {script && <AudioButton url={scriptAudioUrl(script.script_id)} size="md" label="Play the original" playingLabel="Stop the original" />}
      </header>

      {!online && (
        <Notice tone="amber">
          The API is offline, so recordings can’t be analysed right now. You can still rehearse with the teleprompter, or open the{' '}
          <Link to="/analysis/sample" className="link">
            sample analysis
          </Link>
          .
        </Notice>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-5">
        {/* teleprompter */}
        <section className="rounded-lg border border-line bg-white" aria-label="Teleprompter">
          <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
            <h2 className="text-sm font-semibold text-ink">{script ? 'Read this aloud' : 'Transcript'}</h2>
            {script && (
              <label className="flex items-center gap-2 text-xs text-ink-soft" title="Highlights words at the original orator’s average pace while you record">
                <input type="checkbox" className="accent-accent" checked={paceGuide} onChange={(e) => setPaceGuide(e.target.checked)} />
                Pace guide (original speed)
              </label>
            )}
          </div>
          {script ? (
            <p className={`teleprompter px-6 py-6 ${rec.status === 'recording' ? 'text-ink' : 'text-ink-soft'}`}>
              {tokens.map((t, i) => (
                <span key={i}>
                  <span
                    className={`rounded transition-colors duration-200 ${
                      i === paceIndex ? 'bg-accent text-white' : i < paceIndex ? 'text-ink-faint' : ''
                    }`}
                  >
                    {t}
                  </span>{' '}
                </span>
              ))}
            </p>
          ) : (
            <div className="space-y-4 px-5 py-4">
              <div>
                <label htmlFor="custom-text" className="field-label">
                  Transcript (exactly what is said in the reference)
                </label>
                <textarea
                  id="custom-text"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  rows={8}
                  className="field h-auto py-2 text-base leading-relaxed"
                  placeholder="Paste the passage here…"
                />
              </div>
              <div>
                <label htmlFor="ref-file" className="field-label">
                  Reference recording (a good delivery of this transcript)
                </label>
                <input
                  id="ref-file"
                  type="file"
                  accept="audio/*,.wav,.mp3,.flac,.ogg,.webm,.m4a"
                  onChange={(e) => setRefFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-slate-50"
                />
              </div>
              {customText && rec.status === 'recording' && <p className="teleprompter text-ink">{customText}</p>}
            </div>
          )}
        </section>

        {/* recorder */}
        <section className="space-y-3 rounded-lg border border-line bg-white p-4" aria-label="Your take">
          <Segmented<Source>
            label="Take source"
            value={source}
            onChange={(v) => {
              if (rec.status === 'recording') return;
              setSource(v);
              reset();
            }}
            options={[
              { value: 'record', label: 'Record in browser' },
              { value: 'upload', label: 'Upload a file' },
            ]}
          />

          {source === 'record' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {rec.status === 'recording' ? (
                  <button
                    type="button"
                    onClick={() => void rec.stop()}
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
                    aria-label="Stop recording"
                  >
                    <IconStop size={20} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startRec()}
                    disabled={busy || !rec.supported}
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={rec.blob ? 'Record again' : 'Start recording'}
                  >
                    <IconMic size={22} />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-2xl font-semibold text-ink num" aria-live="off">
                      {fmtTime(rec.elapsed, 1)}
                    </span>
                    {target && <span className="text-xs text-ink-muted">original ≈ {fmtTime(target, 0)}</span>}
                  </div>
                  <p className="text-xs text-ink-muted">
                    {rec.status === 'recording'
                      ? 'Recording… read the whole passage, then stop.'
                      : rec.status === 'requesting'
                        ? 'Waiting for microphone permission…'
                        : rec.blob
                          ? 'Take recorded. Listen back, then analyse.'
                          : 'Press the microphone to start.'}
                  </p>
                </div>
              </div>
              <LevelMeter getLevel={rec.getLevel} active={rec.status === 'recording' || rec.status === 'monitoring'} />
              {rec.error && <Notice tone="amber">{rec.error}</Notice>}
              {rec.url && rec.status !== 'recording' && <audio src={rec.url} controls className="w-full" aria-label="Your recorded take" />}
            </div>
          ) : (
            <div className="space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center ${
                  dragOver ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-sunken'
                }`}
              >
                <IconUpload size={22} className="text-ink-muted" />
                <p className="mt-2 text-sm text-ink-soft">Drop an audio file here, or</p>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => fileInput.current?.click()}>
                  Choose a file
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="audio/*,.wav,.mp3,.flac,.ogg,.webm,.m4a"
                  className="sr-only"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                  aria-label="Audio file to analyse"
                />
                <p className="mt-2 text-2xs text-ink-muted">WAV, MP3, FLAC, OGG, WebM or M4A · converted to 16 kHz mono in your browser</p>
              </div>
              {file && (
                <div className="space-y-2">
                  <p className="truncate text-xs text-ink-soft">
                    <span className="font-medium text-ink">{file.name}</span> · {(file.size / 1e6).toFixed(1)} MB
                  </p>
                  {fileUrl && <audio src={fileUrl} controls className="w-full" aria-label="Selected file" />}
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" className="accent-accent" checked={bootstrap} onChange={(e) => setBootstrap(e.target.checked)} />
            Bootstrap confidence intervals for flag boundaries
          </label>

          {state.phase === 'idle' ? (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!canAnalyse}
              hint={
                !online
                  ? 'The API is offline'
                  : !take
                    ? source === 'record'
                      ? 'Record a take first'
                      : 'Choose a file first'
                    : !customReady
                      ? 'Add a transcript (3+ words) and a reference recording'
                      : undefined
              }
              onClick={analyse}
            >
              Analyse this take
            </Button>
          ) : (
            <AnalysisProgress state={state} onRetry={state.phase === 'error' ? reset : undefined} />
          )}
          <p className="text-2xs leading-relaxed text-ink-muted">
            Your recording is sent to this SHRUTI server for analysis and cached there under a content hash so the result is reproducible.
          </p>
        </section>
      </div>
    </div>
  );
}
