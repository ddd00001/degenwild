// Vercel function: keeps the jackpot moving without anyone pressing a button.
// When the countdown is over it requests the randomness (the house wallet pays ORAO's fee),
// and once the result lands it pays the winner. Refunds a round whose randomness never came.
// Safe to call any time and from anyone: every step is checked on-chain.
//
//   POST /api/jackpot      -> { message, step }
//
// Env: FAUCET_SECRET_KEY (house wallet), FAUCET_RPC_URL (private devnet RPC). Devnet only.
import { createClient, createKeyPairSignerFromBytes } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import {
  buildDrawJackpot,
  buildRefundJackpot,
  buildSettleJackpot,
  describeError,
  fetchJackpot,
  fetchRandomnessBytes,
} from '../src/chain.ts';
import { JackpotStatus } from '../src/generated/index.ts';

const RPC_URL = process.env.FAUCET_RPC_URL ?? 'https://api.devnet.solana.com';
const REFUND_TIMEOUT_SLOTS = 750n;
let busyUntil = 0;

const json = (status: number, message: string, step = 'none') =>
  new Response(JSON.stringify({ message, step }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function POST(): Promise<Response> {
  if (/mainnet/i.test(RPC_URL)) return json(403, 'Devnet only.');
  const secret = process.env.FAUCET_SECRET_KEY;
  if (!secret) return json(503, 'The jackpot keeper is not set up yet.');
  // One step at a time per instance; callers poll every few seconds anyway.
  if (Date.now() < busyUntil) return json(200, 'Working on it…', 'busy');
  busyUntil = Date.now() + 8_000;

  try {
    const house = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(secret) as number[]));
    const c = await createClient().use(signer(house)).use(solanaRpc({ rpcUrl: RPC_URL, transactionConfig: { version: 0 } }));
    const { round } = await fetchJackpot(c.rpc);
    if (!round) return json(200, 'No active round.');

    if (round.status === JackpotStatus.Open) {
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (round.countdownEnd === 0n || now < round.countdownEnd) return json(200, 'Countdown still running.');
      await c.sendTransaction([await buildDrawJackpot(c.rpc, house, round.address, round.roundId)]);
      return json(200, 'Spinning…', 'draw');
    }

    // Drawing: settle once the randomness is in, refund if it never arrives.
    if (await fetchRandomnessBytes(c.rpc, round.randomnessAccount)) {
      await c.sendTransaction([await buildSettleJackpot(c.rpc, round)]);
      return json(200, 'Winner paid.', 'settle');
    }
    const slot = await c.rpc.getSlot({ commitment: 'confirmed' }).send();
    if (slot >= round.drawnSlot + REFUND_TIMEOUT_SLOTS) {
      await c.sendTransaction([await buildRefundJackpot(round)]);
      return json(200, 'Randomness timed out: everyone refunded.', 'refund');
    }
    return json(200, 'Waiting for the fair result…', 'waiting');
  } catch (e) {
    console.error(e);
    // Most often another caller did the same step first.
    return json(200, describeError(e), 'error');
  } finally {
    busyUntil = 0;
  }
}

export function GET(): Response {
  return json(405, 'POST to advance the jackpot.');
}
