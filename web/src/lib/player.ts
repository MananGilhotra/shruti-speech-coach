/* Multi-track playback engine for the analysis screen.
 *
 * Everything is addressed in the *user's* timeline (seconds of the uploaded take):
 *  - user       the take itself (played by wavesurfer, which also draws the waveform)
 *  - duet       the original orator time-warped onto the user's word timing, played together with the take
 *  - reference  the original recording; user time <-> reference time via the aligned word spans
 *  - ghost      the user's own voice with one flaw corrected; mapped through the corrected region
 * The playhead therefore always moves along the user's timeline, whichever track is audible.
 *
 * Tracks are fetched as blobs (object URLs are always seekable, unlike plain streamed responses). */
import type WaveSurfer from 'wavesurfer.js';
import { analysisAudioUrl, fetchBlob, errorMessage } from '../api';
import type { Word } from '../types';

export type PlayMode = 'user' | 'reference' | 'duet' | 'ghost';

export const MODE_LABEL: Record<PlayMode, string> = {
  user: 'Yours',
  reference: 'Reference',
  duet: 'Duet',
  ghost: 'Ghost',
};

export interface Segment {
  mode: PlayMode;
  from: number;
  to: number;
  label: string;
  flawId?: string;
}

export interface GhostTrack {
  url: string;
  /** The corrected section in the ghost's own timeline (from POST /ghost). */
  regionOut: [number, number] | null;
  /** Length of the ghost recording, when known (POST /ghost returns it). */
  ghostDuration?: number | null;
  tStart: number;
  tEnd: number;
}

export interface PlayerState {
  enabled: boolean;
  mode: PlayMode;
  playing: boolean;
  loading: string | null;
  ghostFlawId: string | null;
  segment: { label: string; index: number; total: number; loop: boolean; mode: PlayMode } | null;
  error: string | null;
  duetMix: number;
}

function interp(x: number, xs: number[], ys: number[]): number {
  const n = xs.length;
  if (!n) return x;
  if (x <= xs[0]) return ys[0] + (x - xs[0]);
  if (x >= xs[n - 1]) return ys[n - 1] + (x - xs[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const dx = xs[hi] - xs[lo];
  if (dx <= 1e-9) return ys[hi];
  return ys[lo] + ((x - xs[lo]) * (ys[hi] - ys[lo])) / dx;
}

export class TimeMap {
  constructor(
    private xs: number[],
    private ys: number[],
  ) {}
  /** user time -> track time */
  map(x: number): number {
    return interp(x, this.xs, this.ys);
  }
  /** track time -> user time */
  inverse(y: number): number {
    return interp(y, this.ys, this.xs);
  }
  static identity(): TimeMap {
    return new TimeMap([], []);
  }
  static fromAnchors(pairs: [number, number][]): TimeMap {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of pairs) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (xs.length && (x < xs[xs.length - 1] || y < ys[ys.length - 1])) continue; // keep it monotone
      xs.push(x);
      ys.push(y);
    }
    return new TimeMap(xs, ys);
  }
}

/** Map the user's word timing onto the reference recording's aligned word spans. */
export function referenceMap(words: Word[], spans: [number, number][] | undefined): TimeMap {
  if (!spans?.length) return TimeMap.identity();
  const pairs: [number, number][] = [];
  words.forEach((w, i) => {
    const s = spans[i];
    if (!s) return;
    pairs.push([w.start, s[0]], [w.end, s[1]]);
  });
  return TimeMap.fromAnchors(pairs);
}

type AuxKind = 'reference' | 'duet' | 'ghost';

export class Player {
  private ws: WaveSurfer | null = null;
  private els: Record<AuxKind, HTMLAudioElement>;
  private loadedUrl: Record<AuxKind, string | null> = { reference: null, duet: null, ghost: null };
  private blobCache = new Map<string, Promise<string>>();
  private ghosts = new Map<string, GhostTrack>();
  private listeners = new Set<() => void>();
  private timeListeners = new Set<(t: number) => void>();
  private userTime = 0;
  private raf = 0;
  private stopAt: number | null = null;
  private queue: Segment[] = [];
  private queueIndex = 0;
  private loop = false;
  private gapTimer = 0;
  private gapPending = false;
  private playToken = 0;
  private destroyed = false;
  state: PlayerState;

