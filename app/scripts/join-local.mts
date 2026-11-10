// Local fork only: a throwaway funded player joins an open battle, so you can test
// the creator side of a match from the UI.
//
//   npx tsx scripts/join-local.mts <creatorWallet>    joins that wallet's newest open battle
import { type Address, createClient, generateKeyPairSigner } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { buildJoin, describeError, fetchAllBattles } from '../src/chain';
import { BattleStatus } from '../src/generated';

const RPC = 'http://127.0.0.1:8899';
const creator = process.argv[2] as Address | undefined;
if (!creator) throw new Error('usage: join-local.mts <creatorWallet>');

const kp = await generateKeyPairSigner();
await fetch(RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'surfnet_setAccount', params: [kp.address, { lamports: 20_000_000_000 }] }),
});
const c = createClient().use(signer(kp)).use(solanaRpc({ rpcUrl: RPC }));

const battle = (await fetchAllBattles(c.rpc)).find((b) => b.creator === creator && b.status === BattleStatus.Open);
if (!battle) throw new Error(`No open battle from ${creator}`);
try {
  await c.sendTransaction([await buildJoin(c.rpc, kp, battle)]);
  console.log(`${kp.address.slice(0, 4)}… joined ${battle.address} (${Number(battle.amount) / 1e9} SOL, creator on ${battle.creatorSide ? 'TAILS' : 'HEADS'})`);
} catch (e) {
  console.error(describeError(e));
  process.exit(1);
}
