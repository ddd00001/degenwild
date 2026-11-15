import { createSolanaRpc } from '@solana/kit';
import { GameHistory } from '../src/history.ts';
import { fetchJackpotEntries } from '../src/jackpotReplay.ts';
const rpc = createSolanaRpc(process.env.RPC ?? 'https://api.devnet.solana.com') as never;
const { jackpots } = await new GameHistory(rpc).poll();
for (const j of jackpots) {
  const e = await fetchJackpotEntries(rpc, j.round);
  const sum = e.reduce((a, x) => a + x.amount, 0n);
  let acc = 0n, w = '';
  for (const x of e) { acc += x.amount; if (j.ticket < acc) { w = x.player; break; } }
  console.log(`#${j.roundId} players ${e.length}/${j.players} sum ${sum === j.total ? 'OK' : 'MISMATCH'} winner ${w === j.winner ? 'OK' : 'MISMATCH'}`);
}