  constructor(
    private analysisId: string,
    private duration: number,
    private refMap: TimeMap,
    enabled: boolean,
    private onError?: (msg: string) => void,
  ) {
    this.state = {
      enabled,
      mode: 'user',
      playing: false,
      loading: null,
      ghostFlawId: null,
      segment: null,
      error: null,
      duetMix: 0.5,
    };
    const mk = () => {
      const a = new Audio();
      a.preload = 'auto';
      a.addEventListener('ended', () => this.handleEnded());
      a.addEventListener('timeupdate', () => this.tick(false));
      return a;
    };
    this.els = { reference: mk(), duet: mk(), ghost: mk() };
  }

  // ----------------------------------------------------------------------- subscription plumbing
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  onTime(fn: (t: number) => void): () => void {
    this.timeListeners.add(fn);
    return () => this.timeListeners.delete(fn);
  }
  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private emitTime() {
    this.timeListeners.forEach((l) => l(this.userTime));
  }
  getTime(): number {
    return this.userTime;
  }
  getDuration(): number {
    return this.duration;
  }

  // ----------------------------------------------------------------------- setup
  attachWaveSurfer(ws: WaveSurfer | null) {
    this.ws = ws;
    if (ws) {
      ws.on('finish', () => {
        if (this.state.mode === 'user' || this.state.mode === 'duet') this.handleEnded();
      });
      ws.on('timeupdate', () => this.tick(false));
    }
  }

  setEnabled(enabled: boolean) {
    if (!enabled) this.pause();
    this.set({ enabled });
  }

  setGhost(flawId: string, track: GhostTrack) {
    this.ghosts.set(flawId, track);
    if (this.state.ghostFlawId === flawId && this.loadedUrl.ghost !== track.url) this.loadedUrl.ghost = null;
  }

  hasGhost(flawId: string): boolean {
    return this.ghosts.has(flawId);
  }

  defaultGhost(flawId: string, tStart: number, tEnd: number) {
    if (!this.ghosts.has(flawId)) {
      this.ghosts.set(flawId, {
        url: analysisAudioUrl(this.analysisId, 'ghost', { flaw: flawId }),
        regionOut: null,
        tStart,
        tEnd,
      });
    }
  }

  setDuetMix(mix: number) {
    this.set({ duetMix: mix });
    this.applyVolumes();
  }

  private applyVolumes() {
    const m = this.state.duetMix;
    const duetMode = this.state.mode === 'duet';
    const userVol = duetMode ? (m <= 0.5 ? 1 : 2 * (1 - m)) : 1;
    const refVol = m >= 0.5 ? 1 : 2 * m;
    this.ws?.setVolume(userVol);
    this.els.duet.volume = refVol;
  }

  // ----------------------------------------------------------------------- track loading
  private trackUrl(kind: AuxKind): string | null {
    if (kind === 'reference') return analysisAudioUrl(this.analysisId, 'reference');
    if (kind === 'duet') return analysisAudioUrl(this.analysisId, 'duet');
    const g = this.state.ghostFlawId ? this.ghosts.get(this.state.ghostFlawId) : undefined;
    return g?.url ?? null;
  }

  private objectUrl(url: string): Promise<string> {
    let p = this.blobCache.get(url);
    if (!p) {
      p = fetchBlob(url).then((b) => URL.createObjectURL(b));
      p.catch(() => this.blobCache.delete(url));
      this.blobCache.set(url, p);
    }
    return p;
  }

  /** Warm a track in the background (e.g. the reference) so the first switch is instant. */
  prefetch(kind: 'reference' | 'duet') {
    if (!this.state.enabled) return;
    const url = this.trackUrl(kind);
    if (url) this.objectUrl(url).catch(() => undefined);
  }

  private async ensureTrack(kind: AuxKind): Promise<HTMLAudioElement> {
    const url = this.trackUrl(kind);
    if (!url) throw new Error('Pick a flaw card first: the ghost track corrects one flaw at a time.');
    const el = this.els[kind];
    if (this.loadedUrl[kind] === url && el.src) return el;
    const label =
      kind === 'reference' ? 'Loading the reference…' : kind === 'duet' ? 'Preparing the duet…' : 'Synthesising your ghost…';
    this.set({ loading: label });
    try {
      const obj = await this.objectUrl(url);
      el.src = obj;
      this.loadedUrl[kind] = url;
      await waitForMetadata(el);
      return el;
    } finally {
      this.set({ loading: null });
    }
  }

