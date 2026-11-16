import { useSyncExternalStore } from 'react';

export type SoundName =
  | 'flipCreated'
  | 'flipJoined'
  | 'coinSpin'
  | 'coinLand'
  | 'flipWin'
  | 'jpJoin'
  | 'jpCountdown'
  | 'jpTick'
  | 'jpSpin'
  | 'jpWin';

const KEY = 'dw-sound';
const MASTER = 0.35;
const MAX_VOICES = 3;

let enabled = false;
try {
  enabled = localStorage.getItem(KEY) === '1';
} catch {
  /* storage unavailable */
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function soundEnabled(): boolean {
  return enabled;
}

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribe, soundEnabled, () => false);
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function getCtx(): AudioContext | null {
  try {
    if (ctx) return ctx;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MASTER;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (on) {
    const c = getCtx();
    try {
      void c?.resume().catch(() => {});
    } catch {
      /* ignore */
    }
  }
  emit();
}

// ---------- synthesis helpers ----------

type Out = AudioNode;

function env(c: AudioContext, out: Out, t: number, peak: number, attack: number, dur: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  return g;
}

function tone(
  c: AudioContext,
  out: Out,
  t: number,
  freq: number,
  dur: number,
  peak: number,
  type: OscillatorType = 'sine',
  attack = 0.004,
  freqEnd?: number,
): void {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  o.connect(env(c, out, t, peak, attack, dur));
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = Math.floor(c.sampleRate * 1.5);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = b;
  return b;
}

function noiseBurst(
  c: AudioContext,
  out: Out,
  t: number,
  dur: number,
  peak: number,
  f0: number,
  f1: number,
  q: number,
  attack = 0.005,
  type: BiquadFilterType = 'bandpass',
): void {
  const s = c.createBufferSource();
  s.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  s.connect(f);
  f.connect(env(c, out, t, peak, attack, dur));
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

// ---------- sound definitions: (ctx, out, t0) => duration seconds ----------

const DEFS: Record<SoundName, (c: AudioContext, o: Out, t: number) => number> = {
  flipCreated(c, o, t) {
    tone(c, o, t, 2200, 0.16, 0.22);
    tone(c, o, t + 0.035, 3300, 0.12, 0.14);
    tone(c, o, t, 4400, 0.05, 0.05);
    return 0.2;
  },
  flipJoined(c, o, t) {
    tone(c, o, t, 523.25, 0.18, 0.22, 'triangle', 0.008);
    tone(c, o, t + 0.09, 783.99, 0.28, 0.24, 'triangle', 0.008);
    tone(c, o, t + 0.09, 1567.98, 0.2, 0.05);
    return 0.4;
  },
  coinSpin(c, o, t) {
    tone(c, o, t, 3000, 0.14, 0.2);
    tone(c, o, t, 4500, 0.08, 0.08);
    noiseBurst(c, o, t + 0.04, 0.8, 0.16, 1800, 7000, 3, 0.2);
    tone(c, o, t + 0.1, 1400, 0.7, 0.025, 'sine', 0.25, 2600);
    return 0.9;
  },
  coinLand(c, o, t) {
    noiseBurst(c, o, t, 0.06, 0.4, 4000, 2500, 1.2, 0.002);
    tone(c, o, t, 120, 0.22, 0.5, 'sine', 0.004, 70);
    tone(c, o, t, 2650, 0.5, 0.1);
    tone(c, o, t, 3980, 0.3, 0.05);
    return 0.55;
  },
  flipWin(c, o, t) {
    [523.25, 659.25, 783.99].forEach((f, i) => {
      tone(c, o, t + i * 0.13, f, 0.3, 0.2, 'triangle', 0.01);
      tone(c, o, t + i * 0.13, f * 2, 0.2, 0.05);
    });
    return 0.65;
  },
  jpJoin(c, o, t) {
    tone(c, o, t, 880, 0.1, 0.18, 'sine', 0.006);
    tone(c, o, t + 0.05, 1318.5, 0.14, 0.12, 'sine', 0.006);
    return 0.2;
  },
  jpCountdown(c, o, t) {
    tone(c, o, t, 220, 0.4, 0.14, 'triangle', 0.2, 440);
    noiseBurst(c, o, t, 0.4, 0.08, 600, 3500, 1.5, 0.25);
    tone(c, o, t + 0.28, 880, 0.14, 0.1);
    return 0.45;
  },
  jpTick(c, o, t) {
    tone(c, o, t, 1000, 0.03, 0.12, 'sine', 0.002, 700);
    noiseBurst(c, o, t, 0.012, 0.05, 2500, 2000, 2, 0.001);
    return 0.04;
  },
  jpSpin(c, o, t) {
    const dur = 1.2;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + dur);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + dur);
    osc.connect(f);
    f.connect(env(c, o, t, 0.1, 0.15, dur));
    osc.start(t);
    osc.stop(t + dur + 0.02);
    // accelerating ratchet clicks
    let at = 0;
    let gap = 0.13;
    while (at < dur - 0.05) {
      noiseBurst(c, o, t + at, 0.015, 0.07, 3000, 2200, 2, 0.001);
      at += gap;
      gap = Math.max(0.035, gap * 0.88);
    }
    return dur + 0.05;
  },
  jpWin(c, o, t) {
    [261.63, 329.63, 392, 523.25].forEach((f, i) => {
      tone(c, o, t + i * 0.025, f, 1.2, 0.14, 'triangle', 0.02);
      tone(c, o, t + i * 0.025, f * 2, 0.9, 0.04, 'sine', 0.02);
    });
    [1568, 2093, 2637, 3136, 2349].forEach((f, i) => {
      tone(c, o, t + 0.25 + i * 0.1, f, 0.35, 0.05);
    });
    return 1.45;
  },
};

// ---------- playback guards ----------

const played = new Set<string>();
const lastAt = new Map<SoundName, number>();
let voices = 0;

export function play(name: SoundName, eventId?: string): void {
  try {
    if (!enabled) return;
    const key = eventId != null ? `${name}:${eventId}` : null;
    if (key && played.has(key)) return;

    const now = performance.now();
    const gap = name === 'jpTick' ? 300 : 120;
    const last = lastAt.get(name);
    if (last !== undefined && now - last < gap) return;
    if (voices >= MAX_VOICES) return;

    const c = getCtx();
    if (!c || !master) return;
    if (c.state !== 'running') {
      void c.resume().catch(() => {});
      // resume() is async; if it isn't running yet, skip this sound rather than queue it late.
      if ((c.state as AudioContextState) !== 'running') return;
    }

    if (key) {
      played.add(key);
      if (played.size > 500) {
        const first = played.values().next().value;
        if (first !== undefined) played.delete(first);
      }
    }
    lastAt.set(name, now);

    voices++;
    const dur = DEFS[name](c, master, c.currentTime + 0.01);
    window.setTimeout(() => {
      voices = Math.max(0, voices - 1);
    }, Math.ceil(dur * 1000) + 40);
  } catch {
    /* never throw */
  }
}
