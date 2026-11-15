// Auto-settle bot: pays out every battle as soon as its randomness lands, and refunds
// battles whose randomness never arrived. Settle/refund are permissionless; the bot
// only pays network fees (~0.000005 SOL each). Rent always goes back to the creator.
//
//   npm run bot                                   # devnet, CLI wallet pays fees
//   RPC=https://... BOT_KEYPAIR=/path/bot.json POLL_MS=3000 npm run bot
//
// House opponent (devnet only, on by default): if nobody joins an open battle within
// HOUSE_DELAY_MS (default 10s), the bot's wallet joins it so a lone visitor still gets a game.
// Only battles up to HOUSE_MAX_SOL (default 1). Disable with HOUSE=0.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { type Address, createClient } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';
import { buildJoin, buildRefund, buildSettle, describeError, fetchAllBattles, fetchRandomness, opponentOf, refundDeadline } from '../src/chain';
import { BattleStatus } from '../src/generated';

const RPC = process.env.RPC ?? process.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com';
const KEYPAIR = process.env.BOT_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
const POLL_MS = Number(process.env.POLL_MS ?? 3000);
const LOW_BALANCE = 50_000_000n; // warn below 0.05 SOL
const ON_MAINNET = /mainnet/i.test(RPC);
const HOUSE = process.env.HOUSE !== '0' && !ON_MAINNET;
const HOUSE_DELAY_MS = Number(process.env.HOUSE_DELAY_MS ?? 10_000);
const HOUSE_MAX = BigInt(Math.round(Number(process.env.HOUSE_MAX_SOL ?? 1) * 1e9));
const HOUSE_RESERVE = 20_000_000n; // keep 0.02 SOL for fees and the randomness fee

const c = await createClient()
  .use(signerFromFile(KEYPAIR))
  .use(solanaRpc({ rpcUrl: RPC, transactionConfig: { version: 0 } }));
// The house plays from the faucet wallet (shown as "Degen Bot" on the site); falls back to the fee payer.
const HOUSE_KEYPAIR = process.env.HOUSE_KEYPAIR ?? `${homedir()}/.config/solana/degenwild-faucet.json`;
const house = HOUSE && existsSync(HOUSE_KEYPAIR)
  ? await createClient().use(signerFromFile(HOUSE_KEYPAIR)).use(solanaRpc({ rpcUrl: RPC, transactionConfig: { version: 0 } }))
  : c;

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

// Battles we're already handling, and ones that failed recently (retry after a cool-down).
const inFlight = new Set<Address>();
const coolDown = new Map<Address, number>();
// When we first saw each open battle (the account has no creation time).
const firstSeen = new Map<Address, number>();

let running = true;
process.on('SIGINT', () => {
  running = false;
  log('stopping…');
});

log(`auto-settle bot on ${RPC.replace(/([?&](api-)?key=)[^&]+/i, '$1…')} · fee payer ${short(c.identity.address)} · every ${POLL_MS}ms`);
log(HOUSE ? `house opponent ON (${short(house.identity.address)}): joins open battles ≤ ${Number(HOUSE_MAX) / 1e9} SOL after ${HOUSE_DELAY_MS / 1000}s` : 'house opponent off');
let ticks = 0;

while (running) {
  try {
    const [battles, slot] = await Promise.all([
      fetchAllBattles(c.rpc),
      c.rpc.getSlot({ commitment: 'confirmed' }).send(),
    ]);
    const pending = battles.filter((b) => b.status === BattleStatus.RandomnessPending && !inFlight.has(b.address));

    await Promise.all(
      pending.map(async (b) => {
        if ((coolDown.get(b.address) ?? 0) > Date.now()) return;
        const r = await fetchRandomness(c.rpc, b.randomnessAccount);
        const action = r.state === 'fulfilled' ? 'settle' : slot >= refundDeadline(b) ? 'refund' : null;
        if (!action) return;

        inFlight.add(b.address);
        try {
          const ix = action === 'settle' ? await buildSettle(c.rpc, b) : buildRefund(b);
          const res = await c.sendTransaction([ix]);
          const what =
            action === 'settle' && r.state === 'fulfilled'
              ? `settled ${short(b.address)}: ${r.coin ? 'TAILS' : 'HEADS'} — ${short(r.coin === b.creatorSide ? b.creator : opponentOf(b) ?? '?')} wins`
              : `refunded ${short(b.address)} (randomness timed out)`;
          log(`${what}  tx ${res.context.signature.slice(0, 16)}…`);
        } catch (e) {
          // Most often a player claimed it first — the account is then gone and we just move on.
          log(`skip ${short(b.address)}: ${describeError(e)}`);
          coolDown.set(b.address, Date.now() + 30_000);
        } finally {
          inFlight.delete(b.address);
        }
      }),
    );

    if (HOUSE) await houseJoin(battles);

    if (ticks++ % 100 === 0) {
      const { value } = await c.rpc.getBalance(c.identity.address).send();
      log(`fee payer balance ${(Number(value) / 1e9).toFixed(4)} SOL${value < LOW_BALANCE ? '  ⚠ LOW — top it up' : ''}`);
    }
  } catch (e) {
    log(`poll failed: ${describeError(e)}`);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}

/** Joins battles nobody else took, one at a time, while the house can afford them. */
async function houseJoin(battles: Awaited<ReturnType<typeof fetchAllBattles>>) {
  const now = Date.now();
  const open = battles.filter((b) => b.status === BattleStatus.Open);
  const openSet = new Set(open.map((b) => b.address));
  for (const a of firstSeen.keys()) if (!openSet.has(a)) firstSeen.delete(a);
  for (const b of open) if (!firstSeen.has(b.address)) firstSeen.set(b.address, now);

  const due = open.filter(
    (b) =>
      b.creator !== house.identity.address &&
      b.amount <= HOUSE_MAX &&
      now - firstSeen.get(b.address)! >= HOUSE_DELAY_MS &&
      !inFlight.has(b.address) &&
      (coolDown.get(b.address) ?? 0) <= now,
  );
  if (!due.length) return;
  let bal: bigint = (await c.rpc.getBalance(house.identity.address, { commitment: 'confirmed' }).send()).value;
  for (const b of due) {
    if (bal < b.amount + HOUSE_RESERVE) {
      log(`house can't cover ${short(b.address)} (${Number(b.amount) / 1e9} SOL) ⚠ top up ${short(house.identity.address)}`);
      coolDown.set(b.address, now + 60_000);
      continue;
    }
    inFlight.add(b.address);
    try {
      const res = await house.sendTransaction([await buildJoin(c.rpc, house.identity, b)]);
      bal -= b.amount + HOUSE_RESERVE / 4n;
      log(`house joined ${short(b.address)} for ${Number(b.amount) / 1e9} SOL  tx ${res.context.signature.slice(0, 16)}…`);
    } catch (e) {
      // Usually a real player joined first.
      log(`house skip ${short(b.address)}: ${describeError(e)}`);
      coolDown.set(b.address, now + 30_000);
    } finally {
      inFlight.delete(b.address);
    }
  }
}
