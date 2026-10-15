"""Command-line interface: `shruti <command>` (also available as `python -m shruti`)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def cmd_download(args) -> None:
    from shruti.dataset.sources import download_sources
    download_sources()


def cmd_originals(args) -> None:
    from shruti.dataset.originals import build_originals
    build_originals(force=args.force)


def cmd_dataset(args) -> None:
    from shruti.dataset.bench import build_bench
    print(build_bench(workers=args.workers, only=args.split))


def cmd_verify(args) -> None:
    from shruti.dataset.verify import verify_renders
    ok = verify_renders()
    sys.exit(0 if ok else 1)


def cmd_analyze(args) -> None:
    from shruti.analyze import analyze
    from shruti.io.audio import load_audio
    x = load_audio(args.audio)
    ref = load_audio(args.reference) if args.reference else None
    transcript = Path(args.transcript).read_text() if args.transcript and Path(args.transcript).exists() else args.transcript
    r = analyze(x, args.script, transcript, ref, bootstrap=not args.fast)
    if args.json:
        Path(args.json).write_text(json.dumps(r, indent=1))
    print(f"{r['script']['title']}  overall {r['rubric']['overall']}/10  WSDC style {r['rubric']['wsdc_style']}/40")
    for d, v in r["rubric"]["dimensions"].items():
        print(f"  {v['label']:<11} {v['score']:5.2f}")
    for c in r["cards"]:
        print(f"- {c['t_start']:6.2f}-{c['t_end']:6.2f}s  {c['title']}: {c['headline']}")
        print(f"    {c['explanation']}\n    Fix: {c['fix']}")
    print(f"fingerprint {r['fingerprint']['id']}")


def cmd_predict(args) -> None:
    from shruti.eval.run import run_predictions
    print(run_predictions(args.split, workers=args.workers, tag=args.tag))


def cmd_eval(args) -> None:
    from shruti.eval.report import make_report
    make_report(args.tag, splits=args.splits)


def cmd_freeze_check(args) -> None:
    from shruti.eval.report import assert_frozen
    assert_frozen()


def cmd_demos(args) -> None:
    from shruti.dataset.demos import build_demos
    build_demos()


def cmd_study(args) -> None:
    from shruti.dataset.study import build_study
    print(f"{len(build_study())} study clips written to data/study/")


def cmd_panel(args) -> None:
    from shruti.eval.panel import analyse_panel
    print(json.dumps(analyse_panel(), indent=1))


def cmd_priors(args) -> None:
    from shruti.baseline.priors import estimate_priors
    print(json.dumps(estimate_priors(args.min_takes), indent=1))


def cmd_encoder(args) -> None:
    from shruti.encoder.train import train
    print(json.dumps(train(epochs=args.epochs, scripts=args.scripts, name=args.name), indent=1))


def cmd_serve(args) -> None:
    import uvicorn
    uvicorn.run("shruti.api.main:app", host=args.host, port=args.port, reload=False)


def cmd_reproduce(args) -> None:
    from shruti.dataset.verify import verify_renders
    from shruti.eval.report import compare_with_committed
    ok = verify_renders()
    ok = compare_with_committed() and ok
    sys.exit(0 if ok else 1)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="shruti", description="SHRUTI speech-delivery analytics")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("download", help="download the public-domain source recordings").set_defaults(fn=cmd_download)
    s = sub.add_parser("originals", help="cut the reference excerpts")
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_originals)
    s = sub.add_parser("dataset", help="generate recipes and render SHRUTI-Bench")
    s.add_argument("--workers", type=int, default=6)
    s.add_argument("--split", choices=["dev", "test"], default=None)
    s.set_defaults(fn=cmd_dataset)
    sub.add_parser("verify", help="check renders against recorded SHA-256 sums").set_defaults(fn=cmd_verify)
    s = sub.add_parser("analyze", help="analyse one recording")
    s.add_argument("audio")
    s.add_argument("--script", help="bench script id (S1..S6)")
    s.add_argument("--transcript", help="transcript text or file (with --reference)")
    s.add_argument("--reference", help="reference recording of the same text")
    s.add_argument("--json", help="write the full result to this file")
    s.add_argument("--fast", action="store_true", help="skip bootstrap confidence intervals")
    s.set_defaults(fn=cmd_analyze)
    s = sub.add_parser("predict", help="run the detector over the benchmark")
    s.add_argument("--split", choices=["dev", "test"], default="dev")
    s.add_argument("--workers", type=int, default=4)
    s.add_argument("--tag", default="frozen")
    s.set_defaults(fn=cmd_predict)
    s = sub.add_parser("eval", help="compute metrics, tables and figures")
    s.add_argument("--tag", default="frozen")
    s.add_argument("--splits", nargs="+", default=["dev", "test"])
    s.set_defaults(fn=cmd_eval)
    sub.add_parser("demos", help="pre-compute Judge Mode demo analyses").set_defaults(fn=cmd_demos)
    sub.add_parser("study-build", help="build the 24(+4 repeat)-clip adjudicator study set").set_defaults(fn=cmd_study)
    sub.add_parser("panel", help="analyse adjudicator study responses").set_defaults(fn=cmd_panel)
    s = sub.add_parser("priors", help="estimate prior spreads from accepted human good takes")
    s.add_argument("--min-takes", type=int, default=3)
    s.set_defaults(fn=cmd_priors)
    s = sub.add_parser("train-encoder", help="train the contrastive delivery encoder on dev scripts")
    s.add_argument("--epochs", type=int, default=6)
    s.add_argument("--scripts", nargs="+", default=None)
    s.add_argument("--name", default="encoder")
    s.set_defaults(fn=cmd_encoder)
    s = sub.add_parser("serve", help="run the API + dashboard")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.set_defaults(fn=cmd_serve)
    sub.add_parser("reproduce", help="verify renders and committed results").set_defaults(fn=cmd_reproduce)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
