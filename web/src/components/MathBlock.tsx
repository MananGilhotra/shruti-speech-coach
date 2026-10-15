import { useMemo } from 'react';
import katex from 'katex';

/** Render one LaTeX string in display mode (errors are shown inline, never thrown). */
export default function MathBlock({ tex }: { tex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: true, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
    } catch {
      return null;
    }
  }, [tex]);
  if (!html) return <code className="block font-mono text-xs text-ink-soft">{tex}</code>;
  return <div className="text-[13px] text-ink" dangerouslySetInnerHTML={{ __html: html }} />;
}
