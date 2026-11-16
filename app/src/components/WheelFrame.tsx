// The jackpot wheel's frame: a hammered-gold treasure bezel with rivets and rubies, a gold hub
// ring, a gold blade pointer and the lighting/grain over the colored ring. One source for the live
// wheel and the replay so they always match. Coordinates are the 400x400 wheel viewBox.
// All texture is generated with SVG filters (no image files).
import { C, R_IN, R_OUT, polar } from './JackpotPage';
import { Coin } from './Coin';
import { vaultFill } from '../visualTiers';


/** Gradients, textures and filters the wheel uses. Render once inside each wheel's <svg>. */
export function WheelDefs() {
  return (
    <defs>
      {/* --- gold --- */}
      <linearGradient id="jp-gold-band" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff4c8" />
        <stop offset=".16" stopColor="#f2c14e" />
        <stop offset=".32" stopColor="#9c6a14" />
        <stop offset=".5" stopColor="#ffe08a" />
        <stop offset=".68" stopColor="#b07a1c" />
        <stop offset=".84" stopColor="#f5cf6a" />
        <stop offset="1" stopColor="#6e4a0e" />
      </linearGradient>
      <linearGradient id="jp-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff1b8" />
        <stop offset=".5" stopColor="#ffd166" />
        <stop offset="1" stopColor="#d9a12a" />
      </linearGradient>
      <radialGradient id="jp-rivet" cx="35%" cy="30%" r="75%">
        <stop offset="0" stopColor="#fffbe6" />
        <stop offset=".35" stopColor="#f5cf6a" />
        <stop offset="1" stopColor="#5e3f0a" />
      </radialGradient>
      <radialGradient id="jp-ruby" cx="35%" cy="30%" r="80%">
        <stop offset="0" stopColor="#ffc2c5" />
        <stop offset=".3" stopColor="#ff3038" />
        <stop offset=".75" stopColor="#8a0710" />
        <stop offset="1" stopColor="#3d0206" />
      </radialGradient>
      <linearGradient id="jp-blade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#7a5412" />
        <stop offset=".45" stopColor="#ffe08a" />
        <stop offset=".55" stopColor="#f2c14e" />
        <stop offset="1" stopColor="#6e4a0e" />
      </linearGradient>
      {/* hammered-metal relief: noise lit by a light from the top-left, kept inside the shape */}
      <filter id="jp-hammered" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="7" result="n" />
        <feDiffuseLighting in="n" surfaceScale="2.2" lightingColor="#fff" result="lit">
          <feDistantLight azimuth="225" elevation="48" />
        </feDiffuseLighting>
        <feComposite in="lit" in2="SourceGraphic" operator="in" result="litIn" />
        <feBlend in="SourceGraphic" in2="litIn" mode="multiply" result="m" />
        <feComposite in="m" in2="SourceGraphic" operator="in" />
      </filter>
      {/* fine grain for the colored slices and the empty velvet ring */}
      <filter id="jp-grain" filterUnits="userSpaceOnUse" x="0" y="0" width="400" height="400">
        <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="3" result="g" />
        <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0" result="a" />
        <feComposite in="a" in2="SourceGraphic" operator="in" />
      </filter>
      <radialGradient id="jp-velvet" gradientUnits="userSpaceOnUse" cx={C} cy={C} r={R_OUT}>
        <stop offset={R_IN / R_OUT} stopColor="#1a0608" />
        <stop offset=".8" stopColor="#3a0c10" />
        <stop offset="1" stopColor="#140405" />
      </radialGradient>
      {/* --- light over the colored ring --- */}
      <radialGradient id="jp-depth" gradientUnits="userSpaceOnUse" cx={C} cy={C} r={R_OUT}>
        <stop offset={R_IN / R_OUT} stopColor="#000" stopOpacity=".55" />
        <stop offset=".72" stopColor="#000" stopOpacity="0" />
        <stop offset=".93" stopColor="#fff" stopOpacity=".08" />
        <stop offset="1" stopColor="#000" stopOpacity=".4" />
      </radialGradient>
      <linearGradient id="jp-light" gradientUnits="userSpaceOnUse" x1="40" y1="40" x2="360" y2="360">
        <stop offset="0" stopColor="#fff" stopOpacity=".35" />
        <stop offset=".4" stopColor="#fff" stopOpacity=".04" />
        <stop offset=".55" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity=".55" />
      </linearGradient>
      <radialGradient id="jp-hub" cx="50%" cy="38%" r="70%">
        <stop offset="0%" stopColor="#2a1408" />
        <stop offset="100%" stopColor="#0a0605" />
      </radialGradient>
      {/* one Heads coin (same art as coinflip), reused for the hub's coin pile */}
      <symbol id="jp-coin-sym" viewBox="0 0 100 100">
        <Coin side={0} />
      </symbol>
      {/* the shine that sweeps across the wheel */}
      <linearGradient id="jp-sheen-g" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff6d6" stopOpacity="0" />
        <stop offset=".42" stopColor="#ffe08a" stopOpacity=".12" />
        <stop offset=".5" stopColor="#ffffff" stopOpacity=".42" />
        <stop offset=".58" stopColor="#ffe08a" stopOpacity=".12" />
        <stop offset="1" stopColor="#fff6d6" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="jp-coin-edge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#5e3f0a" />
        <stop offset=".25" stopColor="#c98a1d" />
        <stop offset=".5" stopColor="#ffe08a" />
        <stop offset=".75" stopColor="#b07a1c" />
        <stop offset="1" stopColor="#4a3108" />
      </linearGradient>
      <linearGradient id="jp-liquid-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fffbe0" />
        <stop offset=".04" stopColor="#ffd84f" />
        <stop offset=".16" stopColor="#c9820e" />
        <stop offset=".3" stopColor="#ffd35a" />
        <stop offset=".38" stopColor="#e9a321" />
        <stop offset=".62" stopColor="#9c5e08" />
        <stop offset="1" stopColor="#4e2d03" />
      </linearGradient>
      <linearGradient id="jp-flow-g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="160" y2="60" spreadMethod="repeat">
        <stop offset="0" stopColor="#fff3b0" stopOpacity="0" />
        <stop offset=".45" stopColor="#fff3b0" stopOpacity=".22" />
        <stop offset=".55" stopColor="#fff3b0" stopOpacity=".22" />
        <stop offset="1" stopColor="#fff3b0" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="jp-bubble-g" cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor="#fff8d8" stopOpacity="0" />
        <stop offset=".62" stopColor="#fff8d8" stopOpacity=".08" />
        <stop offset=".88" stopColor="#fffbe8" stopOpacity=".75" />
        <stop offset="1" stopColor="#fffbe8" stopOpacity=".15" />
      </radialGradient>
      <linearGradient id="jp-glass-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".28" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <clipPath id="jp-liquid-clip">
        <rect x={0} y={4} width={400} height={420} />
      </clipPath>
      <clipPath id="jp-vault-clip">
        <circle cx={C} cy={C} r={R_OUT - 3} />
      </clipPath>
      <clipPath id="jp-hub-clip">
        <circle cx={C} cy={C} r={R_IN - 9} />
      </clipPath>
      <clipPath id="jp-wheel-clip">
        <circle cx={C} cy={C} r={R_OUT + 21} />
      </clipPath>
      <filter id="jp-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

// ---------------------------------------------------------------- the DegenWild "sticker" frame
// Like the logo: an irregular, hand-cut black silhouette with a thick white outline, and a
// red-orange chiseled band inside it. Seeded jitter, so it looks the same on every load.
const rnd = (i: number, seed: number) => {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
/** A jagged closed outline around the center: n corners, radius rBase..rBase+rVar, with the odd deep notch or spike. */
function jagged(rBase: number, rVar: number, n: number, seed: number, notch = 0): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360 + (rnd(i, seed) - 0.5) * (360 / n) * 0.55;
    let r = rBase + rnd(i + 99, seed) * rVar;
    const k = rnd(i + 199, seed);
    if (notch && k > 0.88) r -= notch; // a cut into the edge
    else if (notch && k < 0.08) r += notch * 0.8; // a sharp spike out
    const [x, y] = polar(r, a);
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d + 'Z';
}
/** A full circle as a path (for even-odd cut-outs). */
const circlePath = (r: number) => `M${C - r} ${C}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;

let FRAME: { outer: string; band: string; cuts: string[]; hub: string; hubBand: string } | null = null;
function frame() {
  if (FRAME) return FRAME;
  const cuts: string[] = [];
  // a few black chisel cuts through the orange band, like the slices in the WILD letters
  for (let i = 0; i < 9; i++) {
    const a = 20 + i * 40 + rnd(i, 5) * 18;
    const [x1, y1] = polar(R_OUT + 2, a);
    const [x2, y2] = polar(R_OUT + 17, a + 4 + rnd(i, 6) * 5);
    const [x3, y3] = polar(R_OUT + 17, a + 7 + rnd(i, 7) * 5);
    cuts.push(`M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}L${x3.toFixed(1)} ${y3.toFixed(1)}Z`);
  }
  FRAME = {
    outer: jagged(R_OUT + 22, 9, 38, 1, 9),
    band: jagged(R_OUT + 12, 6, 30, 2, 5) + circlePath(R_OUT + 1),
    cuts,
    hub: jagged(R_IN + 3, 5, 20, 3, 4),
    hubBand: jagged(R_IN - 2, 3, 18, 4, 2) + circlePath(R_IN - 7),
  };
  return FRAME;
}

/** The hand-cut sticker frame around the wheel (static: only the slices spin). */
export function WheelBezel() {
  const f = frame();
  return (
    <g className="jp-frame">
      <path d={f.outer} className="jp-frame-outer" />
      <path d={f.band} fillRule="evenodd" className="jp-frame-band" />
      {f.cuts.map((d, i) => (
        <path key={i} d={d} className="jp-frame-cut" />
      ))}
      <circle cx={C} cy={C} r={R_OUT + 1} className="jp-rim" />
    </g>
  );
}

/** The hub: an angular black plate with a white edge and an orange chiseled ring (content goes on top). */
export function WheelHub() {
  const f = frame();
  return (
    <>
      <path d={f.hub} className="jp-hub-plate" />
      <path d={f.hubBand} fillRule="evenodd" className="jp-frame-band hub" />
      <circle cx={C} cy={C} r={R_IN - 7} fill="url(#jp-hub)" className="jp-hub" />
    </>
  );
}

/** A hand-cut claw pointer: white sticker edge, black outline, orange blade. */
export function WheelPointer() {
  const d = `M${C - 17} 2 L${C + 13} 0 L${C + 15} 9 L${C + 6} 21 L${C + 2} 50 L${C - 4} 27 L${C - 13} 16 Z`;
  return (
    <g className="jp-pointer-g">
      <path d={d} className="jp-claw-edge" />
      <path d={d} className="jp-claw" />
      <path d={`M${C - 9} 6 L${C + 6} 5 L${C - 1} 14 Z`} className="jp-claw-cut" />
    </g>
  );
}

/** Lighting over the colored ring: depth toward the hub, a top-left light, grain and a rim highlight. */
export function WheelShading({ empty }: { empty?: boolean }) {
  if (empty) return null; // the empty velvet ring is already dark; lighting would wash it out
  const mid = (R_OUT + R_IN) / 2;
  const w = R_OUT - R_IN;
  return (
    <g className="jp-shading">
      <circle cx={C} cy={C} r={mid} fill="none" stroke="url(#jp-depth)" strokeWidth={w} />
      <circle cx={C} cy={C} r={mid} fill="none" stroke="url(#jp-light)" strokeWidth={w} />
      <circle cx={C} cy={C} r={R_OUT - 2} className="jp-ring-hi" />
    </g>
  );
}

/** A gold-white shine that sweeps across the whole wheel every few seconds. */
export function WheelSheen() {
  return (
    <g clipPath="url(#jp-wheel-clip)" className="jp-sheen" aria-hidden="true">
      <rect x={-140} y={-60} width={140} height={520} fill="url(#jp-sheen-g)" className="jp-sheen-bar" />
    </g>
  );
}

// ---------------------------------------------------------------- the vault: liquid gold behind glass
/**
 * Molten gold inside the wheel, behind the (glass) slices. Its level follows the pot: 2 SOL fills
 * the vault halfway (vaultFull in visualTiers). The surface waves; the level eases when it rises.
 */
// Bubbles drift in every direction at different depths, sizes and speeds (fixed seeds: same on every load).
const BUBBLES = Array.from({ length: 22 }, (_, i) => {
  const a = rnd(i, 21) * Math.PI * 2;
  const dist = 14 + rnd(i, 22) * 34;
  return {
    x: 0.06 + rnd(i, 23) * 0.88,
    depth: 8 + rnd(i, 24) * 150,
    size: 1.2 + rnd(i, 25) * 3.2,
    dx: Math.cos(a) * dist,
    dy: Math.sin(a) * dist * 0.7,
    dur: 3.2 + rnd(i, 26) * 4,
    delay: -rnd(i, 27) * 6,
  };
});

export function VaultLiquid({ total }: { total: bigint }) {
  const r = R_OUT - 2;
  const level = C + r - vaultFill(total) * 2 * r; // y of the surface
  // two wave layers, each twice the wheel's width so they can scroll seamlessly
  const wave = (amp: number, len: number, phase: number) => {
    let d = `M${C - r - len * 2} ${amp * Math.sin(phase)}`;
    for (let x = C - r - len * 2; x <= C + r + len * 2; x += 8) d += `L${x} ${(amp * Math.sin(((x / len) * Math.PI * 2) + phase)).toFixed(2)}`;
    return d + `L${C + r + len * 2} 420L${C - r - len * 2} 420Z`;
  };
  return (
    <g clipPath="url(#jp-vault-clip)" className="jp-vault" aria-hidden="true">
      <circle cx={C} cy={C} r={r} fill="#0b0605" />
      <g className="jp-liquid" style={{ transform: `translateY(${level}px)` }}>
        <path d={wave(4, 60, 0)} fill="url(#jp-liquid-g)" className="jp-wave back" />
        <path d={wave(3, 40, 1.6)} fill="url(#jp-liquid-g)" className="jp-wave front" />
        <rect x={C - r} y={1} width={r * 2} height={3} fill="#fff6c8" opacity=".5" className="jp-liquid-shine" />
        {/* molten flow: slow light streaks drifting through the gold */}
        <rect x={C - r - 240} y={4} width={r * 2 + 480} height={2 * r} fill="url(#jp-flow-g)" className="jp-flow" />
        {/* bubbles rising to the surface */}
        <g clipPath="url(#jp-liquid-clip)">
        {BUBBLES.map((b, i) => (
          <g
            key={i}
            className="jp-bubble"
            style={{ ['--dx' as string]: `${b.dx.toFixed(1)}px`, ['--dy' as string]: `${b.dy.toFixed(1)}px`, animationDuration: `${b.dur.toFixed(2)}s`, animationDelay: `${b.delay.toFixed(2)}s` } as React.CSSProperties}
          >
            <circle cx={C - r + b.x * 2 * r} cy={b.depth} r={b.size} fill="url(#jp-bubble-g)" />
            <circle cx={C - r + b.x * 2 * r - b.size * 0.35} cy={b.depth - b.size * 0.35} r={b.size * 0.28} fill="#fff" opacity=".85" />
          </g>
        ))}
        </g>
      </g>
    </g>
  );
}

/** The glass over the vault: a curved reflection so the slices read as panes in front of the gold. */
export function VaultGlass() {
  return (
    <g className="jp-glass" aria-hidden="true">
      <path d={`M${C - R_OUT + 18} ${C - 30} A${R_OUT - 18} ${R_OUT - 18} 0 0 1 ${C + 40} ${C - R_OUT + 16} L${C + 30} ${C - R_OUT + 34} A${R_OUT - 36} ${R_OUT - 36} 0 0 0 ${C - R_OUT + 36} ${C - 22} Z`} fill="url(#jp-glass-g)" />
    </g>
  );
}
