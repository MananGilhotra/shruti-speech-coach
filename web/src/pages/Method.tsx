/* /method — how SHRUTI works, its limits, data licences and AI-use disclosure. */
import { Link } from 'react-router-dom';
import MathBlock from '../components/MathBlock';
import { sampleAnalysis } from '../api';

const STEPS: { t: string; d: string }[] = [
  {
    t: 'Forced alignment',
    d: 'The script is tokenised (numbers spelled out as spoken) and aligned to the audio with a wav2vec2 CTC model, giving every word a start and end time. An ASR pass checks the speaker actually read the script (word error rate).',
  },
  {
    t: 'Features',
    d: 'At 20 ms resolution: pitch (semitones relative to the speaker’s median, so voices of any range compare), intensity relative to the speaker’s typical level, cepstral peak prominence (voice clarity). Per word: duration, syllable rate, pause after, median pitch and loudness, prominence.',
  },
  {
    t: 'Population baseline',
    d: 'Reference deliveries of the same script are aligned the same way. For every word and feature SHRUTI keeps a location (the median over reference takes, after removing each reference speaker’s global offset in pitch, loudness and tempo) and a spread shrunk toward a prior spread by empirical Bayes, as in limma. With a single reference the spread is the prior; with ~30 good takes the data dominate.',
  },
  {
    t: 'Window tests',
    d: 'Every hypothesis is a test: a word window (or gap) in one family — tempo, pause, monotone, level, fluency, clarity, emphasis — whose deviation from the baseline gets a z-score and a p-value from a Student-t reference distribution (df = ν₀ + n − 1). A rejected test must also pass a practical floor in physical units.',
  },
  {
    t: 'False-discovery control',
    d: 'Hundreds of tests per take means some would “fire” by chance. Benjamini–Hochberg keeps the expected share of false flags at q = 5%: only tests with q ≤ 0.05 survive.',
  },
  {
    t: 'Regions with bootstrap CIs',
    d: 'Surviving tests of the same flaw type merge into regions. Each bootstrap replicate jitters every word boundary by Gaussian alignment noise (and resamples the references when there are three or more) and re-runs detection: the confidence is the share of replicates that find the region again, and the 95% interval of its start and end is the 2.5–97.5 percentile of their edges.',
  },
  {
    t: 'Flaw cards',
    d: 'Each region becomes a card: the words, the time range, the evidence (yours vs expected), the statistics and the exact arithmetic of the decision, with a plain-language fix.',
  },
  {
    t: 'Rubric',
    d: 'Seven dimensions start at 10 and lose points per flaw, weighted by severity and normalised by speaking time; a style penalty applies when the whole take is far outside the reference (tempo or pitch range).',
  },
  {
    t: 'Ghost Coach',
    d: 'The flagged region of your own recording is re-synthesised with only that feature corrected (duration, pause, pitch, loudness, brightness, or cutting a filler) — then re-analysed. If the flag disappears, that fix alone is a sufficient counterfactual explanation.',
  },
];

export default function Method() {
  return (
    <article className="mx-auto max-w-4xl space-y-10">
      <header>
        <h1 className="text-3xl font-semibold text-ink">How SHRUTI works</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          SHRUTI (Sanskrit <em>śruti</em>, “that which is heard”) is <strong>contrastive</strong>: it does not judge a voice against an abstract
          ideal, but against how the same words were delivered by a reference speaker. Every claim it makes is grounded in time, comes with
          the evidence, and survives a false-discovery-controlled statistical test.
        </p>
      </header>

      <section aria-labelledby="pipeline">
        <h2 id="pipeline" className="text-lg font-semibold text-ink">
          The pipeline
        </h2>
        <ol className="mt-4 space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.t} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3 rounded-lg border border-line bg-white px-4 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent">
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">{s.t}</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="maths" className="rounded-lg border border-line bg-white p-5">
        <h2 id="maths" className="text-lg font-semibold text-ink">
          The decision rule, in one card
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          From the bundled sample (“{sampleAnalysis.cards[0]?.title ?? 'flaw'}”). Every card on the analysis screen shows its own version of
          this derivation.
        </p>
        <div className="mt-3 rounded-md bg-surface-sunken px-4 py-2">
          {(sampleAnalysis.cards[0]?.math ?? []).map((m, i) => (
            <MathBlock key={i} tex={m} />
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-soft">Spreads are shrunk toward a prior (empirical Bayes), so a single reference still gives calibrated tests:</p>
        <div className="mt-1 rounded-md bg-surface-sunken px-4 py-2">
          <MathBlock tex={'\\tilde s^{2} = \\frac{\\nu_0 s_0^{2} + (n-1)\\,s^{2}}{\\nu_0 + n - 1}, \\qquad \\mathrm{df} = \\nu_0 + n - 1'} />
        </div>
        <p className="mt-3 font-mono text-2xs text-ink-muted">rubric: {sampleAnalysis.rubric.formula}</p>
      </section>

      <section aria-labelledby="limits">
        <h2 id="limits" className="text-lg font-semibold text-ink">
          Honest limitations
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
          <li>
            <strong className="text-ink">The reference is a style, not the truth.</strong> “Flaw” means “unusually different from the reference
            delivery here”. A deliberate, effective choice that differs from the original orator can be flagged.
          </li>
          <li>
            <strong className="text-ink">Few references.</strong> Most scripts have a single reference recording; spreads then come from pooled
            priors, which makes the tests less specific to each word than a true population would.
          </li>
          <li>
            <strong className="text-ink">Synthetic training ground truth.</strong> SHRUTI-Bench flaws are injected by signal processing. They
            are exact but not always natural; the Flaw Studio and the adjudicator study exist to measure the gap with real human flaws and
            judges.
          </li>
          <li>
            <strong className="text-ink">Alignment errors propagate.</strong> If the speaker departs from the script, or the recording is
            noisy, word timings can be wrong and so can every feature built on them. The ASR check warns when the reading differs a lot.
          </li>
          <li>
            <strong className="text-ink">English, read speech, one speaker.</strong> The current models and scripts cover read American-English
            oratory; accents, spontaneous speech and other languages are untested.
          </li>
          <li>
            <strong className="text-ink">Not an assessment of a person.</strong> Scores describe one recording against one reference. They should
            support practice, not grade people.
          </li>
        </ul>
      </section>

      <section aria-labelledby="data" className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-line bg-white p-5">
          <h2 id="data" className="text-base font-semibold text-ink">
            Data &amp; licences
          </h2>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-soft">
            <li>
              Reference recordings are US federal government works in the public domain (17 U.S.C. §105); sourced from Wikimedia Commons.
            </li>
            <li>SHRUTI-Bench renders are derived from those recordings and released with their recipes so they can be regenerated exactly.</li>
            <li>
              Flaw Studio recordings are contributed with explicit consent and released under CC BY 4.0 with pseudonymous IDs (see{' '}
              <Link to="/studio" className="link">
                Flaw Studio
              </Link>
              ).
            </li>
            <li>Uploaded takes are stored on the analysis server under a content hash so every result can be reproduced from its fingerprint.</li>
          </ul>
        </div>
        <div className="rounded-lg border border-line bg-white p-5">
          <h2 className="text-base font-semibold text-ink">AI-use disclosure</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            [Placeholder — to be completed by the team before submission.] Describe which parts of the code, documentation and dashboard were
            written with AI assistance, which models were used, and how the output was reviewed and tested. Pretrained models used at run time:
            wav2vec2-base-960h (forced alignment and ASR check).
          </p>
        </div>
      </section>
    </article>
  );
}
