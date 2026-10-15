"""SHRUTI HTTP API (FastAPI). Serves the analysis pipeline, audio tracks, Ghost Coach, the
drill loop, Flaw Studio, the adjudicator study and the benchmark explorer; also serves the
built dashboard from web/dist when it exists."""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from shruti import __version__
from shruti.config import DATA_DIR, RESULTS_DIR, ROOT, config_hash, load_config
from shruti.io.audio import SR, load_audio, load_audio_bytes, save_audio, sha256_file, to_wav_bytes
from shruti.process import QualityError, load_scripts

ANALYSES = RESULTS_DIR / "cache" / "analyses"
DEMOS = DATA_DIR / "demos"
STUDY = DATA_DIR / "study"
WEB_DIST = ROOT / "web" / "dist"

app = FastAPI(title="SHRUTI API", version=__version__,
              description="Contrastive speech-delivery analytics with temporal flaw grounding.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# --------------------------------------------------------------------------- helpers
def _adir(aid: str) -> Path:
    for root in (ANALYSES, DEMOS):
        d = root / aid
        if (d / "result.json").exists():
            return d
    raise HTTPException(404, f"analysis {aid} not found")


def _wav(x: np.ndarray) -> Response:
    return Response(to_wav_bytes(x), media_type="audio/wav", headers={"Cache-Control": "public, max-age=3600"})


def _crop(x: np.ndarray, start: float | None, end: float | None) -> np.ndarray:
    a = int(max(0.0, start or 0.0) * SR)
    b = int(end * SR) if end is not None else len(x)
    return x[a:max(a + 1, b)]


async def _decode(upload: UploadFile) -> np.ndarray:
    data = await upload.read()
    if not data:
        raise HTTPException(400, "empty audio upload")
    try:
        return await run_in_threadpool(load_audio_bytes, data)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"could not decode audio: {e}") from e


def _store_analysis(result: dict, x: np.ndarray, ref: np.ndarray | None) -> None:
    d = ANALYSES / result["analysis_id"]
    d.mkdir(parents=True, exist_ok=True)
    save_audio(d / "user.wav", x)
    if ref is not None:
        save_audio(d / "reference.wav", ref)
    (d / "result.json").write_text(json.dumps(result))


def _context(aid: str):
    """Rebuild (x, P, B, g, result) for an analysis (all cached, so this is fast)."""
    from shruti.detect.core import detect
    from shruti.store import get_baseline, processed_take, single_reference_baseline

    d = _adir(aid)
    result = json.loads((d / "result.json").read_text())
    cfg = load_config()
    x = load_audio(d / "user.wav")
    transcript = result["script"]["transcript"]
    sid = result["script"]["script_id"]
    if sid:
        B = get_baseline(sid, cfg)
    else:
        B = single_reference_baseline(load_audio(d / "reference.wav"), transcript, cfg)
    P, _ = processed_take(x, transcript, cfg)
    _, _, g = detect(P, B, cfg)
    return d, result, cfg, x, P, B, g


# --------------------------------------------------------------------------- meta
@app.get("/v1/health")
def health():
    return {"status": "ok", "version": __version__}


@app.get("/v1/version")
def version():
    from shruti.analyze import code_version
    cfg = load_config()
    return {"version": code_version(), "config_hash": config_hash(cfg), "model": cfg["alignment"]["model"]}


@app.get("/v1/scripts")
def scripts():
    from shruti.store import reference_files
    out = []
    for sid, s in load_scripts().items():
        meta_p = DATA_DIR / "bench" / "originals" / f"{sid}.json"
        meta = json.loads(meta_p.read_text()) if meta_p.exists() else {}
        out.append({"script_id": sid, "title": s["title"], "speaker": s["speaker"], "year": s["year"],
                    "transcript": s["transcript"], "duration_s": meta.get("duration_s"),
                    "n_refs": len(reference_files(sid)), "split": "test" if sid in ("S5", "S6") else "dev",
                    "license": s["source"]["license"], "commons_page": s["source"]["commons_page"]})
    return out


@app.get("/v1/scripts/{sid}/audio")
def script_audio(sid: str):
    p = DATA_DIR / "bench" / "originals" / f"{sid}.flac"
    if not p.exists():
        raise HTTPException(404, "no original audio for this script")
    return FileResponse(p, media_type="audio/flac")


