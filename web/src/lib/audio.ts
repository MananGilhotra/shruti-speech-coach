/* Browser audio helpers: decode any recording/upload and re-encode it as 16 kHz mono PCM WAV,
 * so the backend never needs ffmpeg for browser codecs (webm/opus, mp4/aac). */

export const TARGET_SR = 16000;

function getAudioContextCtor(): typeof AudioContext | null {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function createAudioContext(): AudioContext | null {
  const Ctor = getAudioContextCtor();
  return Ctor ? new Ctor() : null;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Decode a recorded/uploaded blob and return a 16 kHz mono WAV blob plus its duration. */
export async function toWav16k(blob: Blob): Promise<{ wav: Blob; duration: number }> {
  const ctx = createAudioContext();
  if (!ctx) throw new Error('Web Audio is not available in this browser.');
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * TARGET_SR));
    const offline = new OfflineAudioContext(1, length, TARGET_SR);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination); // down-mixes to mono
    src.start();
    const rendered = await offline.startRendering();
    return { wav: encodeWav(rendered.getChannelData(0), TARGET_SR), duration: decoded.duration };
  } finally {
    void ctx.close();
  }
}

/** True when the blob is already a 16 kHz mono 16-bit PCM WAV (nothing to convert). */
async function isWav16kMono(blob: Blob): Promise<boolean> {
  if (blob.size < 44) return false;
  const h = new DataView(await blob.slice(0, 44).arrayBuffer());
  const tag = (o: number) => String.fromCharCode(h.getUint8(o), h.getUint8(o + 1), h.getUint8(o + 2), h.getUint8(o + 3));
  return (
    tag(0) === 'RIFF' &&
    tag(8) === 'WAVE' &&
    h.getUint16(20, true) === 1 &&
    h.getUint16(22, true) === 1 &&
    h.getUint32(24, true) === TARGET_SR &&
    h.getUint16(34, true) === 16
  );
}

/** Best-effort conversion: falls back to the original blob if the browser cannot decode it. */
export async function prepareUpload(blob: Blob, baseName: string): Promise<{ blob: Blob; filename: string; duration: number | null }> {
  try {
    if (await isWav16kMono(blob)) return { blob, filename: `${baseName}.wav`, duration: (blob.size - 44) / (2 * TARGET_SR) };
    const { wav, duration } = await toWav16k(blob);
    return { blob: wav, filename: `${baseName}.wav`, duration };
  } catch {
    const ext = extensionFor(blob.type) ?? 'webm';
    return { blob, filename: `${baseName}.${ext}`, duration: null };
  }
}

function extensionFor(mime: string): string | null {
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('flac')) return 'flac';
  return null;
}

/** Pick a MediaRecorder container the browser supports. */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

/** A symmetric pseudo-waveform from the relative-intensity lane (dB), for when audio is unavailable. */
export function envelopeFromIntensity(intRel: (number | null)[]): number[] {
  const amps = intRel.map((v) => (v == null || !Number.isFinite(v) ? 0 : Math.pow(10, Math.max(-40, v) / 20)));
  const max = Math.max(1e-6, ...amps);
  const out: number[] = [];
  for (const a of amps) {
    const v = a / max;
    out.push(v, -v);
  }
  return out;
}
