// Auto-settle bot: pays out every battle as soon as its randomness lands, and refunds
// battles whose randomness never arrived. Settle/refund are permissionless; the bot
// only pays network fees (~0.000005 SOL each). Rent always goes back to the creator.
//
//   npm run bot                                   # devnet, CLI wallet pays fees
//   RPC=https://... BOT_KEYPAIR=/path/bot.json POLL_MS=3000 npm run bot
import { homedir } from 'node:os';
import { type Address, createClient } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';
import { buildRefund, buildSettle, describeError, fetchAllBattles, fetchRandomness, opponentOf, refundDeadline } from '../src/chain';
import { BattleStatus } from '../src/generated';

const RPC = process.env.RPC ?? process.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com';
const KEYPAIR = process.env.BOT_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
const POLL_MS = Number(process.env.POLL_MS ?? 3000);
const LOW_BALANCE = 50_000_000n; // warn below 0.05 SOL

const c = await createClient()
  .use(signerFromFile(KEYPAIR))
  .use(solanaRpc({ rpcUrl: RPC, transactionConfig: { version: 0 } }));

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

// Battles we're already handling, and ones that failed recently (retry after a cool-down).
const inFlight = new Set<Address>();
const coolDown = new Map<Address, number>();

let running = true;
process.on('SIGINT', () => {
  running = false;
  log('stopping…');
});

log(`auto-settle bot on ${RPC.replace(/([?&](api-)?key=)[^&]+/i, '$1…')} · fee payer ${short(c.identity.address)} · every ${POLL_MS}ms`);
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

    if (ticks++ % 100 === 0) {
      const { value } = await c.rpc.getBalance(c.identity.address).send();
      log(`fee payer balance ${(Number(value) / 1e9).toFixed(4)} SOL${value < LOW_BALANCE ? '  ⚠ LOW — top it up' : ''}`);
    }
  } catch (e) {
    log(`poll failed: ${describeError(e)}`);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
