/* /studio — Flaw Studio: volunteers record instructed flaws; the instruction is the label. */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StudioAssignment, StudioTake, StudioTask } from '../types';
import { errorMessage, fixtureAssignment, getAssignment, postConsent, postTake, scriptAudioUrl } from '../api';
import { useAppState } from '../lib/appState';
import { useAsync, useLocalStorage } from '../lib/useAsync';
import { useScripts } from '../lib/data';
import { useRecorder } from '../lib/useRecorder';
import { prepareUpload } from '../lib/audio';
import { flawTypeLabel } from '../lib/dimensions';
import { fmt, fmtTime } from '../lib/format';
import AudioButton, { stopSharedAudio } from '../components/AudioButton';
import LevelMeter, { type LevelVerdict } from '../components/LevelMeter';
import ScriptText from '../components/ScriptText';
import { Badge, Button, ErrorState, LoadingState, Notice } from '../components/ui';
import { IconArrowRight, IconCheck, IconMic, IconRefresh, IconStop, IconUpload } from '../components/icons';

type Step = 'consent' | 'details' | 'mic' | 'tasks' | 'done';

interface StudioStore {
  speakerId: string;
  step: Step;
  consented: boolean;
  takes: Record<string, { take_id: string; proposed?: { t_start: number; t_end: number } | null; at: number }>;
  current: string | null;
}

function newId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const r = new Uint32Array(6);
  crypto.getRandomValues(r);
  return `v-${Array.from(r, (x) => alphabet[x % alphabet.length]).join('')}`;
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'consent', label: 'Consent' },
  { key: 'details', label: 'About you' },
  { key: 'mic', label: 'Mic check' },
  { key: 'tasks', label: 'Record' },
  { key: 'done', label: 'Done' },
];

