import { address } from '@solana/kit';

export type Cluster = 'devnet' | 'localnet' | 'mainnet';

/** Which cluster the site talks to. Defaults to devnet; mainnet must be opted into explicitly. */
export const CLUSTER = (import.meta.env?.VITE_CLUSTER ?? 'devnet') as Cluster;

const DEFAULT_RPC: Record<Cluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
  mainnet: 'https://api.mainnet-beta.solana.com',
};

export const RPC_URL: string = import.meta.env?.VITE_RPC_URL ?? DEFAULT_RPC[CLUSTER];

/** Wallet Standard chain. Wallets rarely advertise solana:localnet, so override with VITE_WALLET_CHAIN=solana:devnet when testing locally. */
export const CHAIN = (import.meta.env?.VITE_WALLET_CHAIN ?? `solana:${CLUSTER}`) as `solana:${string}`;

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
