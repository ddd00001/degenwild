// Demo wallet: a throwaway keypair kept in this browser, so visitors can play on devnet
// without installing a wallet or finding devnet SOL. Never used on mainnet.
import { type KeyPairSigner, createClient, createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { CLUSTER, RPC_URL } from './config';

const KEY = 'degenwild:demo-wallet';

export const DEMO_ENABLED = CLUSTER !== 'mainnet';

/** Where the faucet lives. Same origin on Vercel; override with VITE_FAUCET_URL (e.g. for GitHub Pages). */
export const FAUCET_URL: string = import.meta.env?.VITE_FAUCET_URL ?? '/api/faucet';

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

function readSeed(): Uint8Array | null {
  try {
    const s = localStorage.getItem(KEY);
    return s && /^[0-9a-f]{64}$/.test(s) ? fromHex(s) : null;
  } catch {
    return null;
  }
}

export async function loadBurner(create: boolean): Promise<KeyPairSigner | null> {
  if (!DEMO_ENABLED) return null;
  let seed = readSeed();
  if (!seed) {
    if (!create) return null;
    seed = crypto.getRandomValues(new Uint8Array(32));
    try {
      localStorage.setItem(KEY, toHex(seed));
    } catch {
      /* private window: the demo wallet lasts until the tab closes */
    }
  }
  return createKeyPairSignerFromPrivateKeyBytes(seed);
}

export function forgetBurner() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function burnerClient(kp: KeyPairSigner) {
  return await createClient().use(signer(kp)).use(solanaRpc({ rpcUrl: RPC_URL, transactionConfig: { version: 0 } }));
}
export type BurnerClient = Awaited<ReturnType<typeof burnerClient>>;

/** Asks the faucet for demo SOL. Returns a message to show the player. */
export async function requestDemoSol(address: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(FAUCET_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: res.ok, message: body.message ?? (res.ok ? 'Demo SOL sent.' : `Faucet error (${res.status}).`) };
  } catch {
    return { ok: false, message: 'The faucet is unreachable right now — try again in a minute.' };
  }
}