  private trackMap(kind: AuxKind): TimeMap {
    if (kind === 'duet') return TimeMap.identity();
    if (kind === 'reference') return this.refMap;
    const g = this.state.ghostFlawId ? this.ghosts.get(this.state.ghostFlawId) : undefined;
    if (!g) return TimeMap.identity();
    // The ghost is the take itself outside the corrected section, shifted by the length change after it.
    const elD = this.els.ghost.duration;
    const ghostD = g.ghostDuration ?? (Number.isFinite(elD) && elD > 0 ? elD : null);
    const delta = ghostD != null ? ghostD - this.duration : 0;
    if (g.regionOut) {
      const [o0, o1] = g.regionOut;
      const inEnd = o1 - delta;
      if (ghostD != null && inEnd >= o0 - 1e-3) return TimeMap.fromAnchors([[o0, o0], [Math.max(o0, inEnd), o1]]);
      return TimeMap.fromAnchors([[g.tStart, o0], [g.tEnd, o1]]);
    }
    return TimeMap.fromAnchors([[g.tStart, g.tStart], [g.tEnd, g.tEnd + delta]]);
  }

  // ----------------------------------------------------------------------- transport
  setMode(mode: PlayMode, ghostFlawId?: string | null) {
    const wasPlaying = this.state.playing;
    this.cancelQueue();
    this.pauseMedia();
    const patch: Partial<PlayerState> = { mode, playing: false, error: null };
    if (ghostFlawId !== undefined) patch.ghostFlawId = ghostFlawId;
    this.set(patch);
    this.applyVolumes();
    if (wasPlaying) void this.play();
  }

  setGhostFlaw(flawId: string | null) {
    if (flawId === this.state.ghostFlawId) return;
    const wasGhostPlaying = this.state.playing && this.state.mode === 'ghost';
    if (wasGhostPlaying) this.pause();
    this.set({ ghostFlawId: flawId });
  }

  async play(): Promise<void> {
    if (!this.state.enabled || this.destroyed) return;
    const token = ++this.playToken;
    this.pauseMedia();
    const t = Math.max(0, Math.min(this.userTime, this.duration - 0.01));
    if (this.userTime >= this.duration - 0.05 && !this.queue.length) this.userTime = 0;
    const mode = this.state.mode;
    try {
      if (mode === 'user') {
        if (!this.ws) return;
        this.ws.setTime(this.userTime >= this.duration - 0.05 ? 0 : t);
        this.set({ playing: true, error: null });
        await this.ws.play();
      } else if (mode === 'duet') {
        const el = await this.ensureTrack('duet');
        if (token !== this.playToken || !this.ws) return;
        this.applyVolumes();
        this.ws.setTime(t);
        el.currentTime = Math.min(t, el.duration || t);
        this.set({ playing: true, error: null });
        await Promise.all([this.ws.play(), el.play()]);
      } else {
        const kind: AuxKind = mode === 'reference' ? 'reference' : 'ghost';
        const el = await this.ensureTrack(kind);
        if (token !== this.playToken) return;
        const tt = Math.max(0, this.trackMap(kind).map(t));
        el.currentTime = Math.min(tt, Math.max(0, (el.duration || tt) - 0.02));
        this.set({ playing: true, error: null });
        await el.play();
      }
      if (token !== this.playToken) return;
      this.startLoop();
    } catch (e) {
      if (token !== this.playToken) return;
      const msg = errorMessage(e);
      // play() interrupted by a later pause() is not an error worth showing
      if (/interrupted|aborted/i.test(msg)) return;
      this.cancelQueue();
      this.pauseMedia();
      this.set({ playing: false, error: msg, segment: null });
      this.onError?.(msg);
    }
  }

  pause() {
    this.playToken++;
    this.cancelQueue();
    this.pauseMedia();
    this.stopAt = null;
    this.set({ playing: false, segment: null });
  }

  toggle() {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    const tt = Math.max(0, Math.min(this.duration, t));
    this.userTime = tt;
    const wasPlaying = this.state.playing;
    if (this.queue.length) this.cancelQueue();
    this.stopAt = null;
    const mode = this.state.mode;
    if (this.ws && (mode === 'user' || mode === 'duet' || !wasPlaying)) this.ws.setTime(tt);
    if (wasPlaying) {
      if (mode === 'duet') this.els.duet.currentTime = tt;
      if (mode === 'reference') this.els.reference.currentTime = Math.max(0, this.refMap.map(tt));
      if (mode === 'ghost') this.els.ghost.currentTime = Math.max(0, this.trackMap('ghost').map(tt));
    }
    this.emitTime();
  }

