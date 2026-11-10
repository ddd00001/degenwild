import { type Address, type Signature, getBase64Encoder } from '@solana/kit';
import {
  BATTLE_REFUNDED_EVENT_DISCRIMINATOR,
  BATTLE_SETTLED_EVENT_DISCRIMINATOR,
  DEGENWILD_PROGRAM_ADDRESS,
  getBattleRefundedEventDecoder,
  getBattleSettledEventDecoder,
} from './generated';
import type { AppClient } from './client';

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
export function parseEvents(logs: readonly string[], signature: Signature, blockTime: number | null): GameResult[] {
  const stack: string[] = [];
  const out: GameResult[] = [];
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
      }
    } catch {
      /* malformed: ignore */
    }
  }
  return out;
}

/**
 * Incrementally reads finished games from the program's transaction history.
 * The first call loads the most recent `initial` transactions; later calls only fetch newer ones.
 */
export class GameHistory {
  private newest: Signature | undefined;
  private inFlight: Promise<GameResult[]> | null = null;

  constructor(
    private readonly rpc: Rpc,
    private readonly initial = 25,
  ) {}

  poll(): Promise<GameResult[]> {
    this.inFlight ??= this.fetchNew().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async fetchNew(): Promise<GameResult[]> {
    const sigs = await this.rpc
      .getSignaturesForAddress(DEGENWILD_PROGRAM_ADDRESS, {
        limit: this.newest ? 50 : this.initial,
        until: this.newest,
        commitment: 'confirmed',
      })
      .send();
    if (sigs.length) this.newest = sigs[0].signature;

    const ok = sigs.filter((s) => s.err === null);
    const results: GameResult[] = [];
    // A few at a time so a public RPC doesn't rate-limit us.
    for (let i = 0; i < ok.length; i += 4) {
      const batch = await Promise.all(
        ok.slice(i, i + 4).map(async (s) => {
          try {
            const tx = await this.rpc
              .getTransaction(s.signature, { maxSupportedTransactionVersion: 1, encoding: 'json', commitment: 'confirmed' })
              .send();
            return parseEvents(tx?.meta?.logMessages ?? [], s.signature, s.blockTime === null ? null : Number(s.blockTime));
          } catch {
            return [];
          }
        }),
      );
      results.push(...batch.flat());
    }
    return results; // newest first
  }
}
