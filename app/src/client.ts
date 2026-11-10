import { createClient } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { walletSigner } from '@solana/kit-plugin-wallet';
import { CHAIN, RPC_URL } from './config';

// One wallet connection shared by both senders below.
const base = createClient().use(walletSigner({ chain: CHAIN }));

// Default: transaction v1. Wallets that cannot sign v1 yet go through the v0 client.
export const client = base.use(solanaRpc({ rpcUrl: RPC_URL, transactionConfig: { version: 1 } }));
export const clientV0 = base.use(solanaRpc({ rpcUrl: RPC_URL, transactionConfig: { version: 0 } }));

export type AppClient = Awaited<typeof client>;
