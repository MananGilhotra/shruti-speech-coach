/* Typed shapes of every SHRUTI API response the dashboard consumes.
 * Optional/nullable fields mirror what the backend may omit; the UI never assumes they exist. */

export const DIMENSIONS = [
  'pacing',
  'pausing',
  'intonation',
  'projection',
  'fluency',
  'clarity',
  'emphasis',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const FLAW_TYPES = [
  'rushed',
  'dragged',
  'long_pause',
  'missing_pause',
  'monotone',
  'volume_fade',
  'mumble',
  'filler',
  'stutter',
  'misplaced_emphasis',
] as const;
export type FlawType = (typeof FLAW_TYPES)[number];

export const FIX_OPTIONS = ['duration', 'pause', 'pitch', 'intensity', 'brightness', 'cut'] as const;
export type FixOption = (typeof FIX_OPTIONS)[number];

// ----------------------------------------------------------------------------- meta
export interface Health {
  status: string;
  version: string;
}

export interface VersionInfo {
  version: string;
  config_hash: string;
  model: string;
}

// ----------------------------------------------------------------------------- scripts
export interface ScriptInfo {
  script_id: string;
  title: string;
  speaker: string;
  year: number;
  transcript: string;
  duration_s: number | null;
  n_refs: number;
  split: 'dev' | 'test' | string;
  license: string;
  commons_page: string;
}

// ----------------------------------------------------------------------------- analysis
export interface AnalysisScript {
  script_id: string | null;
  title: string;
  speaker: string;
  transcript: string;
}

export interface Quality {
  duration_s?: number;
  clipped_fraction?: number;
  asr_wer?: number | null;
  asr_words?: number;
  warning?: string;
  [k: string]: unknown;
}

export interface Summary {
  n_words?: number;
  n_syl?: number;
  articulation_rate?: number;
  speech_rate?: number;
  total_pause_s?: number;
  n_pauses?: number;
  f0_median_hz?: number;
  f0_floor?: number;
  f0_ceiling?: number;
  intensity_ref_db?: number;
  f0_range_st?: number;
  speech_start?: number;
  speech_end?: number;
  [k: string]: number | undefined;
}

export interface StyleInfo {
  tempo_factor?: number;
  pitch_range_ratio?: number;
  notes: string[];
}

export interface RubricDimension {
  label: string;
  score: number;
  flaw_penalty: number;
  style_penalty: number;
  flaws: string[];
}

export interface Rubric {
  dimensions: Partial<Record<Dimension, RubricDimension>>;
  overall: number;
  wsdc_style: number;
  speaking_s: number;
  formula: string;
}

export interface Evidence {
  feature: string;
  unit: string;
  yours: number | null;
  expected: number | null;
}

export interface CardStats {
  z: number;
  p: number;
  q: number;
  family: string;
  window_words: number;
}

export interface FlawCard {
  id: string;
  type: FlawType | string;
  title: string;
  dimension: Dimension | string;
  severity: number;
  t_start: number;
  t_end: number;
  ci_start: [number, number] | null;
  ci_end: [number, number] | null;
  confidence: number | null;
  word_span: [number, number];
  words: string;
  headline: string;
  explanation: string;
  fix: string;
  evidence: Evidence[];
  stats: CardStats;
  math: string[];
}

export interface RefStat {
  m: number;
  sd: number;
}

export interface WordRef {
  f0_med_st: RefStat | null;
  int_med_db: RefStat | null;
  dur: number | null;
  pause_after: number | null;
}

export interface Word {
  i: number;
  word: string;
  start: number;
  end: number;
  n_syl: number;
  pause_after: number | null;
  f0_med_st: number | null;
  int_med_db: number | null;
  rate: number | null;
  prominence: number | null;
  ref: WordRef | null;
}

export interface Lanes {
  t: number[];
  f0_st: (number | null)[];
  int_rel: (number | null)[];
  cpp?: (number | null)[];
}

export interface ReferenceInfo {
  ref_ids: string[];
  n_refs: number;
  word_spans: [number, number][];
  duration_s: number;
}

export interface TestsInfo {
  n_tests: number;
  n_rejected: number;
  n_flagged: number;
  fdr_q: number;
  df: number;
  by_family: Record<string, number>;
}

export interface Fingerprint {
  id: string;
  audio_sha256: string;
  config: string;
  model: string;
  code: string;
  baseline: string;
}

export interface Analysis {
  analysis_id: string;
  version: string;
  mode: string;
  script: AnalysisScript;
  duration_s: number;
  quality: Quality;
  summary: Summary;
  style: StyleInfo;
  rubric: Rubric;
  cards: FlawCard[];
  words: Word[];
  lanes: Lanes;
  reference: ReferenceInfo;
  tests: TestsInfo;
  dimensions?: string[];
  fingerprint: Fingerprint;
  elapsed_s?: number;
  demo?: DemoInfo;
}

// ----------------------------------------------------------------------------- coach
export interface GhostRequest {
  flaw_id: string;
  fixes?: FixOption[];
  blend?: number;
  counterfactual?: boolean;
}

export interface GhostResponse {
  flaw: string;
  fixes: string[];
  blend: number;
  region_out: [number, number];
  duration_s: number;
  audio_url: string;
  counterfactual?: {
    fixes: string[];
    flag_cleared: boolean;
    sentence: string;
  };
}

export interface DrillResponse {
  flaw_id: string;
  cleared: boolean;
  remaining: FlawCard[];
  phrase_window: [number, number];
  overall_before: number;
  overall_after: number;
  dimension: Dimension | string;
  dim_before: number;
  dim_after: number;
}

// ----------------------------------------------------------------------------- judge mode
export interface Demo {
  id: string;
  title: string;
  description?: string;
  analysis_id: string;
  script_id?: string;
  n_flags?: number;
  n_injected?: number;
  overall?: number;
}

/** Present on pre-computed Judge Mode analyses built from SHRUTI-Bench renders. */
export interface DemoInfo {
  render_id?: string;
  title?: string;
  description?: string;
  labels?: BenchLabel[];
}

// ----------------------------------------------------------------------------- benchmark
export interface BenchLabel {
  flaw_id?: string;
  type: FlawType | string;
  t_start: number;
  t_end: number;
  level?: number;
  param?: number;
  words?: [number, number];
  [k: string]: unknown;
}

export interface BenchRow {
  render_id: string;
  script_id: string;
  layer: string;
  level: number;
  labels: BenchLabel[];
  duration_s: number;
  bundle?: string[];
  split?: string;
}

export interface PRF {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  tp?: number;
  fp?: number;
  fn?: number;
}

export interface EvalSplit {
  n_files?: number;
  iou_threshold?: number;
  micro?: PRF;
  micro_ci?: { precision?: [number, number]; recall?: [number, number]; f1?: [number, number] };
  macro_f1?: number | null;
  per_type?: Record<string, PRF>;
  boundary_ms?: {
    start_median?: number | null;
    end_median?: number | null;
    start_p90?: number | null;
    end_p90?: number | null;
    mean_iou?: number | null;
  };
  psychometric?: Record<string, { rates: Record<string, number>; L50: number | null; slope: number | null }>;
  false_flags?: Record<
    string,
    { files: number; flags: number; minutes: number; per_minute: number | null; files_with_any_flag: number }
  >;
  gradient?: { series?: number; spearman_median?: number | null; spearman_all?: number[] };
  robustness?: Record<string, PRF>;
  by_iou?: Record<string, PRF>;
  confusion?: Record<string, Record<string, number>>;
  errors?: string[];
}

export interface EvalSummary {
  dev?: EvalSplit;
  test?: EvalSplit;
  figures?: string[];
  [k: string]: unknown;
}

// ----------------------------------------------------------------------------- Flaw Studio
export interface StudioInstruction {
  text: string;
  type?: FlawType | string;
  severity?: 'mild' | 'strong' | string;
  words?: [number, number];
  key_word?: number | null;
}

export interface StudioTask {
  task_id: string;
  script_id: string;
  kind: 'good' | 'flawed' | string;
  instruction: StudioInstruction;
}

export interface StudioAssignment {
  speaker_id: string;
  consent_version: string;
  tasks: StudioTask[];
}

export interface ConsentRequest {
  speaker_id: string;
  accepted: true;
  age_ok: true;
  first_language?: string;
  accent_region?: string;
  gender?: string;
  device?: string;
  age_band?: string;
}

export interface StudioTake {
  take_id: string;
  speaker_id: string;
  task_id: string;
  script_id: string;
  kind: string;
  instruction?: StudioInstruction;
  duration_s?: number;
  sha256?: string;
  uploaded?: number;
  status: 'pending' | 'accepted' | 'rejected' | string;
  proposed_label?: { t_start: number; t_end: number };
  label?: { t_start: number; t_end: number };
  asr_wer?: number | null;
  alignment_error?: string;
  reviews?: { verdict: string; reviewer: string; note?: string; timestamp?: number }[];
}

export interface ReviewRequest {
  verdict: 'accepted' | 'rejected';
  reviewer: string;
  label?: { t_start: number; t_end: number };
  note?: string;
}

// ----------------------------------------------------------------------------- adjudicator study
export interface StudyClip {
  clip_id: string;
  title?: string;
  duration_s?: number;
  script_id?: string;
}

export interface StudyMark {
  t: number;
  type: string;
}

export interface StudyResponse {
  rater_id: string;
  clip_id: string;
  scores: Record<Dimension | 'overall', number>;
  marks: StudyMark[];
  confidence: number;
  comment: string;
}
