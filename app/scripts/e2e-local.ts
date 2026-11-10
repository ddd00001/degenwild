// End-to-end check of the site's transaction code (src/chain.ts) against a local
// Surfpool fork of devnet (real ORAO program cloned from devnet).
//
//   surfpool start --network devnet --no-deploy --ci
//   solana program deploy --program-id ../target/deploy/degenwild-keypair.json ../target/deploy/degenwild.so -u localhost
//   npx tsx scripts/e2e-local.ts
//
// Surfpool cheatcodes stand in for the parts we can't do locally: the platform
// admin key (platform config is written directly) and ORAO's oracle (the
// randomness account is overwritten as fulfilled).
import {
  type Address,
  type Instruction,
  createClient,
  generateKeyPairSigner,
  getAddressEncoder,
  getU16Encoder,
  lamports,
} from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import {
  BattleStatus,
  DEGENWILD_PROGRAM_ADDRESS,
  findPlatformConfigPda,
  getPlatformConfigDiscriminatorBytes,
} from '../src/generated';
import {
  buildCancel,
  buildCreate,
  buildJoin,
  buildRefund,
  buildSettle,
  describeError,
  fetchAllBattles,
  fetchRandomness,
  fetchOraoNetwork,
  payoutFor,
} from '../src/chain';

const RPC = 'http://127.0.0.1:8899';
const VERSION = (Number(process.env.TX_VERSION ?? 1) as 0 | 1);

async function cheat(method: string, params: unknown[]) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

const player = async () => {
  const kp = await generateKeyPairSigner();
  await cheat('surfnet_setAccount', [kp.address, { lamports: 5_000_000_000 }]);
  const c = createClient().use(signer(kp)).use(solanaRpc({ rpcUrl: RPC, transactionConfig: { version: VERSION as 1 } }));
  return { kp, c };
};

const bal = async (c: Awaited<ReturnType<typeof player>>['c'], a: Address) =>
  (await c.rpc.getBalance(a, { commitment: 'confirmed' }).send()).value;

let failures = 0;
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
  if (!ok) failures++;
}

async function send(c: Awaited<ReturnType<typeof player>>['c'], ix: Instruction) {
  return c.sendTransaction([ix]);
}

