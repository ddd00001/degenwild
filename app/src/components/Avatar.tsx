// 100 DegenWild avatars: 10 symbols x 10 colors. Every wallet always gets the same one,
// picked from a hash of its address, so nobody has to choose.

const COLORS: [string, string][] = [
  ['#ff3038', '#8f0d14'], // red
  ['#ff8a1f', '#a3460a'], // orange
  ['#f5c542', '#9c6f0c'], // gold
  ['#3ddc84', '#147a43'], // green
  ['#22d3ee', '#0e6f82'], // cyan
  ['#4f7cff', '#1c3a9c'], // blue
  ['#a855f7', '#5b2196'], // purple
  ['#ff4fb4', '#9a1b62'], // pink
  ['#e5e7eb', '#6b7280'], // silver
  ['#14b8a6', '#0b5f57'], // teal
];

/** White symbols on a 24x24 grid. */
const SYMBOLS: { name: string; el: React.ReactNode }[] = [
  { name: 'Flame', el: <path d="M12 2c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 1 3 3 4 0-3 0-5 0-8z" /> },
  { name: 'Crown', el: <path d="M3 8l4.5 4 4.5-7 4.5 7L21 8l-2 11H5z" /> },
  { name: 'Diamond', el: <path d="M6 4h12l4 5-10 12L2 9z" /> },
  { name: 'Bolt', el: <path d="M13.5 2L4 14h7l-1.5 8L20 10h-7z" /> },
  { name: 'Star', el: <path d="M12 2.5l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.4l-6.1 3.5 1.5-6.8L2.2 9.5l6.9-.7z" /> },
  {
    name: 'Coin',
    el: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="6" fill="none" stroke="#0005" strokeWidth="1.6" />
        <path d="M11 8h2v8h-2z" fill="#0006" />
      </>
    ),
  },
  {
    name: 'Dice',
    el: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3.5" />
        <circle cx="8.5" cy="8.5" r="1.6" fill="#0007" />
        <circle cx="12" cy="12" r="1.6" fill="#0007" />
        <circle cx="15.5" cy="15.5" r="1.6" fill="#0007" />
      </>
    ),
  },
  {
    name: 'Eye',
    el: (
      <>
        <path d="M2 12c3-5 6.5-7 10-7s7 2 10 7c-3 5-6.5 7-10 7s-7-2-10-7z" />
        <circle cx="12" cy="12" r="3.6" fill="#0008" />
      </>
    ),
  },
  {
    name: 'Rocket',
    el: (
      <>
        <path d="M12 2c4 3 5.5 8 4.5 13.5L12 18l-4.5-2.5C6.5 10 8 5 12 2z" />
        <path d="M7.5 13L4 17l3.6.4zM16.5 13l3.5 4-3.6.4zM10 19h4l-2 3z" />
        <circle cx="12" cy="9" r="1.8" fill="#0007" />
      </>
    ),
  },
  {
    name: 'Skull',
    el: (
      <>
        <path d="M12 3c-4.7 0-8 3.2-8 7.6 0 2.6 1.2 4.5 3 5.6V20h10v-3.8c1.8-1.1 3-3 3-5.6C20 6.2 16.7 3 12 3z" />
        <circle cx="9" cy="11" r="2" fill="#0008" />
        <circle cx="15" cy="11" r="2" fill="#0008" />
        <path d="M11 15h2l-1 2z" fill="#0008" />
      </>
    ),
  },
];

/** Stable 0..99 index from a wallet address (FNV-1a). */
export function avatarIndex(address: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

export function avatarColor(address: string): string {
  return COLORS[avatarIndex(address) % 10][0];
}

export function avatarName(address: string): string {
  const i = avatarIndex(address);
  return SYMBOLS[Math.floor(i / 10)].name;
}

/** Darker shade of a #rrggbb color, for the avatar gradient when it's tinted. */
function shade(hex: string, f = 0.45): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/**
 * Round avatar for a wallet. `size` in px. Usable inside HTML or (with `x`/`y`) inside an SVG.
 * `tint` recolors the background (e.g. the player's jackpot color) while keeping their symbol.
 */
export function Avatar({ address, size = 32, x, y, ring, tint }: { address: string; size?: number; x?: number; y?: number; ring?: string; tint?: string }) {
  const i = avatarIndex(address);
  const [c1, c2] = tint ? [tint, shade(tint)] : COLORS[i % 10];
  const sym = SYMBOLS[Math.floor(i / 10)];
  const gid = tint ? `av-${i}-${tint.slice(1)}` : `av-${i}`;
  return (
    <svg
      className="avatar-svg"
      width={size}
      height={size}
      x={x}
      y={y}
      viewBox="0 0 40 40"
      role="img"
      aria-label={`${sym.name} avatar`}
    >
      <defs>
        <radialGradient id={gid} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="19" fill={`url(#${gid})`} stroke={ring ?? '#0009'} strokeWidth="2" />
      <g transform="translate(8 8)" fill="#fff">
        {sym.el}
      </g>
    </svg>
  );
}