# --------------------------------------------------------------------------- analysis
@app.post("/v1/analyses")
async def create_analysis(audio: UploadFile = File(...), script_id: str | None = Form(None),
                          transcript: str | None = Form(None), reference: UploadFile | None = File(None),
                          bootstrap: bool = Form(True)):
    from shruti.analyze import analyze

    x = await _decode(audio)
    ref = await _decode(reference) if reference is not None and reference.filename else None
    if not script_id and (ref is None or not transcript):
        raise HTTPException(400, "send script_id, or transcript + reference audio")
    t0 = time.time()
    try:
        result = await run_in_threadpool(analyze, x, script_id or None, transcript, ref, None, bootstrap)
    except QualityError as e:
        raise HTTPException(422, str(e)) from e
    except KeyError as e:
        raise HTTPException(404, str(e)) from e
    result["elapsed_s"] = round(time.time() - t0, 2)
    _store_analysis(result, x, ref)
    return result


@app.get("/v1/analyses/{aid}")
def get_analysis(aid: str):
    return JSONResponse(json.loads((_adir(aid) / "result.json").read_text()))


@app.get("/v1/analyses/{aid}/audio")
async def analysis_audio(aid: str, track: str = Query("user", pattern="^(user|reference|duet|ghost)$"),
                         flaw: str | None = None, start: float | None = None, end: float | None = None):
    d = _adir(aid)
    if track == "user":
        return _wav(_crop(load_audio(d / "user.wav"), start, end))
    if track == "reference":
        result = json.loads((d / "result.json").read_text())
        sid = result["script"]["script_id"]
        p = DATA_DIR / "bench" / "originals" / f"{sid}.flac" if sid else d / "reference.wav"
        return _wav(_crop(load_audio(p), start, end))
    if track == "duet":
        p = d / "duet.wav"
        if not p.exists():
            await run_in_threadpool(_make_duet, aid)
        return _wav(_crop(load_audio(p), start, end))
    if not flaw:
        raise HTTPException(400, "ghost track needs ?flaw=<card id>")
    p = d / f"ghost_{flaw}.wav"
    if not p.exists():
        await run_in_threadpool(_make_ghost, aid, flaw, None, None, False)
    return _wav(_crop(load_audio(p), start, end))


def _make_duet(aid: str) -> None:
    from shruti.coach.ghost import duet
    from shruti.store import processed_take
    d, result, cfg, x, P, B, g = _context(aid)
    sid = result["script"]["script_id"]
    ref_x = load_audio(DATA_DIR / "bench" / "originals" / f"{sid}.flac" if sid else d / "reference.wav")
    R, _ = processed_take(ref_x, result["script"]["transcript"], cfg)
    save_audio(d / "duet.wav", duet(ref_x, R, P))


def _make_ghost(aid: str, flaw: str, fixes: list[str] | None, blend: float | None, counterfactual: bool) -> dict:
    from shruti.coach.ghost import DEFAULT_FIXES, ghost
    from shruti.detect.core import detect
    from shruti.store import processed_take

    d, result, cfg, x, P, B, g = _context(aid)
    cards = {c["id"]: c for c in result["cards"]}
    if flaw not in cards:
        raise HTTPException(404, f"no flaw {flaw}")
    c = cards[flaw]
    fixes = fixes or DEFAULT_FIXES[c["type"]]
    y, info = ghost(x, P, B, c, g, cfg, fixes, blend)
    save_audio(d / f"ghost_{flaw}.wav", y)       # the latest ghost for this flaw is what the player streams
    out = {"flaw": flaw, **info, "audio_url": f"/v1/analyses/{aid}/audio?track=ghost&flaw={flaw}&v={int(time.time())}"}
    if counterfactual:
        P2, _ = processed_take(y, result["script"]["transcript"], cfg)
        regs, _, _ = detect(P2, B, cfg)
        a, b = info["region_out"]
        still = [r for r in regs if r.ftype == c["type"] and min(r.t_end, b) > max(r.t_start, a)]
        names = {"duration": "the timing", "pause": "the pause", "pitch": "the pitch contour",
                 "intensity": "the loudness", "brightness": "the brightness", "cut": "removing the hesitation"}
        what = " and ".join(names.get(f, f) for f in fixes)
        verb = "" if fixes == ["cut"] else "Fixing "
        what = what[0].upper() + what[1:] if not verb else what
        out["counterfactual"] = {
            "fixes": fixes, "flag_cleared": not still,
            "sentence": (f"{verb}{what} alone clears this flag." if not still else
                         f"{verb}{what} alone does not clear this flag (z = {still[0].z:+.2f})."),
        }
    return out


@app.post("/v1/analyses/{aid}/ghost")
async def make_ghost(aid: str, body: dict):
    flaw = body.get("flaw_id")
    fixes = body.get("fixes")
    blend = body.get("blend")
    return await run_in_threadpool(_make_ghost, aid, flaw, fixes, blend, bool(body.get("counterfactual", True)))


