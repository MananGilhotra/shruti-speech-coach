/* A transcript rendered from backend-compatible tokens, with instructed words highlighted. */
import { useMemo } from 'react';
import type { StudioInstruction } from '../types';
import { tokenizeTranscript } from '../lib/tokenize';
import { flawTypeDim, dimColor } from '../lib/dimensions';

export default function ScriptText({
  transcript,
  instruction,
  className = '',
}: {
  transcript: string;
  instruction?: StudioInstruction;
  className?: string;
}) {
  const tokens = useMemo(() => tokenizeTranscript(transcript), [transcript]);
  const span = instruction?.words;
  const key = instruction?.key_word ?? null;
  const type = instruction?.type ?? '';
  const dim = flawTypeDim(type);
  const col = dim ? dimColor(dim) : '#3730a3';
  const inSpan = (i: number) => !!span && i >= span[0] && i <= span[1];

  return (
    <p className={`leading-[1.9] ${className}`}>
      {tokens.map((t, i) => {
        const hit = inSpan(i);
        const isKey = key === i;
        return (
          <span key={i}>
            {type === 'filler' && span && i === span[0] && <Marker text="uhh / umm" color={col} />}
            <span
              className={hit || isKey ? 'rounded px-0.5 font-semibold text-ink' : ''}
              style={
                hit
                  ? { backgroundColor: `${col}2e`, boxShadow: `inset 0 -2px 0 ${col}` }
                  : isKey
                    ? { boxShadow: `inset 0 -2px 0 #0f172a`, backgroundColor: '#e2e8f0' }
                    : undefined
              }
              title={hit ? 'Instructed words' : isKey ? 'Key word: keep this one flat' : undefined}
            >
              {t}
            </span>
            {type === 'long_pause' && span && i === span[1] && <Marker text="⏸ pause here" color={col} />}
            {type === 'missing_pause' && span && i === span[1] && <Marker text="→ no pause" color={col} />}{' '}
          </span>
        );
      })}
    </p>
  );
}

function Marker({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="mx-1 inline-block rounded border px-1 align-middle text-[0.65em] font-semibold leading-snug"
      style={{ borderColor: color, color: '#0f172a', backgroundColor: `${color}1f` }}
    >
      {text}
    </span>
  );
}
