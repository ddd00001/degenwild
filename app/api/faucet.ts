// Vercel function: sends free devnet SOL to a demo wallet so visitors can try DegenWild.
//
// Env (set in Vercel → Project → Settings → Environment Variables):
//   FAUCET_SECRET_KEY  JSON array of the faucet keypair's 64 bytes (a dedicated devnet-only wallet)
//   FAUCET_RPC_URL     optional, defaults to the public devnet RPC
//
// Abuse limits: devnet only, fixed amount (FAUCET_DRIP_SOL, default 0.4), only to wallets that are nearly empty,
// one request per IP per 10 minutes, and a per-instance hourly cap. Worst case someone
// drains the faucet wallet of devnet SOL, which has no value.
import {
  AccountRole,
  type Address,
  type Instruction,
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getU32Encoder,
  getU64Encoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';

const RPC_URL = process.env.FAUCET_RPC_URL ?? 'https://api.devnet.solana.com';
const DRIP = BigInt(Math.round(Number(process.env.FAUCET_DRIP_SOL ?? 0.4) * 1e9)); // default 0.4 SOL
const MIN_DRIP = 200_000_000n; // if the faucet runs low, still send at least 0.2 SOL
const ONLY_BELOW = 60_000_000n; // only fund wallets holding less than 0.06 SOL
const IP_COOLDOWN_MS = 10 * 60_000;
const HOUSE_RESERVE = 3_000_000_000n; // never drip below 3 SOL: the same wallet is Degen Bot's bankroll
const HOURLY_CAP = 60;
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');

const lastByIp = new Map<string, number>();
let hour = { start: Date.now(), count: 0 };

const json = (status: number, message: string, extra: object = {}) =>
  new Response(JSON.stringify({ message, ...extra }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function transferIx(from: Parameters<typeof setTransactionMessageFeePayerSigner>[0], to: Address, lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  data.set(getU32Encoder().encode(2), 0); // SystemInstruction::Transfer
  data.set(getU64Encoder().encode(lamports), 4);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: from.address, role: AccountRole.WRITABLE_SIGNER, signer: from } as never,
      { address: to, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

export async function POST(req: Request): Promise<Response> {
  if (/mainnet/i.test(RPC_URL)) return json(403, 'The faucet only runs on devnet.');
  const secret = process.env.FAUCET_SECRET_KEY;
  if (!secret) return json(503, 'The demo faucet is not set up yet.');

  let to: Address;
  try {
    const body = (await req.json()) as { address?: unknown };
    to = address(String(body.address));
  } catch {
    return json(400, 'Invalid wallet address.');
  }

  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const now = Date.now();
  if (now - (lastByIp.get(ip) ?? 0) < IP_COOLDOWN_MS) {
    const mins = Math.ceil((IP_COOLDOWN_MS - (now - lastByIp.get(ip)!)) / 60_000);
    return json(429, `You just got demo SOL — try again in ${mins} min.`);
  }
  if (now - hour.start > 3_600_000) hour = { start: now, count: 0 };
  if (hour.count >= HOURLY_CAP) return json(429, 'The faucet is busy — try again later.');

  const rpc = createSolanaRpc(RPC_URL);
  try {
    const { value: balance } = await rpc.getBalance(to, { commitment: 'confirmed' }).send();
    if (balance >= ONLY_BELOW) return json(400, 'This wallet already has enough demo SOL to play.');

    const faucet = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(secret) as number[]));
    const { value: faucetBalance } = await rpc.getBalance(faucet.address, { commitment: 'confirmed' }).send();
    // Send the full drip, or whatever the faucet can spare (but at least MIN_DRIP).
    const spare = faucetBalance - HOUSE_RESERVE;
    const amount = spare >= DRIP ? DRIP : spare;
    if (amount < MIN_DRIP) return json(503, 'The faucet is empty right now — check back soon.');

    lastByIp.set(ip, now);
    hour.count++;

    const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
    const msg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(faucet, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstruction(transferIx(faucet, to, amount), m),
    );
    const tx = await signTransactionMessageWithSigners(msg);
    const sig = getSignatureFromTransaction(tx);
    await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();

    // Wait (briefly) for confirmation so the site sees the new balance right away.
    for (let i = 0; i < 20; i++) {
      const { value } = await rpc.getSignatureStatuses([sig]).send();
      const st = value[0];
      if (st?.err) return json(502, 'The transfer failed — try again.');
      if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') break;
      await new Promise((r) => setTimeout(r, 750));
    }
    return json(200, `Sent ${Number(amount) / 1e9} free demo SOL — pick a side and flip!`, { signature: sig });
  } catch (e) {
    lastByIp.delete(ip);
    console.error(e);
    return json(502, 'The faucet hit a network error — try again in a minute.');
  }
}

export function GET(): Response {
  return json(405, 'POST { address } to get demo SOL.');
}
