/* Typed client for the SHRUTI HTTP API (same origin, prefix /v1).
 * Falls back to bundled fixtures when the API is unreachable ("offline demo mode"). */
import type {
  Analysis,
  BenchRow,
  ConsentRequest,
  Demo,
  DrillResponse,
  EvalSummary,
  FlawCard,
  GhostRequest,
  GhostResponse,
  Health,
  ReviewRequest,
  ScriptInfo,
  StudioAssignment,
  StudioTake,
  StudyClip,
  StudyResponse,
  VersionInfo,
} from './types';
import sampleAnalysisJson from './fixtures/analysis.json';
import scriptsJson from './fixtures/scripts.json';
import assignmentJson from './fixtures/assignment.json';

export const API_BASE = '/v1';

export const SAMPLE_ID = 'sample';

/** Fill defaults for optional parts of an analysis so the UI never trips over a missing field. */
export function normalizeAnalysis(raw: Analysis): Analysis {
  const a = raw as Partial<Analysis> & { analysis_id: string };
  const words = (a.words ?? []).map((w, i) => ({ ...w, i: w.i ?? i, ref: w.ref ?? null }));
  const n = a.lanes?.t?.length ?? 0;
  const pad = <T,>(arr: T[] | undefined): (T | null)[] => (arr && arr.length === n ? arr : Array.from({ length: n }, (_, i) => arr?.[i] ?? null));
  return {
    ...(a as Analysis),
    mode: a.mode ?? 'unknown',
    version: a.version ?? '',
    duration_s: a.duration_s ?? (n ? a.lanes!.t[n - 1] : words.length ? words[words.length - 1].end : 0),
    script: a.script ?? { script_id: null, title: 'Untitled', speaker: '', transcript: '' },
    quality: a.quality ?? {},
    summary: a.summary ?? {},
    style: { notes: [], ...(a.style ?? {}) },
    rubric: {
      dimensions: {},
      overall: 0,
      wsdc_style: 0,
      speaking_s: 0,
      formula: '',
      ...(a.rubric ?? {}),
    },
    cards: (a.cards ?? []).map((c) => ({
      ...c,
      ci_start: c.ci_start ?? null,
      ci_end: c.ci_end ?? null,
      confidence: c.confidence ?? null,
      word_span: c.word_span ?? [0, -1],
      words: c.words ?? '',
      evidence: c.evidence ?? [],
      math: c.math ?? [],
      stats: { z: NaN, p: NaN, q: NaN, family: '', window_words: 0, ...((c.stats as Partial<FlawCard['stats']> | undefined) ?? {}) },
    })),
    words,
    lanes: { t: a.lanes?.t ?? [], f0_st: pad(a.lanes?.f0_st), int_rel: pad(a.lanes?.int_rel), cpp: a.lanes?.cpp ? pad(a.lanes.cpp) : undefined },
    reference: { ref_ids: [], n_refs: 0, word_spans: [], duration_s: 0, ...(a.reference ?? {}) },
    tests: { n_tests: 0, n_rejected: 0, n_flagged: 0, fdr_q: 0.05, df: NaN, by_family: {}, ...(a.tests ?? {}) },
    fingerprint: { id: a.analysis_id, audio_sha256: '', config: '', model: '', code: '', baseline: '', ...(a.fingerprint ?? {}) },
  };
}

export const sampleAnalysis = normalizeAnalysis(sampleAnalysisJson as unknown as Analysis);
export const fixtureScripts = scriptsJson as unknown as ScriptInfo[];
export const fixtureAssignment = assignmentJson as unknown as StudioAssignment;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

/** Parse JSON, tolerating bare NaN / Infinity tokens that Python's json module can emit. */
export function parseJsonLenient<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const fixed = text.replace(/([:,[]\s*)-?(?:NaN|Infinity)(?=\s*[,\]}])/g, '$1null');
    return JSON.parse(fixed) as T;
  }
}

