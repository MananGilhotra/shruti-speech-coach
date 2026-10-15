import { dimColor } from '../lib/dimensions';

/** Five pips, filled up to the severity (1–5); the count is also given as text for screen readers. */
export default function SeverityPips({ severity, dimension }: { severity: number; dimension: string }) {
  const s = Math.max(0, Math.min(5, Math.round(severity)));
  const col = dimColor(dimension);
  return (
    <span className="inline-flex items-center gap-[3px]" title={`Severity ${s} of 5`}>
      <span className="sr-only">Severity {s} of 5</span>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="h-2.5 w-1.5 rounded-[2px] border"
          style={{ backgroundColor: i <= s ? col : 'transparent', borderColor: i <= s ? col : '#cbd5e1' }}
        />
      ))}
    </span>
  );
}
