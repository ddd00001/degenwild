// Rebuilds who was in a finished jackpot round, and with how much, from the round's transactions.
// The round account is closed after payout, so the entries only live on in its history:
// every enter_jackpot (player = account 0, amount = u64 after the discriminator) adds to an entry,
// and leave_jackpot (only possible when alone) empties the round again.
import { type Address, type Signature, getBase58Encoder, getU64Decoder } from '@solana/kit';
import type { AppClient } from './client';
import { DEGENWILD_PROGRAM_ADDRESS, ENTER_JACKPOT_DISCRIMINATOR, LEAVE_JACKPOT_DISCRIMINATOR } from './generated';

type Rpc = AppClient['rpc'];
export type ReplayEntry = { player: Address; amount: bigint };

const b58 = getBase58Encoder();
const u64 = getU64Decoder();
const same = (a: Uint8Array, d: ArrayLike<number>) => d.length <= a.length && Array.from(d).every((x, i) => a[i] === x);

const cache = new Map<string, ReplayEntry[]>();

export async function fetchJackpotEntries(rpc: Rpc, round: Address): Promise<ReplayEntry[]> {
  const hit = cache.get(round);
  if (hit) return hit;
  const sigs = await rpc.getSignaturesForAddress(round, { limit: 200, commitment: 'confirmed' }).send();
  const ok = sigs.filter((s) => s.err === null).reverse(); // oldest first
  const txs: (Awaited<ReturnType<typeof getTx>> | null)[] = [];
  for (let i = 0; i < ok.length; i += 6) {
    txs.push(...(await Promise.all(ok.slice(i, i + 6).map((s) => getTx(rpc, s.signature).catch(() => null)))));
  }

  let entries: ReplayEntry[] = [];
  for (const tx of txs) {
    if (!tx) continue;
    const msg = tx.transaction.message;
    const keys: string[] = [
      ...msg.accountKeys,
      ...(tx.meta?.loadedAddresses?.writable ?? []),
      ...(tx.meta?.loadedAddresses?.readonly ?? []),
    ];
    for (const ix of msg.instructions) {
      if (keys[ix.programIdIndex] !== DEGENWILD_PROGRAM_ADDRESS) continue;
      const data = new Uint8Array(b58.encode(ix.data));
      if (same(data, ENTER_JACKPOT_DISCRIMINATOR)) {
        const player = keys[ix.accounts[0]] as Address;
        const amount = u64.decode(data, 8);
        const e = entries.find((x) => x.player === player);
        if (e) e.amount += amount;
        else entries.push({ player, amount });
      } else if (same(data, LEAVE_JACKPOT_DISCRIMINATOR)) {
        entries = [];
      }
    }
  }
  cache.set(round, entries);
  return entries;
}

function getTx(rpc: Rpc, signature: Signature) {
  return rpc
    .getTransaction(signature, { maxSupportedTransactionVersion: 1, encoding: 'json', commitment: 'confirmed' })
    .send()
    .then((t) => {
      if (!t) throw new Error('missing');
      return t;
    });
}
