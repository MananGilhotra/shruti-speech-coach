/* Transcript tokenisation that matches the backend (shruti/text/words.py): numbers are spelled out
 * the way they are spoken, dashes become separate pieces, and pieces without letters are dropped.
 * Word indices in Flaw Studio instructions refer to these tokens. */

const ONES =
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(
    ' ',
  );
const TENS = '_ _ twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const ORD: Record<string, string> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

function numWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return TENS[t] + (o ? `-${ONES[o]}` : '');
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return `${ONES[h]} hundred${r ? ` ${numWords(r)}` : ''}`;
  }
  if (n < 1_000_000) {
    const k = Math.floor(n / 1000);
    const r = n % 1000;
    return `${numWords(k)} thousand${r ? ` ${numWords(r)}` : ''}`;
  }
  const m = Math.floor(n / 1_000_000);
  const r = n % 1_000_000;
  return `${numWords(m)} million${r ? ` ${numWords(r)}` : ''}`;
}

function yearWords(n: number): string {
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return `${numWords(hi)} hundred`;
  if (lo < 10) return `${numWords(hi)} oh ${ONES[lo]}`;
  return `${numWords(hi)} ${numWords(lo)}`;
}

function ordinal(words: string): string {
  const lastWord = words.split(' ').pop() ?? words;
  const parts = lastWord.includes('-') ? words.split('-') : [words];
  const last = (parts[parts.length - 1].split(' ').pop() ?? '').trim();
  const head = words.slice(0, words.length - last.length);
  let next: string;
  if (ORD[last]) next = ORD[last];
  else if (last.endsWith('y')) next = `${last.slice(0, -1)}ieth`;
  else next = `${last}th`;
  return head + next;
}

export function expandNumbers(text: string): string {
  return text.replace(/\b(\d[\d,]*)(st|nd|rd|th)?\b/gi, (_m, numRaw: string, suf?: string) => {
    const num = numRaw.replace(/,/g, '');
    const n = parseInt(num, 10);
    const suffix = (suf ?? '').toLowerCase();
    if (['st', 'nd', 'rd', 'th'].includes(suffix)) return ordinal(numWords(n));
    const isYear = !numRaw.includes(',') && ((n >= 1100 && n <= 1999) || (n >= 2010 && n <= 2099));
    return isYear ? yearWords(n) : numWords(n);
  });
}

/** Display tokens of a transcript, indexed exactly like the backend's aligned words. */
export function tokenizeTranscript(transcript: string): string[] {
  const text = expandNumbers(transcript.replace(/’/g, "'").replace(/[—–]/g, ' - '));
  return text
    .split(/\s+/)
    .filter(Boolean)
    .filter((piece) => /[A-Za-z]/.test(piece.replace(/[^A-Za-z'-]/g, '').replace(/^[-']+|[-']+$/g, '')));
}
