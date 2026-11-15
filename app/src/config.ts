import { address } from '@solana/kit';

export type Cluster = 'devnet' | 'localnet' | 'mainnet';

/** Which cluster the site talks to. Defaults to devnet; mainnet must be opted into explicitly. */
export const CLUSTER = (import.meta.env?.VITE_CLUSTER ?? 'devnet') as Cluster;

const DEFAULT_RPC: Record<Cluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
  mainnet: 'https://api.mainnet-beta.solana.com',
};

/**
 * Deployed devnet site (Vercel): go through our /api/rpc proxy, which uses a private RPC server-side.
 * Local dev, scripts and the GitHub Pages copy (no functions there) use VITE_RPC_URL or the public RPC.
 */
const useProxy =
  CLUSTER === 'devnet' &&
  !import.meta.env?.VITE_RPC_URL &&
  !import.meta.env?.VITE_PAGES &&
  typeof location !== 'undefined' &&
  !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export const RPC_URL: string = useProxy
  ? `${location.origin}/api/rpc`
  : (import.meta.env?.VITE_RPC_URL ?? DEFAULT_RPC[CLUSTER]);

/** WebSocket for confirmations. The proxy is HTTP-only, so it uses the public devnet socket (per-visitor limits). */
export const RPC_WS_URL: string | undefined = useProxy ? 'wss://api.devnet.solana.com' : undefined;

/** Wallet Standard chain. Wallets rarely advertise solana:localnet, so override with VITE_WALLET_CHAIN=solana:devnet when testing locally. */
export const CHAIN = (import.meta.env?.VITE_WALLET_CHAIN ?? `solana:${CLUSTER}`) as `solana:${string}`;

/** Mirrors PLATFORM_ADMIN in programs/degenwild/src/constants.rs. */
export const PLATFORM_ADMIN = address('4VUJ1pCqT1TWQhKFSyDC7EP9HkEAUSGrcaBpYhCEfx7b');

/** Devnet house wallet (faucet + house opponent). Shown as HOUSE_NAME instead of an address. */
export const HOUSE_WALLET = address('CMSsRH5GeVceA6Ck3nhi63C8o6ZgJQR3mujypXHF7sqo');
export const HOUSE_NAME = 'Degen Bot';

export const ORAO_VRF_PROGRAM = address('VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y');

/** Mirrors programs/degenwild/src/constants.rs */
export const MIN_STAKE_LAMPORTS = 50_000_000n; // 0.05 SOL
export const MAX_STAKE_LAMPORTS = 10_000_000_000n; // 10 SOL
export const COINFLIP_FEE_BPS = 350n; // 3.5%
export const REFUND_TIMEOUT_SLOTS = 750n;

/** How often the lobby re-reads chain state. */
export const POLL_MS = 5_000;

export function explorerTx(signature: string): string {
  const q = CLUSTER === 'mainnet' ? '' : CLUSTER === 'localnet'
    ? `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`
    : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${q}`;
}