export default function Studio() {
  const [store, setStore] = useLocalStorage<StudioStore>('shruti.studio.v1', {
    speakerId: newId(),
    step: 'consent',
    consented: false,
    takes: {},
    current: null,
  });
  const set = (patch: Partial<StudioStore>) => setStore((s) => ({ ...s, ...patch }));
  const stepIdx = STEPS.findIndex((s) => s.key === store.step);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Flaw Studio</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            Help build an open dataset of <em>real</em> delivery flaws. You read short public-domain passages — once well, and a few times with
            a specific mistake we ask for. Because we told you exactly what to do and where, each recording comes with its own label.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-soft">
          <span>
            Volunteer ID <span className="font-mono font-semibold text-ink">{store.speakerId}</span>
          </span>
          <Link to="/studio/review" className="link">
            Reviewer view
          </Link>
        </div>
      </header>

      <nav aria-label="Progress">
        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                aria-current={i === stepIdx ? 'step' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                  i === stepIdx
                    ? 'border-accent bg-accent-soft text-accent'
                    : i < stepIdx
                      ? 'border-line bg-white text-ink-soft'
                      : 'border-line bg-white text-ink-faint'
                }`}
              >
                {i < stepIdx ? <IconCheck size={12} /> : <span className="font-mono">{i + 1}</span>}
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-line-strong" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </nav>

      {store.step === 'consent' && (
        <ConsentStep
          speakerId={store.speakerId}
          onNewId={() => set({ speakerId: newId() })}
          onAccept={() => set({ step: 'details', consented: true })}
        />
      )}
      {store.step === 'details' && (
        <DetailsStep speakerId={store.speakerId} onBack={() => set({ step: 'consent' })} onDone={() => set({ step: 'mic' })} />
      )}
      {store.step === 'mic' && <MicStep onBack={() => set({ step: 'details' })} onDone={() => set({ step: 'tasks' })} />}
      {store.step === 'tasks' && <TasksStep store={store} setStore={setStore} />}
      {store.step === 'done' && (
        <DoneStep
          store={store}
          onMore={() => set({ step: 'tasks' })}
          onRestart={() => setStore({ speakerId: newId(), step: 'consent', consented: false, takes: {}, current: null })}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------- consent
function ConsentStep({ speakerId, onNewId, onAccept }: { speakerId: string; onNewId: () => void; onAccept: () => void }) {
  const [agree, setAgree] = useState(false);
  const [adult, setAdult] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const ok = agree && adult && withdraw;
  return (
    <section className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-6">
      <div className="rounded-lg border border-line bg-white p-6">
        <h2 className="text-base font-semibold text-ink">Before you start — in plain language</h2>
        <dl className="mt-4 space-y-4 text-sm leading-relaxed text-ink-soft">
          <div>
            <dt className="font-semibold text-ink">What you’ll record</dt>
            <dd>
              About eight short readings (30–60 seconds each) of passages from public-domain US presidential speeches. One is your best
              delivery; the others include a mistake we describe on screen, such as rushing a few words or saying “umm”.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">How it will be used</dt>
            <dd>
              To train and test SHRUTI’s flaw detector. The recordings, your on-screen instructions and the optional details you give will be
              released publicly as an open dataset under the <strong>Creative Commons Attribution 4.0 (CC BY 4.0)</strong> licence. Anyone
              may reuse them, including commercially, with attribution to the dataset.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Your identity</dt>
            <dd>
              Recordings are stored under a pseudonymous ID — yours is <span className="font-mono font-semibold text-ink">{speakerId}</span>{' '}
              (
              <button type="button" onClick={onNewId} className="link">
                make a new one
              </button>
              ). We never ask for your name or email. Note that a voice is personal data: people who know you might recognise it.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Your choices</dt>
            <dd>
              Taking part is voluntary and unpaid. You can stop at any time. You can withdraw your recordings until{' '}
              <strong>12 October 2026</strong> by sending us your ID; after the dataset is published, copies already downloaded by others
              cannot be recalled.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Who can take part</dt>
            <dd>Adults aged 18 or over.</dd>
          </div>
        </dl>
      </div>
      <div className="space-y-4 self-start rounded-lg border border-line bg-white p-6">
        <h2 className="text-base font-semibold text-ink">Your consent</h2>
        <fieldset className="space-y-3">
          <legend className="sr-only">Required confirmations</legend>
          <Check checked={agree} onChange={setAgree}>
            I agree that my recordings are released as an open dataset under <strong>CC BY 4.0</strong>, under the pseudonymous ID{' '}
            <span className="font-mono">{speakerId}</span>.
          </Check>
          <Check checked={adult} onChange={setAdult}>
            I am <strong>18 or older</strong>.
          </Check>
          <Check checked={withdraw} onChange={setWithdraw}>
            I understand I can withdraw until <strong>12 October 2026</strong> by quoting my ID.
          </Check>
        </fieldset>
        <p className="text-xs text-ink-muted">Write your ID down now — it’s the only way to find your recordings later.</p>
        <Button variant="primary" className="w-full" disabled={!ok} hint={ok ? undefined : 'Tick all three boxes to continue'} onClick={onAccept}>
          I agree — continue <IconArrowRight size={14} />
        </Button>
      </div>
    </section>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-soft">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-accent" required />
      <span>{children}</span>
    </label>
  );
}

// ----------------------------------------------------------------------------- details
const AGE_BANDS = ['18–24', '25–34', '35–44', '45–54', '55–64', '65+', 'Prefer not to say'];
const GENDERS = ['Woman', 'Man', 'Non-binary', 'Self-describe', 'Prefer not to say'];
const DEVICES = ['Laptop built-in mic', 'Headset', 'Phone', 'External USB mic', 'Other'];

function DetailsStep({ speakerId, onBack, onDone }: { speakerId: string; onBack: () => void; onDone: () => void }) {
  const { online } = useAppState();
  const [f, setF] = useState({ first_language: '', accent_region: '', gender: '', device: '', age_band: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Partial<typeof f>;
      await postConsent({ speaker_id: speakerId, accepted: true, age_ok: true, ...body });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const field = (k: keyof typeof f, label: string, options?: string[]) => (
    <div>
      <label htmlFor={`d-${k}`} className="field-label">
        {label}
      </label>
      {options ? (
        <select id={`d-${k}`} className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input id={`d-${k}`} className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      )}
    </div>
  );

  return (
    <section className="max-w-3xl rounded-lg border border-line bg-white p-6">
      <h2 className="text-base font-semibold text-ink">About you (optional)</h2>
      <p className="mt-1 text-sm text-ink-soft">
        These help us check that SHRUTI works equally well for different voices and accents. Every field is optional and is released with
        the dataset.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-4">
        {field('first_language', 'First language')}
        {field('accent_region', 'Accent / region (e.g. North Indian English)')}
        {field('gender', 'Gender', GENDERS)}
        {field('age_band', 'Age band', AGE_BANDS)}
        {field('device', 'Microphone', DEVICES)}
      </div>
      {!online && <Notice className="mt-4">The API is offline, so consent can’t be recorded yet. Retry when the server is reachable.</Notice>}
      {error && <Notice className="mt-4">Could not save consent: {error}</Notice>}
      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!online} hint={online ? undefined : 'Needs the SHRUTI API'}>
          Save and continue <IconArrowRight size={14} />
        </Button>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- mic check
function MicStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const rec = useRecorder();
  const [verdict, setVerdict] = useState<LevelVerdict>('none');
  const [sawGood, setSawGood] = useState(false);
  useEffect(() => {
    if (verdict === 'good') setSawGood(true);
  }, [verdict]);
  useEffect(() => () => rec.close(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = rec.status === 'monitoring' || rec.status === 'recording';
  return (
    <section className="max-w-2xl rounded-lg border border-line bg-white p-6">
      <h2 className="text-base font-semibold text-ink">Microphone check</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Sit somewhere quiet. Turn the microphone on and read the first line of any passage at your normal speaking volume. Aim for a steady
        bar in the middle, never touching the right edge.
      </p>
      <div className="mt-5 space-y-3">
        {!open ? (
          <Button variant="primary" onClick={() => void rec.openMic()} loading={rec.status === 'requesting'}>
            <IconMic size={15} /> Turn on microphone
          </Button>
        ) : (
          <LevelMeter getLevel={rec.getLevel} active={open} onVerdict={setVerdict} />
        )}
        {rec.error && <Notice>{rec.error}</Notice>}
        {open && verdict === 'quiet' && (
          <p className="text-xs text-ink-muted">Still quiet? Check the input device in your system sound settings, or move closer.</p>
        )}
      </div>
      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <div className="flex items-center gap-2">
          {!sawGood && open && (
            <Button variant="ghost" onClick={onDone}>
              Skip
            </Button>
          )}
          <Button variant="primary" onClick={onDone} disabled={!sawGood} hint={sawGood ? undefined : 'Speak until the meter says “Good level”'}>
            Sounds good — continue <IconArrowRight size={14} />
          </Button>
        </div>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- tasks
function TasksStep({ store, setStore }: { store: StudioStore; setStore: (f: (s: StudioStore) => StudioStore) => void }) {
  const { online, status } = useAppState();
  const { scripts } = useScripts();
  const { data, error, loading, reload } = useAsync<{ a: StudioAssignment; offline: boolean } | null>(async () => {
    if (status === 'checking') return null;
    if (!online) return { a: fixtureAssignment, offline: true };
    return { a: await getAssignment(store.speakerId), offline: false };
  }, [store.speakerId, online, status]);

  if (loading || !data) return <LoadingState label="Fetching your assignment…" />;
  if (error) return <ErrorState title="Could not load your tasks" message={errorMessage(error)} onRetry={reload} />;
  const tasks = data.a.tasks;
  const currentId = store.current && tasks.some((t) => t.task_id === store.current) ? store.current : (tasks.find((t) => !store.takes[t.task_id])?.task_id ?? tasks[0]?.task_id);
  const task = tasks.find((t) => t.task_id === currentId);
  const nDone = tasks.filter((t) => store.takes[t.task_id]).length;
  const nextUndone = (after: string) => {
    const i = tasks.findIndex((t) => t.task_id === after);
    return [...tasks.slice(i + 1), ...tasks.slice(0, i)].find((t) => !store.takes[t.task_id] && t.task_id !== after)?.task_id ?? null;
  };

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] items-start gap-5">
      <aside className="rounded-lg border border-line bg-white" aria-label="Your tasks">
        <div className="border-b border-line px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            Your tasks <span className="font-normal text-ink-muted num">· {nDone}/{tasks.length} uploaded</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(nDone / Math.max(1, tasks.length)) * 100}%` }} />
          </div>
        </div>
        <ul className="p-2">
          {tasks.map((t) => {
            const done = !!store.takes[t.task_id];
            const active = t.task_id === currentId;
            return (
              <li key={t.task_id}>
                <button
                  type="button"
                  onClick={() => setStore((s) => ({ ...s, current: t.task_id }))}
                  aria-current={active ? 'true' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring ${
                    active ? 'bg-accent-soft' : 'hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-2xs ${
                      done ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-line-strong text-ink-muted'
                    }`}
                    aria-hidden="true"
                  >
                    {done ? <IconCheck size={11} strokeWidth={3} /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate font-medium ${active ? 'text-accent' : 'text-ink'}`}>
                      {t.kind === 'good' ? 'Best delivery' : flawTypeLabel(t.instruction.type ?? 'flaw')}
                    </span>
                    <span className="block text-2xs text-ink-muted">
                      {t.script_id}
                      {t.instruction.severity ? ` · ${t.instruction.severity}` : ''}
                      {done ? ' · uploaded' : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {nDone === tasks.length && tasks.length > 0 && (
          <div className="border-t border-line p-3">
            <Button variant="primary" className="w-full" onClick={() => setStore((s) => ({ ...s, step: 'done' }))}>
              Finish
            </Button>
          </div>
        )}
      </aside>

      {task ? (
        <TaskPanel
          key={task.task_id}
          task={task}
          scriptTitle={scripts.find((s) => s.script_id === task.script_id)?.title ?? task.script_id}
          transcript={scripts.find((s) => s.script_id === task.script_id)?.transcript ?? ''}
          speakerId={store.speakerId}
          offline={data.offline}
          uploaded={store.takes[task.task_id]}
          onUploaded={(take) =>
            setStore((s) => ({
              ...s,
              takes: { ...s.takes, [task.task_id]: { take_id: take.take_id, proposed: take.proposed_label ?? null, at: Date.now() } },
            }))
          }
          onNext={() => {
            const n = nextUndone(task.task_id);
            setStore((s) => (n ? { ...s, current: n } : { ...s, step: 'done' }));
          }}
        />
      ) : (
        <Notice tone="neutral">No tasks in this assignment.</Notice>
      )}
    </div>
  );
}

function TaskPanel({
  task,
  scriptTitle,
  transcript,
  speakerId,
  offline,
  uploaded,
  onUploaded,
  onNext,
}: {
  task: StudioTask;
  scriptTitle: string;
  transcript: string;
  speakerId: string;
  offline: boolean;
  uploaded: StudioStore['takes'][string] | undefined;
  onUploaded: (t: StudioTake) => void;
  onNext: () => void;
}) {
  const rec = useRecorder(150);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudioTake | null>(null);
  const ins = task.instruction;

  const upload = async () => {
    if (!rec.blob) return;
    setError(null);
    setProgress(0);
    try {
      const up = await prepareUpload(rec.blob, task.task_id);
      const take = await postTake(
        up.blob,
        up.filename,
        { speaker_id: speakerId, task_id: task.task_id, script_id: task.script_id, kind: task.kind, instruction: ins },
        (f) => setProgress(f),
      );
      setResult(take);
      onUploaded(take);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  const proposed = result?.proposed_label ?? uploaded?.proposed ?? null;
  const done = !!(result || uploaded);
  const words = useMemo(() => ins.words, [ins.words]);

  return (
    <section className="space-y-4 rounded-lg border border-line bg-white p-5" aria-label="Current task">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="accent">{task.script_id}</Badge>
            {task.kind === 'good' ? (
              <Badge tone="green">Best delivery</Badge>
            ) : (
              <Badge tone="amber">
                Instructed flaw · {flawTypeLabel(ins.type ?? '')}
                {ins.severity ? ` · ${ins.severity}` : ''}
              </Badge>
            )}
          </div>
          <h2 className="mt-1.5 text-base font-semibold text-ink">{scriptTitle}</h2>
        </div>
        <AudioButton url={scriptAudioUrl(task.script_id)} />
      </div>

      <div className={`rounded-lg border-l-4 px-4 py-3 ${task.kind === 'good' ? 'border-emerald-600 bg-emerald-50' : 'border-amber-600 bg-amber-50'}`}>
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">Instruction</p>
        <p className="mt-0.5 text-[15px] font-medium text-ink">{ins.text}</p>
        {words && (
          <p className="mt-1 text-xs text-ink-soft">
            Highlighted: word{words[0] === words[1] ? '' : 's'} {words[0] + 1}
            {words[0] === words[1] ? '' : `–${words[1] + 1}`} of the passage.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-line bg-surface-sunken px-5 py-4">
        {transcript ? (
          <ScriptText transcript={transcript} instruction={task.kind === 'good' ? undefined : ins} className="text-xl text-ink-soft" />
        ) : (
          <p className="text-sm text-ink-muted">Transcript unavailable.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {rec.status === 'recording' ? (
          <Button variant="danger" size="lg" onClick={() => void rec.stop()}>
            <IconStop size={15} /> Stop · {fmtTime(rec.elapsed, 1)}
          </Button>
        ) : (
          <Button
            variant={rec.blob ? 'secondary' : 'primary'}
            size="lg"
            onClick={() => {
              stopSharedAudio();
              setResult(null);
              void rec.start();
            }}
            disabled={progress != null}
          >
            {rec.blob ? <IconRefresh size={15} /> : <IconMic size={16} />} {rec.blob ? 'Re-record' : 'Record'}
          </Button>
        )}
        <div className="w-56">
          <LevelMeter getLevel={rec.getLevel} active={rec.status === 'recording'} />
        </div>
        {rec.url && rec.status !== 'recording' && <audio src={rec.url} controls className="h-10" aria-label="Preview your take" />}
      </div>
      {rec.error && <Notice>{rec.error}</Notice>}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button
          variant="primary"
          onClick={() => void upload()}
          disabled={!rec.blob || rec.status === 'recording' || progress != null || offline}
          hint={offline ? 'Uploading needs the SHRUTI API' : !rec.blob ? 'Record a take first' : undefined}
          loading={progress != null}
        >
          <IconUpload size={14} /> {result ? 'Upload again' : 'Upload take'}
        </Button>
        {progress != null && (
          <div className="flex w-48 items-center gap-2" aria-live="polite">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="font-mono text-2xs text-ink-muted">{progress >= 1 ? 'aligning…' : `${Math.round(progress * 100)}%`}</span>
          </div>
        )}
        {done && progress == null && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-800" aria-live="polite">
            <IconCheck size={15} /> Uploaded
            {proposed && (
              <span className="text-ink-soft">
                {' '}
                · proposed label <span className="font-mono">{fmt(proposed.t_start)}–{fmt(proposed.t_end)} s</span>
              </span>
            )}
          </span>
        )}
        {done && (
          <Button variant="secondary" className="ml-auto" onClick={onNext}>
            Next task <IconArrowRight size={14} />
          </Button>
        )}
      </div>
      {error && <Notice>Upload failed: {error}</Notice>}
      {offline && <Notice tone="neutral">Offline demo: you can rehearse and record, but uploads need the SHRUTI API.</Notice>}
    </section>
  );
}

// ----------------------------------------------------------------------------- done
function DoneStep({ store, onMore, onRestart }: { store: StudioStore; onMore: () => void; onRestart: () => void }) {
  const n = Object.keys(store.takes).length;
  return (
    <section className="max-w-2xl rounded-lg border border-line bg-white p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-700 text-white" aria-hidden="true">
          <IconCheck size={20} strokeWidth={3} />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-ink">Thank you!</h2>
          <p className="text-sm text-ink-soft">
            {n} take{n === 1 ? '' : 's'} uploaded under <span className="font-mono font-semibold text-ink">{store.speakerId}</span>.
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-ink-soft">
        A reviewer will listen to each take and confirm the instructed flaw is really there before it enters the dataset. Keep your ID if you
        might want to withdraw (until 12 October 2026).
      </p>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" onClick={onMore}>
          Back to tasks
        </Button>
        <Button variant="ghost" onClick={onRestart}>
          Start as a new volunteer
        </Button>
      </div>
    </section>
  );
}
