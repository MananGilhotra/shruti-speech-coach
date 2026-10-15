/* Microphone capture with MediaRecorder plus a live level analyser (RMS/peak in dBFS). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioContext, pickRecorderMime, toWav16k } from './audio';

export type RecorderStatus = 'idle' | 'requesting' | 'monitoring' | 'recording' | 'stopped' | 'error';

export interface LevelReading {
  rmsDb: number;
  peak: number;
}

export interface Recorder {
  status: RecorderStatus;
  error: string | null;
  elapsed: number;
  blob: Blob | null;
  url: string | null;
  supported: boolean;
  /** Open the microphone without recording (mic check). */
  openMic: () => Promise<boolean>;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
  reset: () => void;
  close: () => void;
  getLevel: () => LevelReading | null;
}

export function useRecorder(maxSeconds = 120): Recorder {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const t0Ref = useRef(0);
  const timerRef = useRef(0);
  const stopResolveRef = useRef<((b: Blob | null) => void) | null>(null);
  const urlRef = useRef<string | null>(null);

  const supported =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  const close = useCallback(() => {
    window.clearInterval(timerRef.current);
    if (recRef.current && recRef.current.state !== 'inactive') {
      try {
        recRef.current.stop();
      } catch {
        /* already stopped */
      }
    }
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (ctxRef.current) void ctxRef.current.close().catch(() => undefined);
    ctxRef.current = null;
  }, []);

  useEffect(
    () => () => {
      close();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [close],
  );

  const openMic = useCallback(async (): Promise<boolean> => {
    if (streamRef.current) return true;
    if (!supported) {
      setError('This browser cannot record audio. Use a recent Chrome, Edge, Firefox or Safari — or upload a file.');
      setStatus('error');
      return false;
    }
    setStatus('requesting');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      streamRef.current = stream;
      const ctx = createAudioContext();
      if (ctx) {
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        src.connect(an);
        ctxRef.current = ctx;
        analyserRef.current = an;
        bufRef.current = new Float32Array(an.fftSize);
        if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
      }
      setStatus('monitoring');
      return true;
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in the browser’s address bar, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found. Plug one in, or upload a recording instead.'
            : `Could not open the microphone (${e instanceof Error ? e.message : String(e)}).`,
      );
      setStatus('error');
      return false;
    }
  }, [supported]);

  const stop = useCallback((): Promise<Blob | null> => {
    const rec = recRef.current;
    window.clearInterval(timerRef.current);
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      rec.stop();
    });
  }, []);

  const start = useCallback(async () => {
    const ok = await openMic();
    if (!ok || !streamRef.current) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setUrl(null);
    setBlob(null);
    chunksRef.current = [];
    const mime = pickRecorderMime();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(streamRef.current, { mimeType: mime }) : new MediaRecorder(streamRef.current);
    } catch (e) {
      setError(`Recording is not supported here (${e instanceof Error ? e.message : String(e)}).`);
      setStatus('error');
      return;
    }
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      const raw = new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' });
      // Convert to 16 kHz mono WAV right away: previews then show a real duration and seek
      // properly (browser webm recordings have no duration header), and the upload needs no ffmpeg.
      const finish = (b: Blob) => {
        const u = URL.createObjectURL(b);
        urlRef.current = u;
        setBlob(b);
        setUrl(u);
        setStatus('stopped');
        stopResolveRef.current?.(b);
        stopResolveRef.current = null;
      };
      toWav16k(raw)
        .then(({ wav }) => finish(wav))
        .catch(() => finish(raw));
    };
    recRef.current = rec;
    rec.start(250);
    t0Ref.current = performance.now();
    setElapsed(0);
    setStatus('recording');
    window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      const s = (performance.now() - t0Ref.current) / 1000;
      setElapsed(s);
      if (s >= maxSeconds) void stop();
    }, 100);
  }, [openMic, maxSeconds, stop]);

  const reset = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setUrl(null);
    setBlob(null);
    setElapsed(0);
    setStatus(streamRef.current ? 'monitoring' : 'idle');
  }, []);

  const getLevel = useCallback((): LevelReading | null => {
    const an = analyserRef.current;
    const buf = bufRef.current;
    if (!an || !buf) return null;
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / buf.length);
    return { rmsDb: 20 * Math.log10(rms + 1e-9), peak };
  }, []);

  return { status, error, elapsed, blob, url, supported, openMic, start, stop, reset, close, getLevel };
}