function detailOf(body: string, fallback: string): string {
  try {
    const j = JSON.parse(body) as { detail?: unknown };
    if (typeof j.detail === 'string') return j.detail;
    if (Array.isArray(j.detail)) {
      return j.detail
        .map((d: { msg?: string; loc?: unknown[] }) => (d.msg ? `${d.msg}${d.loc ? ` (${d.loc.join('.')})` : ''}` : ''))
        .filter(Boolean)
        .join('; ');
    }
  } catch {
    /* not JSON */
  }
  return body && body.length < 300 ? body : fallback;
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController();
  const timer = init?.timeoutMs ? window.setTimeout(() => ctrl.abort(), init.timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, signal: init?.signal ?? ctrl.signal });
  } catch (e) {
    throw new ApiError(0, e instanceof Error && e.name === 'AbortError' ? 'The request timed out.' : 'Cannot reach the SHRUTI API.');
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, detailOf(text, `${res.status} ${res.statusText}`));
  // A dev server without the API proxied returns index.html for /v1/*: treat that as offline.
  if (text.trimStart().startsWith('<')) throw new ApiError(0, 'Cannot reach the SHRUTI API.');
  return parseJsonLenient<T>(text);
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Multipart POST with upload progress (fetch has no upload progress events). */
export function postForm<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.upload.onload = () => onProgress?.(1);
    xhr.onerror = () => reject(new ApiError(0, 'Cannot reach the SHRUTI API.'));
    xhr.ontimeout = () => reject(new ApiError(0, 'The request timed out.'));
    xhr.onload = () => {
      const text = xhr.responseText ?? '';
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(parseJsonLenient<T>(text));
        } catch {
          reject(new ApiError(xhr.status, 'The server returned an unreadable response.'));
        }
      } else {
        reject(new ApiError(xhr.status, detailOf(text, `${xhr.status} ${xhr.statusText}`)));
      }
    };
    xhr.send(form);
  });
}

// ----------------------------------------------------------------------------- meta
export const getHealth = () => request<Health>('/health', { timeoutMs: 3500 });
export const getVersion = () => request<VersionInfo>('/version', { timeoutMs: 5000 });

// ----------------------------------------------------------------------------- scripts
export const getScripts = () => request<ScriptInfo[]>('/scripts');
export const scriptAudioUrl = (sid: string) => `${API_BASE}/scripts/${encodeURIComponent(sid)}/audio`;

// ----------------------------------------------------------------------------- analyses
const analysisCache = new Map<string, Analysis>();

export function cacheAnalysis(a: Analysis) {
  analysisCache.set(a.analysis_id, normalizeAnalysis(a));
}

export interface LoadedAnalysis {
  analysis: Analysis;
  /** 'api' when served by the backend (audio available), 'fixture' for the bundled offline sample. */
  source: 'api' | 'fixture';
}

export async function getAnalysis(id: string, online: boolean): Promise<LoadedAnalysis> {
  const isSample = id === SAMPLE_ID || id === sampleAnalysis.analysis_id;
  const cached = analysisCache.get(id);
  if (cached) return { analysis: cached, source: 'api' };
  if (!online) {
    if (isSample) return { analysis: sampleAnalysis, source: 'fixture' };
    throw new ApiError(0, 'The SHRUTI API is offline, so only the bundled sample analysis can be shown.');
  }
  try {
    const a = normalizeAnalysis(await request<Analysis>(`/analyses/${encodeURIComponent(isSample ? sampleAnalysis.analysis_id : id)}`));
    cacheAnalysis(a);
    return { analysis: a, source: 'api' };
  } catch (e) {
    if (isSample) return { analysis: sampleAnalysis, source: 'fixture' };
    throw e;
  }
}

export interface AnalysisUpload {
  audio: Blob;
  filename: string;
  scriptId?: string;
  transcript?: string;
  reference?: Blob;
  referenceName?: string;
  bootstrap?: boolean;
}

