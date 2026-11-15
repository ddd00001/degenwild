import { type Address, type Signature, getBase64Encoder, none, some } from '@solana/kit';
import {
  BATTLE_REFUNDED_EVENT_DISCRIMINATOR,
  BATTLE_SETTLED_EVENT_DISCRIMINATOR,
  BattleStatus,
  DEGENWILD_PROGRAM_ADDRESS,
  getBattleRefundedEventDecoder,
  getBattleSettledEventDecoder,
  getJackpotSettledEventDecoder,
  JACKPOT_SETTLED_EVENT_DISCRIMINATOR,
} from './generated';
import type { AppClient } from './client';
import type { BattleView } from './chain';

type Rpc = AppClient['rpc'];

export type GameResult =
  | {
      kind: 'settled';
      signature: Signature;
      blockTime: number | null;
      battle: Address;
      battleId: bigint;
      creator: Address;
      opponent: Address;
      winner: Address;
      coin: 0 | 1;
      payout: bigint;
      fee: bigint;
    }
  | {
      kind: 'refunded';
      signature: Signature;
      blockTime: number | null;
      battle: Address;
      battleId: bigint;
      creator: Address;
      opponent: Address;
      amount: bigint;
    };

/** A finished jackpot round, from its JackpotSettled event. */
export type JackpotResult = {
  signature: Signature;
  blockTime: number | null;
  round: Address;
  roundId: bigint;
  winner: Address;
  total: bigint;
  payout: bigint;
  fee: bigint;
  ticket: bigint;
  players: number;
};

export type HistoryBatch = { games: GameResult[]; jackpots: JackpotResult[] };

const b64 = getBase64Encoder();
const startsWith = (data: Uint8Array, prefix: ArrayLike<number>) => {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (data[i] !== prefix[i]) return false;
  return true;
};

/**
 * Pulls our program's events out of a transaction's logs. Only "Program data:" lines emitted
 * while our program is at the top of the invoke stack count, so another program can't forge a result.
 */
export function parseEvents(logs: readonly string[], signature: Signature, blockTime: number | null): HistoryBatch {
  const stack: string[] = [];
  const out: GameResult[] = [];
  const jackpots: JackpotResult[] = [];
  for (const line of logs) {
    const invoke = line.match(/^Program (\w+) invoke \[\d+\]$/);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (!line.startsWith('Program data: ') || stack[stack.length - 1] !== DEGENWILD_PROGRAM_ADDRESS) continue;
    let data: Uint8Array;
    try {
      data = new Uint8Array(b64.encode(line.slice('Program data: '.length)));
    } catch {
      continue;
    }
    try {
      if (startsWith(data, BATTLE_SETTLED_EVENT_DISCRIMINATOR)) {
        const e = getBattleSettledEventDecoder().decode(data);
        if (e.coin !== 0 && e.coin !== 1) continue;
        out.push({ kind: 'settled', signature, blockTime, ...e, coin: e.coin as 0 | 1 });
      } else if (startsWith(data, BATTLE_REFUNDED_EVENT_DISCRIMINATOR)) {
        const e = getBattleRefundedEventDecoder().decode(data);
        out.push({ kind: 'refunded', signature, blockTime, ...e });
      } else if (startsWith(data, JACKPOT_SETTLED_EVENT_DISCRIMINATOR)) {
        jackpots.push({ signature, blockTime, ...getJackpotSettledEventDecoder().decode(data) });
      }
    } catch {
      /* malformed: ignore */
    }
  }
  return { games: out, jackpots };
}

/**
 * Incrementally reads finished games from the program's transaction history.
 * The first call loads the most recent `initial` transactions; later calls only fetch newer ones.
 */
export class GameHistory {
  private newest: Signature | undefined;
  private inFlight: Promise<HistoryBatch> | null = null;

  /** On the first load, page back through history until this many coinflips and jackpots are found. */
  constructor(
    private readonly rpc: Rpc,
    private readonly want = 10,
    private readonly maxPages = 6,
  ) {}

  poll(): Promise<HistoryBatch> {
    this.inFlight ??= this.fetchNew().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async fetchNew(): Promise<HistoryBatch> {
    const all: HistoryBatch = { games: [], jackpots: [] };
    if (this.newest) {
      const sigs = await this.page({ limit: 50, until: this.newest });
      if (sigs.length) this.newest = sigs[0].signature;
      return this.read(sigs);
    }
    // First load: backfill so "recent" lists are full even when the lobby has been quiet.
    let before: Signature | undefined;
    for (let p = 0; p < this.maxPages; p++) {
      const sigs = await this.page({ limit: 100, before });
      if (!sigs.length) break;
      if (p === 0) this.newest = sigs[0].signature;
      before = sigs[sigs.length - 1].signature;
      const got = await this.read(sigs);
      all.games.push(...got.games);
      all.jackpots.push(...got.jackpots);
      const flips = all.games.filter((g) => g.kind === 'settled').length;
      if ((flips >= this.want && all.jackpots.length >= this.want) || sigs.length < 100) break;
    }
    return all;
  }

  private page(opts: { limit: number; until?: Signature; before?: Signature }) {
    return this.rpc.getSignaturesForAddress(DEGENWILD_PROGRAM_ADDRESS, { ...opts, commitment: 'confirmed' }).send();
  }

  private async read(sigs: readonly { signature: Signature; err: unknown; blockTime: bigint | number | null }[]): Promise<HistoryBatch> {
    const ok = sigs.filter((s) => s.err === null);
    const out: HistoryBatch = { games: [], jackpots: [] };
    // A few at a time so the RPC doesn't rate-limit us.
    for (let i = 0; i < ok.length; i += 6) {
      const batch = await Promise.all(
        ok.slice(i, i + 6).map(async (s) => {
          try {
            const tx = await this.rpc
              .getTransaction(s.signature, { maxSupportedTransactionVersion: 1, encoding: 'json', commitment: 'confirmed' })
              .send();
            return parseEvents(tx?.meta?.logMessages ?? [], s.signature, s.blockTime === null ? null : Number(s.blockTime));
          } catch {
            return { games: [], jackpots: [] };
          }
        }),
      );
      for (const b of batch) {
        out.games.push(...b.games);
        out.jackpots.push(...b.jackpots);
      }
    }
    return out; // newest first
  }
}

export function resultToBattle(r: GameResult): BattleView {
  const settled = r.kind === 'settled';
  return {
    address: r.battle,
    discriminator: new Uint8Array(8),
    creator: r.creator,
    opponent: some(r.opponent),
    amount: settled ? (r.payout + r.fee) / 2n : r.amount,
    battleId: r.battleId,
    status: settled ? BattleStatus.Settled : BattleStatus.Refunded,
    randomnessSeed: new Uint8Array(32),
    randomnessAccount: r.battle,
    winner: settled ? some(r.winner) : none(),
    // Settled: the creator's side follows from who won. Refund events don't carry it (shown as "?").
    creatorSide: settled ? (r.winner === r.creator ? r.coin : 1 - r.coin) : 255,
    joinedSlot: 0n,
    bump: 0,
  };
}
