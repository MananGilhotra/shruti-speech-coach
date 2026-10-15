/* / — Home & Judge Mode. */
import { Link } from 'react-router-dom';
import { getDemos, sampleAnalysis } from '../api';
import type { Demo } from '../types';
import { useAppState } from '../lib/appState';
import { useAsync } from '../lib/useAsync';
import { useScripts } from '../lib/data';
import { dimLabel } from '../lib/dimensions';
import { fmt } from '../lib/format';
import ScriptCard from '../components/ScriptCard';
import { Badge, Spinner } from '../components/ui';
import { IconArrowRight, IconBook, IconFlask, IconGauge, IconMic, IconSliders, IconUsers, IconWand } from '../components/icons';

function DemoCard({ demo, sample }: { demo: Demo; sample?: boolean }) {
  return (
    <Link
      to={`/analysis/${sample ? 'sample' : demo.analysis_id}`}
      className="group flex flex-col rounded-lg border border-line bg-white p-4 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
    >
      <div className="flex items-center gap-1.5">
        {demo.script_id && <Badge tone="accent">{demo.script_id}</Badge>}
        {sample && <Badge tone="neutral">Bundled sample</Badge>}
      </div>
      <h3 className="mt-2 text-sm font-semibold text-ink">{demo.title}</h3>
      {demo.description && <p className="mt-1 text-xs leading-relaxed text-ink-soft">{demo.description}</p>}
      {(demo.n_flags != null || demo.overall != null) && (
        <p className="mt-2 font-mono text-2xs text-ink-muted">
          {demo.n_flags != null && `${demo.n_flags} flag${demo.n_flags === 1 ? '' : 's'}`}
          {demo.n_injected != null && ` · ${demo.n_injected} injected`}
          {demo.overall != null && ` · overall ${fmt(demo.overall, 1)}/10`}
        </p>
      )}
      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold text-accent">
        Open analysis <IconArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export default function Home() {
  const { status, online } = useAppState();
  const { scripts } = useScripts();
  const demos = useAsync(async () => (online ? getDemos() : ([] as Demo[])), [online]);
  const s = sampleAnalysis;
  const sampleDemo: Demo = {
    id: 'sample',
    title: `${s.script.speaker} — ${s.script.title.replace(/^.*?—\s*/, '')}`,
    description: `A reading of the 1961 inaugural excerpt with an injected flaw. ${s.cards.length} flag at FDR ${s.tests.fdr_q} out of ${s.tests.n_tests} tests (${s.cards
      .map((c) => `${c.title.toLowerCase()}, ${dimLabel(c.dimension).toLowerCase()}`)
      .join('; ')}). Overall ${fmt(s.rubric.overall, 1)}/10.`,
    analysis_id: s.analysis_id,
    script_id: s.script.script_id ?? undefined,
  };
  const demoList = demos.data && demos.data.length > 0 ? demos.data : null;
  const firstDemoHref = demoList ? `/analysis/${demoList[0].analysis_id}` : '/analysis/sample';

  return (
    <div className="space-y-14">
      {/* hero */}
      <section className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-center gap-10 pt-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Contrastive speech analytics</p>
          <h1 className="mt-3 text-5xl font-bold tracking-tight text-ink">SHRUTI</h1>
          <p className="mt-4 text-2xl font-medium leading-snug text-ink">
            Hear exactly where your delivery broke — and hear yourself fix it.
          </p>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
            Read a famous passage aloud. SHRUTI aligns every word, compares your pitch, loudness, pace and pauses with the original orator, runs
            hundreds of statistical tests with false-discovery control, and pins each flaw to the exact words and milliseconds — with the
            evidence, the maths, and a re-synthesised “ghost” of your own voice with that one flaw corrected.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              to={firstDemoHref}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-base font-medium text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2"
            >
              <IconGauge size={18} /> Judge Mode: open a demo
            </Link>
            <Link
              to="/analyse"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong bg-white px-5 text-base font-medium text-ink hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring focus-visible:ring-offset-2"
            >
              <IconMic size={18} /> Analyse your delivery
            </Link>
          </div>
        </div>
        <ol className="space-y-3" aria-label="What happens to a recording">
          {[
            ['Align', 'Forced alignment puts every word of the script on the clock (wav2vec2 CTC).'],
            ['Measure', 'Pitch, loudness, rate, pauses, voice clarity and emphasis per word, 20 ms resolution.'],
            ['Test', 'Hundreds of window tests against the reference, Benjamini–Hochberg FDR at 5%.'],
            ['Explain', 'Flaw cards with time ranges, bootstrap CIs, evidence tables and the maths.'],
            ['Coach', 'Ghost Coach: your own voice with only that flaw fixed — and whether that fix alone clears the flag.'],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-lg border border-line bg-white px-4 py-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">{t}</p>
                <p className="text-xs leading-relaxed text-ink-soft">{d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* judge mode */}
      <section aria-labelledby="judge-mode">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 id="judge-mode" className="text-lg font-semibold text-ink">
              Judge Mode
            </h2>
            <p className="text-sm text-ink-soft">
              One click to a fully computed analysis. Try: click a flaw card → press <kbd className="font-mono">G</kbd> to hear the ghost → open
              “the maths”.
            </p>
          </div>
          {(demos.loading || status === 'checking') && (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Spinner size={12} /> Loading demos…
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {demoList ? demoList.map((d) => <DemoCard key={d.id} demo={d} />) : <DemoCard demo={sampleDemo} sample />}
          {!demoList && !demos.loading && status !== 'checking' && (
            <div className="col-span-2 flex items-center rounded-lg border border-dashed border-line-strong bg-white/60 px-5 py-4 text-sm text-ink-soft">
              {online
                ? 'No pre-computed demos are installed on this server yet, so Judge Mode opens the bundled sample analysis. Record or upload a delivery below to create a new one.'
                : 'The API is offline, so Judge Mode shows the bundled sample analysis. Every panel is browsable; audio, Ghost Coach and drills need the API.'}
            </div>
          )}
        </div>
      </section>

      {/* analyse */}
      <section aria-labelledby="analyse">
        <div className="mb-3">
          <h2 id="analyse" className="text-lg font-semibold text-ink">
            Analyse a delivery
          </h2>
          <p className="text-sm text-ink-soft">
            Pick a passage, listen to the original, then record yourself in the browser or upload a file. Public-domain speeches by US presidents.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {scripts.map((sc) => (
            <ScriptCard key={sc.script_id} script={sc} to={`/analyse/${sc.script_id}`} />
          ))}
        </div>
      </section>

      {/* explore */}
      <section aria-labelledby="explore">
        <h2 id="explore" className="mb-3 text-lg font-semibold text-ink">
          Behind the scores
        </h2>
        <div className="grid grid-cols-5 gap-4">
          {[
            { to: '/explore', icon: <IconSliders size={18} />, t: 'Benchmark Explorer', d: 'Slide a flaw from level 0 to 10 and analyse any render.' },
            { to: '/evaluation', icon: <IconFlask size={18} />, t: 'Evaluation', d: 'Precision, recall, boundary error, psychometric curves, false flags.' },
            { to: '/studio', icon: <IconWand size={18} />, t: 'Flaw Studio', d: 'Volunteer: record instructed flaws to build a labelled human set.' },
            { to: '/study', icon: <IconUsers size={18} />, t: 'Adjudicator study', d: 'Rate clips blind so SHRUTI can be compared with human judges.' },
            { to: '/method', icon: <IconBook size={18} />, t: 'Method', d: 'The pipeline, the statistics, limitations, licences.' },
          ].map((x) => (
            <Link
              key={x.to}
              to={x.to}
              className="group rounded-lg border border-line bg-white p-4 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              <span className="text-accent">{x.icon}</span>
              <p className="mt-2 text-sm font-semibold text-ink">{x.t}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{x.d}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