  /** Play [from, to] (user timeline) on the given track. */
  playRange(from: number, to: number, mode: PlayMode = this.state.mode, label?: string, flawId?: string) {
    this.playSequence([{ mode, from, to, label: label ?? MODE_LABEL[mode], flawId }], false);
  }

  /** Play segments back to back (A/B comparisons, drill loops). */
  playSequence(segments: Segment[], loop = false) {
    if (!this.state.enabled || !segments.length) return;
    this.cancelQueue();
    this.queue = segments;
    this.loop = loop;
    this.startSegment(0);
  }

  stopSequence() {
    this.pause();
  }

  private startSegment(i: number) {
    const s = this.queue[i];
    if (!s) return;
    this.queueIndex = i;
    this.pauseMedia();
    const patch: Partial<PlayerState> = {
      mode: s.mode,
      segment: { label: s.label, index: i, total: this.queue.length, loop: this.loop, mode: s.mode },
    };
    if (s.flawId) patch.ghostFlawId = s.flawId;
    this.set(patch);
    this.applyVolumes();
    this.userTime = Math.max(0, s.from);
    this.stopAt = s.to;
    if (this.ws && (s.mode === 'user' || s.mode === 'duet')) this.ws.setTime(this.userTime);
    this.emitTime();
    void this.play();
  }

  private cancelQueue() {
    window.clearTimeout(this.gapTimer);
    this.gapPending = false;
    this.queue = [];
    this.queueIndex = 0;
    this.loop = false;
    if (this.state.segment) this.set({ segment: null });
  }

  private handleEnded() {
    if (!this.state.playing) return;
    this.finishSegment();
  }

  private finishSegment() {
    this.pauseMedia();
    this.stopAt = null;
    if (this.queue.length) {
      let next = this.queueIndex + 1;
      if (next >= this.queue.length) {
        if (!this.loop) {
          this.queue = [];
          this.set({ playing: false, segment: null });
          return;
        }
        next = 0;
      }
      this.playToken++;
      this.gapPending = true;
      this.set({ playing: true });
      this.gapTimer = window.setTimeout(() => {
        this.gapPending = false;
        this.startSegment(next);
      }, 380);
      return;
    }
    this.set({ playing: false });
  }

  private pauseMedia() {
    cancelAnimationFrame(this.raf);
    try {
      this.ws?.pause();
    } catch {
      /* not ready */
    }
    Object.values(this.els).forEach((el) => {
      if (!el.paused) el.pause();
    });
  }

  private currentFromMedia(): number {
    const mode = this.state.mode;
    if (mode === 'user' || mode === 'duet') return this.ws?.getCurrentTime() ?? this.userTime;
    const kind: AuxKind = mode === 'reference' ? 'reference' : 'ghost';
    return this.trackMap(kind).inverse(this.els[kind].currentTime);
  }

  /** Advance the playhead from the audible track; returns false once playback stopped. */
  private tick(fromLoop: boolean): boolean {
    if (!this.state.playing || this.destroyed || this.gapPending) return false;
    const mode = this.state.mode;
    const active = mode === 'user' || mode === 'duet' ? null : this.els[mode === 'reference' ? 'reference' : 'ghost'];
    if (active && active.paused && !fromLoop) return true;
    const t = Math.max(0, Math.min(this.duration, this.currentFromMedia()));
    this.userTime = t;
    if (mode === 'duet' && this.ws) {
      const el = this.els.duet;
      if (!el.paused && Math.abs(el.currentTime - t) > 0.06 && el.duration > t) el.currentTime = t;
    }
    this.emitTime();
    if (this.stopAt != null && t >= this.stopAt) {
      this.finishSegment();
      return false;
    }
    return true;
  }

  private startLoop() {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      if (this.tick(true)) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    Object.values(this.els).forEach((el) => {
      el.removeAttribute('src');
      el.load();
    });
    this.blobCache.forEach((p) => p.then((u) => URL.revokeObjectURL(u)).catch(() => undefined));
    this.listeners.clear();
    this.timeListeners.clear();
  }
}

function waitForMetadata(el: HTMLAudioElement): Promise<void> {
  if (el.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error('This audio track could not be decoded by the browser.'));
    };
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', ok);
      el.removeEventListener('error', bad);
    };
    el.addEventListener('loadedmetadata', ok);
    el.addEventListener('error', bad);
    el.load();
  });
}
