// Plays as your Solana CLI wallet (~/.config/solana/id.json) against someone in the UI.
//
//   RPC=https://api.devnet.solana.com npx tsx scripts/cli-player.mts join <creatorWallet>
//   RPC=https://api.devnet.solana.com npx tsx scripts/cli-player.mts settle <battleAddress>
//   RPC=... npx tsx scripts/cli-player.mts status
import { homedir } from 'node:os';
import { type Address, createClient } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';
import { buildJoin, buildSettle, describeError, fetchAllBattles, fetchRandomness, opponentOf } from '../src/chain';
import { BattleStatus } from '../src/generated';

const RPC = process.env.RPC ?? 'http://127.0.0.1:8899';
const [cmd, arg] = process.argv.slice(2);
const c = await createClient()
  .use(signerFromFile(`${homedir()}/.config/solana/id.json`))
  .use(solanaRpc({ rpcUrl: RPC, transactionConfig: { version: 0 } }));
const me = c.identity.address;

try {
  const battles = await fetchAllBattles(c.rpc);
  if (cmd === 'join') {
    const b = battles.find((x) => x.creator === (arg as Address) && x.status === BattleStatus.Open);
    if (!b) throw new Error(`No open battle from ${arg}`);
    const res = await c.sendTransaction([await buildJoin(c.rpc, c.identity, b)]);
    console.log(`joined ${b.address} for ${Number(b.amount) / 1e9} SOL on ${b.creatorSide ? 'HEADS' : 'TAILS'}\n  tx ${res.context.signature}`);
  } else if (cmd === 'settle') {
    const b = battles.find((x) => x.address === (arg as Address));
    if (!b) throw new Error(`Battle ${arg} not found (already settled?)`);
    const res = await c.sendTransaction([await buildSettle(c.rpc, b)]);
    console.log(`settled ${b.address}\n  tx ${res.context.signature}`);
  } else {
    for (const b of battles.filter((x) => x.creator === me || opponentOf(x) === me)) {
      const r = b.status === BattleStatus.RandomnessPending ? await fetchRandomness(c.rpc, b.randomnessAccount) : null;
      const coin = r?.state === 'fulfilled' ? ` landed ${r.coin ? 'TAILS' : 'HEADS'} (${r.coin === b.creatorSide ? 'creator' : 'joiner'} wins)` : '';
      console.log(`${b.address} ${BattleStatus[b.status]} ${Number(b.amount) / 1e9} SOL orao=${r?.state ?? '-'}${coin}`);
    }
  }
} catch (e) {
  console.error(describeError(e));
  process.exit(1);
}
