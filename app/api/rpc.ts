// Vercel function: forwards the site's Solana JSON-RPC calls to a private RPC (Helius),
// so the API key stays on the server and visitors aren't rate-limited by the public devnet RPC.
//
// Env: FAUCET_RPC_URL  the private devnet RPC URL (with key). Devnet only.
const UPSTREAM = process.env.FAUCET_RPC_URL ?? 'https://api.devnet.solana.com';

// Only what the site uses.
const ALLOWED = new Set([
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getEpochInfo',
  'getFeeForMessage',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getMultipleAccounts',
  'getProgramAccounts',
  'getRecentPrioritizationFees',
  'getSignaturesForAddress',
  'getSignatureStatuses',
  'getSlot',
  'getTransaction',
  'isBlockhashValid',
  'sendTransaction',
  'simulateTransaction',
]);

type RpcCall = { method?: unknown; id?: unknown };

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function POST(req: Request): Promise<Response> {
  if (/mainnet/i.test(UPSTREAM)) return reply(403, { error: 'devnet only' });
  const text = await req.text();
  if (text.length > 200_000) return reply(413, { error: 'request too large' });
  let body: RpcCall | RpcCall[];
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length > 20) return reply(400, { error: 'batch too large' });
  const bad = calls.find((c) => typeof c.method !== 'string' || !ALLOWED.has(c.method));
  if (bad) return reply(403, { jsonrpc: '2.0', id: bad.id ?? null, error: { code: -32601, message: `Method not allowed: ${String(bad.method)}` } });

  const res = await fetch(UPSTREAM, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}
