// Vercel function: the house (faucet wallet) joins a player's open battle on request,
// waits for the fair result and settles it, so a lone visitor always gets a game.
// Devnet only. Uses FAUCET_SECRET_KEY (same wallet as the faucet) and FAUCET_RPC_URL.
//
//   POST { battle: "<battle address>" }
import { type Address, address, createClient, createKeyPairSignerFromBytes } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { buildJoin, buildSettle, describeError, fetchBattle, fetchRandomness } from '../src/chain.ts';
import { BattleStatus } from '../src/generated/index.ts';

const RPC_URL = process.env.FAUCET_RPC_URL ?? 'https://api.devnet.solana.com';
const HOUSE_MAX = BigInt(Math.round(Number(process.env.HOUSE_MAX_SOL ?? 5) * 1e9));
const RESERVE = 20_000_000n; // keep 0.02 SOL for fees
const IP_COOLDOWN_MS = 5_000;
const lastByIp = new Map<string, number>();

const json = (status: number, message: string, extra: object = {}) =>
  new Response(JSON.stringify({ message, ...extra }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request): Promise<Response> {
  if (/mainnet/i.test(RPC_URL)) return json(403, 'The house only plays on devnet.');
  const secret = process.env.FAUCET_SECRET_KEY;
  if (!secret) return json(503, 'The house is not set up yet.');

  let target: Address;
  try {
    target = address(String(((await req.json()) as { battle?: unknown }).battle));
  } catch {
    return json(400, 'Invalid battle address.');
  }
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (Date.now() - (lastByIp.get(ip) ?? 0) < IP_COOLDOWN_MS) return json(429, 'One moment — the house is on it.');
  lastByIp.set(ip, Date.now());

  try {
    const house = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(secret) as number[]));
    const c = await createClient().use(signer(house)).use(solanaRpc({ rpcUrl: RPC_URL, transactionConfig: { version: 0 } }));

    // A battle created a moment ago may not be visible to this RPC node yet: retry briefly.
    let battle;
    for (let i = 0; i < 6 && !battle; i++) {
      if (i) await sleep(1000);
      battle = await fetchBattle(c.rpc, target);
    }
    if (!battle || battle.status !== BattleStatus.Open) return json(409, 'That battle is no longer open.');
    if (battle.creator === house.address) return json(400, 'The house can’t play itself.');
    if (battle.amount > HOUSE_MAX) return json(400, `The house only plays battles up to ${Number(HOUSE_MAX) / 1e9} SOL.`);
    const { value: bal } = await c.rpc.getBalance(house.address, { commitment: 'confirmed' }).send();
    if (bal < battle.amount + RESERVE) return json(503, 'The house is out of SOL right now — try a smaller stake.');

    await c.sendTransaction([await buildJoin(c.rpc, house, battle)]);

    // Wait for the fair result (usually ~5s), then pay out. If it takes longer, the site or bot settles later.
    for (let i = 0; i < 12; i++) {
      await sleep(2000);
      try {
        const r = await fetchRandomness(c.rpc, battle.randomnessAccount);
        if (r.state !== 'fulfilled') continue;
        const fresh = await fetchBattle(c.rpc, target);
        if (fresh) await c.sendTransaction([await buildSettle(c.rpc, fresh)]);
      } catch {
        continue; // rate-limited, or a player / the bot settled first
      }
      break;
    }
    return json(200, 'The house joined — flipping!');
  } catch (e) {
    console.error(e);
    lastByIp.delete(ip);
    return json(502, describeError(e));
  }
}

export function GET(): Response {
  return json(405, 'POST { battle } to play the house.');
}