async function main() {
  console.log(`tx version ${VERSION}`);
  const alice = await player();
  const bob = await player();
  const treasury = (await generateKeyPairSigner()).address;
  const rpc = alice.c.rpc;

  // Platform config (admin key not available locally) — write it directly.
  const [cfg, bump] = await findPlatformConfigPda();
  const enc = getAddressEncoder();
  const cfgData = new Uint8Array([
    ...getPlatformConfigDiscriminatorBytes(),
    ...enc.encode(treasury), // admin (unused here)
    ...enc.encode(treasury),
    ...getU16Encoder().encode(350),
    bump,
  ]);
  await cheat('surfnet_setAccount', [cfg, { lamports: 10_000_000, owner: DEGENWILD_PROGRAM_ADDRESS, data: Buffer.from(cfgData).toString("hex") }]);
  await cheat('surfnet_setAccount', [treasury, { lamports: 1_000_000_000 }]);

  const orao = await fetchOraoNetwork(rpc);
  check('reads ORAO network state from forked devnet', !!orao.treasury, `fee ${orao.requestFee} lamports`);

  const stake = 100_000_000n; // 0.1 SOL

  // ---- create + cancel
  const c1 = await buildCreate(alice.kp, stake, 0);
  await send(alice.c, c1.ix);
  let all = await fetchAllBattles(rpc);
  let b = all.find((x) => x.address === c1.battle);
  check('create: battle appears in lobby as Open', b?.status === BattleStatus.Open && b.amount === stake);
  await send(alice.c, buildCancel(alice.kp, b!));
  all = await fetchAllBattles(rpc);
  check('cancel: battle account closed', !all.some((x) => x.address === c1.battle));

  // ---- bad stake surfaces a readable program error
  try {
    await send(alice.c, (await buildCreate(alice.kp, 1_000n, 0)).ix);
    check('create below minimum is rejected', false);
  } catch (e) {
    const msg = describeError(e);
    check('create below minimum is rejected with program message', /minimum/i.test(msg), msg);
  }

  // ---- create + join (real ORAO CPI) + settle
  const c2 = await buildCreate(alice.kp, stake, 0); // alice: HEADS
  await send(alice.c, c2.ix);
  b = (await fetchAllBattles(rpc)).find((x) => x.address === c2.battle)!;
  try {
    await send(bob.c, await buildJoin(rpc, bob.kp, b));
  } catch (e) {
    console.error(e);
    check('join (ORAO request_v2 CPI)', false, describeError(e));
    throw e;
  }
  b = (await fetchAllBattles(rpc)).find((x) => x.address === c2.battle)!;
  check('join: status RandomnessPending', b.status === BattleStatus.RandomnessPending);
  const r1 = await fetchRandomness(rpc, b.randomnessAccount);
  check('join: ORAO request account exists and is pending', r1.state === 'pending', r1.state);

  try {
    await send(bob.c, await buildSettle(rpc, b));
    check('settle before fulfilment is rejected', false);
  } catch (e) {
    check('settle before fulfilment is rejected', /not been fulfilled/i.test(describeError(e)), describeError(e));
  }

  // Fake ORAO fulfilment: tag=1, client, seed, randomness with low bit 1 => TAILS => bob wins.
  const acc = await rpc.getAccountInfo(b.randomnessAccount, { encoding: 'base64' }).send();
  const raw = Buffer.from(acc.value!.data[0], 'base64');
  const fulfilled = new Uint8Array(8 + 1 + 32 + 32 + 64);
  fulfilled.set(raw.subarray(0, 8), 0); // discriminator
  fulfilled[8] = 1;
  fulfilled.set(enc.encode(bob.kp.address), 9);
  fulfilled.set(b.randomnessSeed, 41);
  const rnd = new Uint8Array(64).fill(7); // 7 & 1 = 1 => TAILS
  fulfilled.set(rnd, 73);
  await cheat('surfnet_setAccount', [b.randomnessAccount, { data: Buffer.from(fulfilled).toString("hex") }]);
  const r2 = await fetchRandomness(rpc, b.randomnessAccount);
  check('fetchRandomness decodes fulfilled coin', r2.state === 'fulfilled' && r2.coin === 1);

  const [bobBefore, treBefore] = [await bal(bob.c, bob.kp.address), await bal(bob.c, treasury)];
  // Settle is permissionless: alice (the loser) sends it.
  const sig = await send(alice.c, await buildSettle(rpc, b));
  const [bobAfter, treAfter] = [await bal(bob.c, bob.kp.address), await bal(bob.c, treasury)];
  const { payout, fee } = payoutFor(stake);
  b = (await fetchAllBattles(rpc)).find((x) => x.address === c2.battle)!;
  check('settle: status Settled, winner = bob', b.status === BattleStatus.Settled && b.winner.__option === 'Some' && b.winner.value === bob.kp.address);
  check('settle: bob received pot minus 3.5%', bobAfter - bobBefore === payout, `${bobAfter - bobBefore}`);
  check('settle: treasury received fee', treAfter - treBefore === fee, `${treAfter - treBefore}`);
  console.log(`      settle sig ${sig.context.signature}`);

  // ---- refund after VRF timeout
  const c3 = await buildCreate(alice.kp, stake, 1);
  await send(alice.c, c3.ix);
  b = (await fetchAllBattles(rpc)).find((x) => x.address === c3.battle)!;
  await send(bob.c, await buildJoin(rpc, bob.kp, b));
  b = (await fetchAllBattles(rpc)).find((x) => x.address === c3.battle)!;
  try {
    await send(alice.c, buildRefund(b));
    check('refund before timeout is rejected', false);
  } catch (e) {
    check('refund before timeout is rejected', /timeout/i.test(describeError(e)), describeError(e));
  }
  const slot = await rpc.getSlot({ commitment: 'confirmed' }).send();
  await cheat('surfnet_timeTravel', [{ absoluteSlot: Number(slot) + 800 }]);
  const aBefore = await bal(alice.c, alice.kp.address);
  await send(bob.c, buildRefund(b));
  const aAfter = await bal(alice.c, alice.kp.address);
  b = (await fetchAllBattles(rpc)).find((x) => x.address === c3.battle)!;
  check('refund: status Refunded, creator got stake back', b.status === BattleStatus.Refunded && aAfter - aBefore === stake);

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

void lamports;
main().catch((e) => {
  console.error('ERROR', describeError(e));
  console.error(e);
  process.exit(1);
});
