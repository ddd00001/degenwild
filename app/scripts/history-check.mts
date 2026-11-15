// How many coinflips / jackpots does the first history load find?
import { createSolanaRpc } from '@solana/kit';
import { GameHistory } from '../src/history.ts';
const rpc = createSolanaRpc(process.env.RPC ?? 'https://api.devnet.solana.com');
const t = Date.now();
const h = new GameHistory(rpc as never);
const { games, jackpots } = await h.poll();
console.log('flips', games.filter((g) => g.kind === 'settled').length, 'jackpots', jackpots.length, 'ms', Date.now() - t);
console.log(jackpots.map((j) => `#${j.roundId} ${j.winner.slice(0, 6)} ${Number(j.payout) / 1e9}`).join('\n'));