@app.post("/v1/analyses/{aid}/drill")
async def drill(aid: str, flaw_id: str = Form(...), audio: UploadFile = File(...)):
    """Re-record one flagged phrase: it is spliced into the original take and re-scored in context."""
    from shruti.analyze import analyze
    from shruti import dsp

    phrase = await _decode(audio)
    d, result, cfg, x, P, B, g = await run_in_threadpool(_context, aid)
    cards = {c["id"]: c for c in result["cards"]}
    if flaw_id not in cards:
        raise HTTPException(404, f"no flaw {flaw_id}")
    c = cards[flaw_id]
    i, j = c["word_span"]
    a = float(P.words["end"].iloc[i - 1]) if i > 0 else 0.0
    b = float(P.words["start"].iloc[j + 1]) if j + 1 < len(P.words) else len(x) / SR
    # trim leading/trailing silence of the new phrase, then splice it between the neighbouring words
    from shruti.features.frame import extract_frames
    fr = extract_frames(phrase, SR, cfg)
    act = np.flatnonzero(~fr.silent)
    if len(act):
        phrase = phrase[max(0, int((fr.times[act[0]] - 0.08) * SR)): int((fr.times[act[-1]] + 0.12) * SR)]
    pad = np.zeros(int(0.12 * SR), np.float32)
    rms_old = float(np.sqrt(np.mean(x[int(a * SR):int(b * SR)] ** 2)) + 1e-6)
    rms_new = float(np.sqrt(np.mean(phrase ** 2)) + 1e-6)
    phrase = phrase * min(4.0, rms_old / rms_new)
    y = np.concatenate([x[: int(a * SR)], pad, dsp.fade(phrase, 0.01), pad, x[int(b * SR):]]).astype(np.float32)
    try:
        new = await run_in_threadpool(analyze, y, result["script"]["script_id"], result["script"]["transcript"],
                                      None, cfg, False)
    except QualityError as e:
        raise HTTPException(422, str(e)) from e
    phrase_a = a + 0.12
    phrase_b = phrase_a + len(phrase) / SR
    remaining = [k for k in new["cards"] if k["word_span"][1] >= i and k["word_span"][0] <= j]
    same = [k for k in remaining if k["type"] == c["type"]]
    return {"flaw_id": flaw_id, "cleared": not same, "remaining": remaining,
            "phrase_window": [round(phrase_a, 3), round(phrase_b, 3)],
            "overall_before": result["rubric"]["overall"], "overall_after": new["rubric"]["overall"],
            "dimension": c["dimension"],
            "dim_before": result["rubric"]["dimensions"][c["dimension"]]["score"],
            "dim_after": new["rubric"]["dimensions"][c["dimension"]]["score"]}


# --------------------------------------------------------------------------- demos / judge mode
@app.get("/v1/demos")
def demos():
    idx = DEMOS / "index.json"
    return json.loads(idx.read_text()) if idx.exists() else []


# --------------------------------------------------------------------------- benchmark explorer + eval
@app.get("/v1/bench/series")
def bench_series(script_id: str = "S1"):
    """Gradient series (Level 0 -> 10) for the explorer slider, from local renders or the demo pack."""
    pack = DEMOS / "explorer" / "index.json"
    if pack.exists():
        rows = [r for r in json.loads(pack.read_text()) if r["script_id"] == script_id]
        if rows:
            return rows
    from shruti.dataset.bench import BENCH_DIR
    lp = BENCH_DIR / "labels.jsonl"
    if not lp.exists():
        return []
    rows = [json.loads(line) for line in open(lp)]
    return [r for r in rows if r["script_id"] == script_id and r["layer"] == "gradient" and r["render_id"].split("__")[2].startswith("b0")]


@app.get("/v1/bench/audio/{render_id}")
def bench_audio(render_id: str):
    for p in (DEMOS / "explorer" / f"{render_id}.flac",):
        if p.exists():
            return FileResponse(p, media_type="audio/flac")
    split = "test" if render_id.split("__")[0] in ("S5", "S6") else "dev"
    p = DATA_DIR / "renders" / split / f"{render_id}.flac"
    if not p.exists():
        raise HTTPException(404, "render not available (run `make dataset`)")
    return FileResponse(p, media_type="audio/flac")


@app.get("/v1/eval")
def eval_summary():
    p = RESULTS_DIR / "benchmark" / "summary.json"
    if not p.exists():
        raise HTTPException(404, "no benchmark results yet (run `make eval`)")
    return json.loads(p.read_text())


@app.get("/v1/eval/figure/{name}")
def eval_figure(name: str):
    p = RESULTS_DIR / "benchmark" / "figures" / Path(name).name
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


