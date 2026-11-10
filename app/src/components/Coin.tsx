import { useId } from 'react';

/**
 * An original minted-coin illustration. Heads: gold, embossed profile bust in shades.
 * Tails: silver, laurel wreath around a star. `detailed` adds the lettering (big coins only).
 */
export function Coin({ side, detailed = false }: { side: 0 | 1; detailed?: boolean }) {
  const id = useId().replace(/:/g, '');
  const gold = side === 0;
  const m = gold
    ? { hi: '#fff1b8', mid: '#f2b630', lo: '#8f5a10', edge: '#c98a1d', ink: '#7a4a08', relief: '#ffe08a' }
    : { hi: '#ffffff', mid: '#c9ced6', lo: '#5d636d', edge: '#9aa1ab', ink: '#40454d', relief: '#f2f4f7' };

  return (
    <svg viewBox="0 0 100 100" className="coin-svg" role="img" aria-label={gold ? 'Heads' : 'Tails'}>
      <defs>
        <radialGradient id={`f${id}`} cx="35%" cy="28%" r="80%">
          <stop offset="0" stopColor={m.hi} />
          <stop offset=".45" stopColor={m.mid} />
          <stop offset="1" stopColor={m.lo} />
        </radialGradient>
        <linearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={m.hi} />
          <stop offset=".5" stopColor={m.edge} />
          <stop offset="1" stopColor={m.lo} />
        </linearGradient>
        <path id={`top${id}`} d="M 18 50 A 32 32 0 0 1 82 50" />
        <path id={`bot${id}`} d="M 16 50 A 34 34 0 0 0 84 50" />
      </defs>

      {/* reeded edge */}
      <circle cx="50" cy="50" r="49" fill={m.lo} />
      <circle cx="50" cy="50" r="47.5" fill="none" stroke={m.edge} strokeWidth="3" strokeDasharray="1.4 1.1" />
      {/* raised rim + field */}
      <circle cx="50" cy="50" r="45" fill={`url(#r${id})`} />
      <circle cx="50" cy="50" r="41" fill={`url(#f${id})`} />
      <circle cx="50" cy="50" r="38.5" fill="none" stroke={m.lo} strokeOpacity=".45" strokeWidth=".8" />

      {gold ? (
        <g>
          {/* profile bust (embossed: shadow offset + relief + outline) */}
          <path d={HEAD} transform="translate(1.2 1.4)" fill={m.lo} opacity=".55" />
          <path d={HEAD} fill={m.relief} stroke={m.ink} strokeWidth=".9" strokeLinejoin="round" />
          {/* hair line */}
          <path d="M37 30 C 44 23, 58 22, 66 32" fill="none" stroke={m.ink} strokeWidth="1" strokeLinecap="round" opacity=".7" />
          {/* shades */}
          <path d="M33.5 38.2 L45 38.2 L44.2 42.6 L35.6 42.6 Z" fill={m.ink} />
          <path d="M45 39 L60 37.6" stroke={m.ink} strokeWidth="1.1" strokeLinecap="round" />
          {/* ear */}
          <path d="M55 41 c 3 0, 4 6, 0 7" fill="none" stroke={m.ink} strokeWidth=".9" strokeLinecap="round" />
        </g>
      ) : (
        <g>
          {/* laurel wreath */}
          {LEAVES.map(([x, y, r], i) => (
            <g key={i}>
              <ellipse cx={x} cy={y} rx="2.4" ry="5.2" transform={`rotate(${r} ${x} ${y})`} fill={m.relief} stroke={m.ink} strokeWidth=".6" />
              <ellipse cx={100 - x} cy={y} rx="2.4" ry="5.2" transform={`rotate(${-r} ${100 - x} ${y})`} fill={m.relief} stroke={m.ink} strokeWidth=".6" />
            </g>
          ))}
          {/* star */}
          <path d={STAR} transform="translate(1 1.2)" fill={m.lo} opacity=".5" />
          <path d={STAR} fill={m.relief} stroke={m.ink} strokeWidth=".9" strokeLinejoin="round" />
        </g>
      )}

      {detailed && (
        <g fill={m.ink} fontFamily="'Barlow Condensed', Inter, sans-serif" fontWeight="800" letterSpacing="1.6">
          {gold && (
            <text fontSize="7.2" textAnchor="middle">
              <textPath href={`#top${id}`} startOffset="50%">DEGENWILD</textPath>
            </text>
          )}
          <text fontSize="7.2" textAnchor="middle">
            <textPath href={`#bot${id}`} startOffset="50%">{gold ? 'HEADS' : 'TAILS'}</textPath>
          </text>
        </g>
      )}
    </svg>
  );
}

// Left-facing bust, cut flat at the bottom like a coin portrait.
const HEAD =
  'M63 78 C 66 70, 71 61, 70 47 C 69 33, 60 25, 48.5 25 C 39 25, 34 31.5, 34 38 L 33.6 43 L 28.6 50.8 C 28.3 52.6, 29.8 53.6, 32.2 53.6 L 31.6 56.6 L 33.3 58 L 31.8 59.8 C 31.6 63.6, 33.8 67, 38.5 68 L 44 69 L 44.6 78 Z';

// [x, y, rotation] for the left half of the wreath; mirrored for the right.
const LEAVES: [number, number, number][] = [
  [33, 71, 55],
  [27.5, 64, 35],
  [24.5, 56, 18],
  [23.8, 47.5, 2],
  [25.2, 39, -14],
  [28.8, 31.5, -30],
];

const STAR = 'M50 33 L54.6 44.4 L66.8 45.2 L57.4 53 L60.4 65 L50 58.4 L39.6 65 L42.6 53 L33.2 45.2 L45.4 44.4 Z';
