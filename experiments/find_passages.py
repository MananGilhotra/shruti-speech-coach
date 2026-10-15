"""Greedy-transcribe the long source recordings so excerpt boundaries can be chosen (dev helper)."""
import json, sys, time
from pathlib import Path
from shruti.io.audio import load_audio
from shruti.align.ctc import Aligner

al = Aligner.get()
out = {}
for f in sorted(Path("data/raw").glob("*.ogg")):
    t = time.time()
    x = load_audio(f)
    words = al.transcribe(x, al.emissions(x))
    out[f.stem] = words
    print(f.stem, f"{len(x)/16000:.0f}s audio, {len(words)} words, {time.time()-t:.0f}s", flush=True)
Path("results/cache/raw_transcripts.json").write_text(json.dumps(out))
