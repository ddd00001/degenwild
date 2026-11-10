import { type Address } from '@solana/kit';

export type Side = 0 | 1;
export const SIDE_NAME = ['HEADS', 'TAILS'] as const;

export const LAMPORTS = 1_000_000_000n;
export function fmtSol(l: bigint, max = 4): string {
  const whole = l / LAMPORTS;
  const frac = (l % LAMPORTS).toString().padStart(9, '0').slice(0, max).replace(/0+$/, '');
  return `${whole}.${frac.padEnd(2, '0')}`;
}
/** Parses a user-typed SOL amount into lamports without floating point. */
export function parseSol(input: string): bigint | null {
  const m = input.trim().match(/^(\d+)(?:\.(\d{0,9}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * LAMPORTS + BigInt((m[2] ?? '').padEnd(9, '0'));
}
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function timeAgo(t: number | null): string {
  if (!t) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Shapes a finished-game event like a battle so rows and replays can reuse the battle UI. */
export type Names = Map<Address, string>;