export async function createAnalysis(u: AnalysisUpload, onProgress?: (f: number) => void): Promise<Analysis> {
  const form = new FormData();
  form.append('audio', u.audio, u.filename);
  if (u.scriptId) form.append('script_id', u.scriptId);
  if (u.transcript) form.append('transcript', u.transcript);
  if (u.reference) form.append('reference', u.reference, u.referenceName ?? 'reference.wav');
  form.append('bootstrap', String(u.bootstrap ?? true));
  const a = normalizeAnalysis(await postForm<Analysis>('/analyses', form, onProgress));
  cacheAnalysis(a);
  return a;
}

export type AudioTrack = 'user' | 'reference' | 'duet' | 'ghost';

export function analysisAudioUrl(
  id: string,
  track: AudioTrack,
  opts: { flaw?: string; start?: number; end?: number } = {},
): string {
  const q = new URLSearchParams({ track });
  if (opts.flaw) q.set('flaw', opts.flaw);
  if (opts.start != null) q.set('start', opts.start.toFixed(3));
  if (opts.end != null) q.set('end', opts.end.toFixed(3));
  return `${API_BASE}/analyses/${encodeURIComponent(id)}/audio?${q.toString()}`;
}

export const postGhost = (id: string, body: GhostRequest) =>
  postJson<GhostResponse>(`/analyses/${encodeURIComponent(id)}/ghost`, { counterfactual: true, ...body });

export function postDrill(id: string, flawId: string, audio: Blob, filename: string, onProgress?: (f: number) => void) {
  const form = new FormData();
  form.append('flaw_id', flawId);
  form.append('audio', audio, filename);
  return postForm<DrillResponse>(`/analyses/${encodeURIComponent(id)}/drill`, form, onProgress);
}

// ----------------------------------------------------------------------------- judge mode
export const getDemos = () => request<Demo[]>('/demos');

// ----------------------------------------------------------------------------- benchmark
export const getBenchSeries = (sid: string) => request<BenchRow[]>(`/bench/series?script_id=${encodeURIComponent(sid)}`);
export const benchAudioUrl = (renderId: string) => `${API_BASE}/bench/audio/${encodeURIComponent(renderId)}`;
export const getEval = () => request<EvalSummary>('/eval');
export const evalFigureUrl = (name: string) => `${API_BASE}/eval/figure/${encodeURIComponent(name)}`;

export async function fetchBlob(url: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError(0, 'Cannot reach the SHRUTI API.');
  }
  if (!res.ok) throw new ApiError(res.status, detailOf(await res.text(), `${res.status} ${res.statusText}`));
  return res.blob();
}

// ----------------------------------------------------------------------------- Flaw Studio
export const getAssignment = (speakerId: string) =>
  request<StudioAssignment>(`/studio/assignment?speaker_id=${encodeURIComponent(speakerId)}`);
export const postConsent = (body: ConsentRequest) => postJson<Record<string, unknown>>('/studio/consent', body);

export function postTake(
  audio: Blob,
  filename: string,
  meta: { speaker_id: string; task_id: string; script_id: string; kind: string; instruction: unknown },
  onProgress?: (f: number) => void,
) {
  const form = new FormData();
  form.append('audio', audio, filename);
  form.append('meta', JSON.stringify(meta));
  return postForm<StudioTake>('/studio/takes', form, onProgress);
}

export const getTakes = () => request<StudioTake[]>('/studio/takes');
export const takeAudioUrl = (takeId: string) => `${API_BASE}/studio/takes/${encodeURIComponent(takeId)}/audio`;
export const postReview = (takeId: string, body: ReviewRequest) =>
  postJson<StudioTake>(`/studio/takes/${encodeURIComponent(takeId)}/review`, body);

// ----------------------------------------------------------------------------- adjudicator study
export const getStudyClips = (raterId: string) => request<StudyClip[]>(`/study/clips?rater_id=${encodeURIComponent(raterId)}`);
export const studyAudioUrl = (clipId: string) => `${API_BASE}/study/audio/${encodeURIComponent(clipId)}`;
export const postStudyResponse = (body: StudyResponse) => postJson<{ ok: boolean }>('/study/responses', body);

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
