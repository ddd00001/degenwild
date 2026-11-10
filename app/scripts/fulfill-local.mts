// Local fork only: stands in for ORAO's oracle, which doesn't run on Surfpool.
//
//   npx tsx scripts/fulfill-local.mts                 list battles waiting on ORAO
//   npx tsx scripts/fulfill-local.mts <battle> heads  fulfil that battle's request so the coin lands heads
//   npx tsx scripts/fulfill-local.mts all random      fulfil every pending request with a random coin
import { createSolanaRpc, getAddressEncoder } from '@solana/kit';
import { fetchAllBattles, fetchRandomness, opponentOf } from '../src/chain';
import { BattleStatus } from '../src/generated';

const RPC = 'http://127.0.0.1:8899';
const rpc = createSolanaRpc(RPC) as never as Parameters<typeof fetchAllBattles>[0];
const [target, sideArg = 'random'] = process.argv.slice(2);

const pending = (await fetchAllBattles(rpc)).filter((b) => b.status === BattleStatus.RandomnessPending);
if (!pending.length) console.log('No battles are waiting on ORAO.');

for (const b of pending) {
  const r = await fetchRandomness(rpc, b.randomnessAccount);
  const side = b.creatorSide ? 'TAILS' : 'HEADS';
  console.log(`${b.address}  ${Number(b.amount) / 1e9} SOL  creator ${b.creator.slice(0, 4)}… on ${side}  vs ${opponentOf(b)?.slice(0, 4)}…  orao=${r.state}`);
  if (!target || (target !== 'all' && target !== b.address) || r.state !== 'pending') continue;

  const coin = sideArg === 'heads' ? 0 : sideArg === 'tails' ? 1 : Math.round(Math.random());
  const acc = await (rpc as any).getAccountInfo(b.randomnessAccount, { encoding: 'base64' }).send();
  const raw = Buffer.from(acc.value.data[0], 'base64');
  const data = new Uint8Array(8 + 1 + 32 + 32 + 64);
  data.set(raw.subarray(0, 8), 0); // RandomnessV2 discriminator
  data[8] = 1; // Fulfilled
  data.set(getAddressEncoder().encode(opponentOf(b)!), 9); // client = the joiner who paid for the request
  data.set(b.randomnessSeed, 41);
  const randomness = crypto.getRandomValues(new Uint8Array(64));
  randomness[0] = (randomness[0] & 0xfe) | coin;
  data.set(randomness, 73);

  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'surfnet_setAccount', params: [b.randomnessAccount, { data: Buffer.from(data).toString('hex') }] }),
  }).then((x) => x.json());
  if (res.error) throw new Error(JSON.stringify(res.error));
  console.log(`  -> fulfilled: coin landed ${coin ? 'TAILS' : 'HEADS'} (${coin === b.creatorSide ? 'creator' : 'joiner'} wins)`);
}