# --------------------------------------------------------------------------- Flaw Studio
@app.get("/v1/studio/assignment")
async def studio_assignment(speaker_id: str):
    from shruti.studio.protocol import assignment, safe_id
    return await run_in_threadpool(assignment, safe_id(speaker_id))


@app.post("/v1/studio/consent")
def studio_consent(body: dict):
    from shruti.studio.protocol import save_consent
    if not body.get("accepted") or not body.get("age_ok"):
        raise HTTPException(400, "consent and age confirmation are required")
    return save_consent(body)


@app.post("/v1/studio/takes")
async def studio_upload(audio: UploadFile = File(...), meta: str = Form(...)):
    from shruti.studio.protocol import UPLOADS, has_consent, safe_id
    m = json.loads(meta)
    spk = safe_id(m.get("speaker_id", ""))
    if not has_consent(spk):
        raise HTTPException(403, "no consent on file for this speaker id")
    x = await _decode(audio)
    task = safe_id(m.get("task_id", "task"))
    d = UPLOADS / spk
    d.mkdir(parents=True, exist_ok=True)
    save_audio(d / f"{task}.wav", x)
    rec = {**m, "take_id": f"{spk}__{task}", "speaker_id": spk, "duration_s": round(len(x) / SR, 2),
           "sha256": sha256_file(d / f"{task}.wav"), "uploaded": int(time.time()), "status": "pending"}
    # propose realised label boundaries from the forced alignment of the instructed words
    try:
        from shruti.store import processed_take
        P, rep = await run_in_threadpool(processed_take, x, load_scripts()[m["script_id"]]["transcript"])
        ins = m.get("instruction") or {}
        if ins.get("words"):
            i, j = ins["words"]
            w = P.words
            if ins.get("type") in ("long_pause", "missing_pause"):
                rec["proposed_label"] = {"t_start": float(w["end"].iloc[i]), "t_end": float(w["start"].iloc[i + 1])}
            else:
                rec["proposed_label"] = {"t_start": float(w["start"].iloc[i]), "t_end": float(w["end"].iloc[j])}
        rec["asr_wer"] = rep.get("asr_wer")
    except Exception as e:  # noqa: BLE001 - keep the recording even if alignment fails
        rec["alignment_error"] = str(e)
    (d / f"{task}.json").write_text(json.dumps(rec, indent=1))
    return rec


@app.get("/v1/studio/takes")
def studio_takes():
    from shruti.studio.protocol import list_takes
    return list_takes()


@app.get("/v1/studio/takes/{take_id}/audio")
def studio_take_audio(take_id: str):
    from shruti.studio.protocol import take_path
    p = take_path(take_id)
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="audio/wav")


@app.post("/v1/studio/takes/{take_id}/review")
def studio_review(take_id: str, body: dict):
    from shruti.studio.protocol import ACCEPTED, take_path
    p = take_path(take_id)
    meta_p = p.with_suffix(".json")
    if not meta_p.exists():
        raise HTTPException(404)
    rec = json.loads(meta_p.read_text())
    reviews = rec.setdefault("reviews", [])
    reviews.append({**body, "timestamp": int(time.time())})
    rec["status"] = body.get("verdict", "pending")
    if body.get("label"):
        rec["label"] = body["label"]
    meta_p.write_text(json.dumps(rec, indent=1))
    if rec["status"] == "accepted" and rec.get("kind") == "good":
        dst = ACCEPTED / rec["script_id"] / f"{rec['speaker_id']}_{rec['task_id']}.wav"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(p, dst)
    return rec


# --------------------------------------------------------------------------- adjudicator study
@app.get("/v1/study/clips")
def study_clips(rater_id: str = "anon"):
    p = STUDY / "clips.json"
    if not p.exists():
        return []
    clips = json.loads(p.read_text())
    import hashlib
    rng = np.random.default_rng(int(hashlib.sha256(rater_id.encode()).hexdigest()[:8], 16))
    order = rng.permutation(len(clips))
    return [clips[i] for i in order]


@app.get("/v1/study/audio/{clip_id}")
def study_audio(clip_id: str):
    p = STUDY / "audio" / f"{Path(clip_id).name}.flac"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="audio/flac")


@app.post("/v1/study/responses")
def study_response(body: dict):
    STUDY.mkdir(parents=True, exist_ok=True)
    with open(STUDY / "responses.jsonl", "a") as f:
        f.write(json.dumps({**body, "timestamp": int(time.time())}) + "\n")
    return {"ok": True}


# --------------------------------------------------------------------------- web app
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = WEB_DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(WEB_DIST / "index.html")
