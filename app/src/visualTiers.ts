// Visual-only thresholds: how prestigious a coinflip pot or the jackpot LOOKS.
// They never touch stakes, limits, odds, fees or payouts.
//
// Coinflip tiers use the OPEN POT shown on a joinable battle card (the creator's stake),
// never the combined pot after someone joins. Jackpot tiers use the whole accumulated pot.
//
// To retune for mainnet, add a `mainnet` entry to TIERS below; nothing else needs to change.
import { CLUSTER, type Cluster } from './config';

type CoinflipTiers = {
  /** Lower bounds in SOL for tiers 2, 3 and 4 (tier 1 is everything below the first). */
  enhanced: number;
  premium: number;
  elite: number;
  /** Elite intensity keeps growing up to this pot, where it maxes out ("ultimate" look). */
  max: number;
};
type JackpotTiers = {
  growing: number;
  big: number;
  major: number;
  mega: number;
  /** Mega intensity keeps growing up to this pot. */
  max: number;
  /** Totals that trigger a short celebration when the pot crosses them. */
  milestones: number[];
  /** The milestone that gets the bigger celebration. */
  special: number;
};

const DEVNET = {
  coinflip: { enhanced: 0.1, premium: 0.25, elite: 0.5, max: 10 } satisfies CoinflipTiers,
  jackpot: { growing: 0.25, big: 0.5, major: 1, mega: 5, max: 20, milestones: [0.5, 1, 2, 5], special: 1 } satisfies JackpotTiers,
};

/** Mainnet thresholds are not decided yet: until a `mainnet` entry exists, the devnet values apply. */
const TIERS: Partial<Record<Cluster, typeof DEVNET>> = { devnet: DEVNET, localnet: DEVNET };
const ACTIVE = TIERS[CLUSTER] ?? DEVNET;

const sol = (lamports: bigint) => Number(lamports) / 1e9;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 0 at `from`, 1 at `to`, log scale so 0.6 vs 5 SOL feel very different but 9 vs 10 still moves. */
const logRamp = (v: number, from: number, to: number) => clamp01(Math.log(v / from) / Math.log(to / from));

export type CoinflipTier = { tier: 1 | 2 | 3 | 4; intensity: number; ultimate: boolean };

/** Tier for a joinable battle from its displayed open pot (the creator's stake). Bounds are inclusive below: exactly 0.1 is tier 2. */
export function coinflipTier(openPotLamports: bigint): CoinflipTier {
  const c = ACTIVE.coinflip;
  const v = sol(openPotLamports);
  if (v >= c.elite) return { tier: 4, intensity: logRamp(v, c.elite, c.max), ultimate: v >= c.max };
  if (v >= c.premium) return { tier: 3, intensity: 0, ultimate: false };
  if (v >= c.enhanced) return { tier: 2, intensity: 0, ultimate: false };
  return { tier: 1, intensity: 0, ultimate: false };
}

export type JackpotTier = { tier: 1 | 2 | 3 | 4 | 5; name: 'small' | 'growing' | 'big' | 'major' | 'mega'; intensity: number };

/** Tier for the whole accumulated jackpot. `intensity` (0..1) rises smoothly across all tiers. */
export function jackpotTier(totalLamports: bigint): JackpotTier {
  const j = ACTIVE.jackpot;
  const v = sol(totalLamports);
  const intensity = v <= 0 ? 0 : clamp01(0.15 + 0.85 * logRamp(Math.max(v, 0.05), 0.05, j.max));
  if (v >= j.mega) return { tier: 5, name: 'mega', intensity };
  if (v >= j.major) return { tier: 4, name: 'major', intensity };
  if (v >= j.big) return { tier: 3, name: 'big', intensity };
  if (v >= j.growing) return { tier: 2, name: 'growing', intensity };
  return { tier: 1, name: 'small', intensity };
}

/** The milestone crossed when the pot goes from `before` to `after` (highest one), if any. */
export function crossedMilestone(beforeLamports: bigint, afterLamports: bigint): { at: number; special: boolean } | null {
  const j = ACTIVE.jackpot;
  const a = sol(beforeLamports);
  const b = sol(afterLamports);
  const hits = j.milestones.filter((m) => a < m && b >= m);
  if (!hits.length) return null;
  // Several at once (a big entry): celebrate the highest, and keep the special treatment if it was passed.
  return { at: hits[hits.length - 1], special: hits.includes(j.special) };
}
