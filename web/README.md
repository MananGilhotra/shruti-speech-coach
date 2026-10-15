# SHRUTI dashboard (`web/`)

React 18 + TypeScript + Vite + Tailwind CSS. Waveforms, flaw regions and the time axis use
wavesurfer.js v7 (Regions + Timeline plugins); feature lanes and charts are plain canvas/SVG;
maths is rendered with KaTeX.

## Install

```bash
cd web
npm install
```

## Develop

Start the API first (it listens on `127.0.0.1:8000`), then:

```bash
npm run dev            # http://localhost:5173, proxies /v1 → http://127.0.0.1:8000
SHRUTI_API=http://127.0.0.1:9000 npm run dev   # point the proxy at another API
```

If the API is unreachable the app switches to **offline demo mode**: the bundled sample
analysis (`src/fixtures/analysis.json`) stays fully browsable and audio features are disabled.

## Build

```bash
npm run build          # type-checks (tsc -b) and writes web/dist
npm run typecheck      # type-check only
```

FastAPI serves `web/dist` at `/` (with SPA fallback) and the API under `/v1` on the same origin,
so after a build just open the API server's address.

## Layout

```
src/
  api.ts            typed client for /v1 (+ fixture fallback, analysis normalisation)
  types.ts          TypeScript types for every API shape
  fixtures/         real API outputs used for offline mode
  lib/              player (multi-track playback engine), recorder, audio (WAV encoding),
                    tokenizer (matches the backend), formatting, colours, app state
  components/       UI primitives, timeline (waveform + canvas lanes), flaw cards,
                    Ghost Coach, drill, charts
  pages/            Home, Analyse, Analysis, Studio, StudioReview, Explore, Evaluation, Study, Method
```

Keyboard shortcuts on the analysis screen: `Space` play/pause · `J`/`K` previous/next flaw ·
`G` ghost · `R` reference · `Y` yours · `D` duet · `+`/`−`/`0` zoom · `?` help.
