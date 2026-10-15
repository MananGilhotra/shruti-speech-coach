import { Link } from 'react-router-dom';
import type { ScriptInfo } from '../types';
import { scriptAudioUrl } from '../api';
import { fmt } from '../lib/format';
import AudioButton from './AudioButton';
import { Badge } from './ui';
import { IconArrowRight } from './icons';

export default function ScriptCard({ script, selected = false, to }: { script: ScriptInfo; selected?: boolean; to: string }) {
  return (
    <article
      className={`flex flex-col rounded-lg border bg-white p-4 transition-colors ${
        selected ? 'border-accent ring-1 ring-accent/30' : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge tone="accent">{script.script_id}</Badge>
          <Badge tone={script.split === 'test' ? 'amber' : 'neutral'} title="Benchmark split: test scripts are never used for tuning">
            {script.split}
          </Badge>
        </div>
        <span className="font-mono text-2xs text-ink-muted num">{script.duration_s ? `${fmt(script.duration_s, 0)} s` : ''}</span>
      </div>
      <h3 className="mt-2 text-sm font-semibold leading-snug text-ink">{script.title}</h3>
      <p className="text-xs text-ink-muted">
        {script.speaker} · {script.year}
      </p>
      <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-ink-soft">{script.transcript}</p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <AudioButton url={scriptAudioUrl(script.script_id)} size="xs" variant="ghost" />
        <Link
          to={to}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          Record or upload <IconArrowRight size={13} />
        </Link>
      </div>
    </article>
  );
}
