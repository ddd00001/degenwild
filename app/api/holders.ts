// Vercel function: top $WILD holders, read from Solana mainnet (pump.fun coins live on mainnet).
//
//   GET /api/holders?mint=<mint address>
//
// Env: HOLDERS_RPC_URL  a mainnet RPC URL (optional). Defaults to FAUCET_RPC_URL with "devnet" swapped for
// "mainnet" (Helius keys work on both), else the public mainnet RPC. Read-only, cached for 60 s.
// Self-contained on purpose: Vercel loads api/*.ts without bundling, so no imports from ../src.
const RPC =
  process.env.HOLDERS_RPC_URL ??
  (process.env.FAUCET_RPC_URL?.includes('devnet') ? process.env.FAUCET_RPC_URL.replace('devnet', 'mainnet') : undefined) ??
  'https://api.mainnet-beta.solana.com';

const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const LIMIT = 100;
const cache = new Map<string, { at: number; body: string }>();

function base58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (res.status !== 429 || attempt >= 4) break;
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // rate-limited: back off and retry
  }
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error || json.result === undefined) throw new Error(json.error?.message ?? `RPC ${res.status}`);
  return json.result;
}

type Acc = { account: { data: [string, string] } };

/** Helius getProgramAccountsV2 (paginated, needed for big holder lists); falls back to the standard method elsewhere. */
async function tokenAccounts(program: string, mint: string): Promise<Acc[]> {
  const cfg = { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: mint } }] };
  try {
    const out: Acc[] = [];
    let paginationKey: string | null | undefined;
    for (let page = 0; page < 30; page++) {
      const r = await rpc<{ accounts: Acc[]; paginationKey?: string | null }>('getProgramAccountsV2', [
        program,
        { ...cfg, limit: 10_000, ...(paginationKey ? { paginationKey } : {}) },
      ]);
      out.push(...r.accounts);
      paginationKey = r.paginationKey;
      if (!paginationKey) break;
    }
    return out;
  } catch (e) {
    if (!/method not found|not supported|-32601/i.test(String(e))) throw e;
    return rpc<Acc[]>('getProgramAccounts', [program, cfg]);
  }
}

const reply = (status: number, body: unknown, maxAge = 0) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': maxAge ? `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 5}` : 'no-store',
    },
  });

export async function GET(req: Request): Promise<Response> {
  const mint = new URL(req.url).searchParams.get('mint') ?? '';
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return reply(400, { error: 'Invalid mint address.' });

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < 60_000) return reply(200, hit.body, 60);

  try {
    // Every token account of this mint (classic SPL Token and Token-2022). Mint is at offset 0, owner at 32, amount at 64.
    // One program at a time: free RPC tiers rate-limit parallel scans.
    const lists: Acc[][] = [];
    for (const program of TOKEN_PROGRAMS) lists.push(await tokenAccounts(program, mint));
    const byOwner = new Map<string, bigint>();
    for (const { account } of lists.flat()) {
      const d = Buffer.from(account.data[0], 'base64');
      if (d.length < 40) continue;
      const amount = d.readBigUInt64LE(32);
      if (amount === 0n) continue;
      const owner = base58(d.subarray(0, 32));
      byOwner.set(owner, (byOwner.get(owner) ?? 0n) + amount);
    }

    const supplyInfo = await rpc<{ value: { amount: string; decimals: number } }>('getTokenSupply', [mint, { commitment: 'confirmed' }]);
    const supply = BigInt(supplyInfo.value.amount);
    const top = [...byOwner.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, LIMIT);

    const body = JSON.stringify({
      mint,
      decimals: supplyInfo.value.decimals,
      supply: supply.toString(),
      holderCount: byOwner.size,
      updatedAt: Date.now(),
      holders: top.map(([owner, amount], i) => ({
        rank: i + 1,
        owner,
        amount: amount.toString(),
        percent: supply ? Number((amount * 1_000_000n) / supply) / 10_000 : 0,
      })),
    });
    cache.set(mint, { at: Date.now(), body });
    return reply(200, body, 60);
  } catch (e) {
    console.error(e);
    return reply(502, { error: 'Could not load holders right now.' });
  }
}
