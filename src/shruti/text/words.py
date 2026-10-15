"""Transcript tokenisation, spoken-form normalisation and syllable counting."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache

FUNCTION_WORDS = frozenset(
    """a an the and or but nor so yet for of to in on at by with from into onto upon over under
    as than that this these those there here is am are was were be been being do does did have has had
    i me my we us our you your he him his she her it its they them their who whom whose which what
    not no will would shall should can could may might must if then when while where because although
    though all any some each every such own same other only just also very too more most""".split()
)

_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen " \
        "sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
_ORD = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
        "nine": "ninth", "twelve": "twelfth"}


def _num_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        t, o = divmod(n, 10)
        return _TENS[t] + ("-" + _ONES[o] if o else "")
    if n < 1000:
        h, r = divmod(n, 100)
        return _ONES[h] + " hundred" + (" " + _num_words(r) if r else "")
    if n < 1_000_000:
        k, r = divmod(n, 1000)
        return _num_words(k) + " thousand" + (" " + _num_words(r) if r else "")
    m, r = divmod(n, 1_000_000)
    return _num_words(m) + " million" + (" " + _num_words(r) if r else "")


def _year_words(n: int) -> str:
    hi, lo = divmod(n, 100)
    if lo == 0:
        return _num_words(hi) + " hundred"
    if lo < 10:
        return _num_words(hi) + " oh " + _ONES[lo]
    return _num_words(hi) + " " + _num_words(lo)


def _ordinal(words: str) -> str:
    parts = words.split("-") if "-" in words.split()[-1] else [words]
    last = parts[-1].split()[-1]
    head = words[: len(words) - len(last)]
    if last in _ORD:
        new = _ORD[last]
    elif last.endswith("y"):
        new = last[:-1] + "ieth"
    else:
        new = last + "th"
    return head + new


def expand_numbers(text: str) -> str:
    """Spell out digits the way they are usually spoken (years, ordinals, cardinals)."""
    def repl(m: re.Match) -> str:
        num, suffix = m.group(1).replace(",", ""), (m.group(2) or "").lower()
        n = int(num)
        if suffix in ("st", "nd", "rd", "th"):
            return _ordinal(_num_words(n))
        is_year = "," not in m.group(1) and (1100 <= n <= 1999 or 2010 <= n <= 2099)
        if is_year:
            return _year_words(n)
        return _num_words(n)
    return re.sub(r"\b(\d[\d,]*)(st|nd|rd|th)?\b", repl, text)


@dataclass
class Token:
    """One display word of the transcript."""
    index: int
    display: str            # as written, punctuation kept ("Americans:")
    norm: str               # letters/apostrophes, lower case ("americans")
    chars: str              # CTC target, upper case, '|' between sub-words ("FORTY|ONE")
    n_syl: int
    is_function: bool
    sentence_end: bool      # display word ends a sentence or clause (. ! ? ; :)
    clause_end: bool        # ends with , or dash
    meta: dict = field(default_factory=dict)


@lru_cache(maxsize=1)
def _cmu() -> dict:
    try:
        import cmudict
        return cmudict.dict()
    except Exception:  # pragma: no cover - fallback when the package data is missing
        return {}


def count_syllables(word: str) -> int:
    w = re.sub(r"[^a-z']", "", word.lower())
    if not w:
        return 0
    prons = _cmu().get(w)
    if prons:
        return max(1, sum(ch[-1].isdigit() for ch in prons[0]))
    # heuristic fallback: vowel groups, silent final e
    groups = re.findall(r"[aeiouy]+", w)
    n = len(groups)
    if w.endswith("e") and not w.endswith(("le", "ee")) and n > 1:
        n -= 1
    return max(1, n)


ABBREVIATIONS = {"mr": "mister", "mrs": "missus", "dr": "doctor", "st": "saint", "ms": "miz", "vs": "versus"}


def tokenize(transcript: str) -> list[Token]:
    """Split a transcript into display tokens with CTC targets and syllable counts."""
    text = expand_numbers(transcript.replace("’", "'").replace("—", " - ").replace("–", " - "))
    raw = text.split()
    tokens: list[Token] = []
    for piece in raw:
        letters = re.sub(r"[^A-Za-z'\-]", "", piece).strip("-'")
        is_abbrev = letters.lower() in ABBREVIATIONS and piece.rstrip(",;:!?").endswith(".")
        if is_abbrev:  # "Mr." is displayed as written but aligned as the spoken word
            letters = ABBREVIATIONS[letters.lower()]
        if not letters:
            # stand-alone punctuation such as a dash: mark the previous token as a clause end
            if tokens and re.search(r"[-;:]", piece):
                tokens[-1].clause_end = True
            continue
        subwords = [s for s in re.split(r"-+", letters) if s.strip("'")]
        chars = "|".join(re.sub(r"[^A-Za-z']", "", s).upper() for s in subwords)
        norm = " ".join(s.lower() for s in subwords)
        n_syl = sum(count_syllables(s) for s in subwords)
        end_char = piece.rstrip("\"')]")[-1:] if piece.rstrip("\"')]") else ""
        tokens.append(Token(
            index=len(tokens), display=piece, norm=norm, chars=chars, n_syl=max(1, n_syl),
            is_function=norm in FUNCTION_WORDS,
            sentence_end=end_char in ".!?;:" and not is_abbrev,
            clause_end=end_char in ",",
        ))
    return tokens


def normalize_for_wer(text: str) -> list[str]:
    text = expand_numbers(text.replace("’", "'")).lower()
    text = re.sub(r"[-—–]", " ", text)
    return [w for w in re.sub(r"[^a-z' ]", " ", text).split() if w.strip("'")]


def word_error_rate(ref: list[str], hyp: list[str]) -> float:
    """Levenshtein word error rate."""
    if not ref:
        return 0.0 if not hyp else 1.0
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1] / len(ref)
