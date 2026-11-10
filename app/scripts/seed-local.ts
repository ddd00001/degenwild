// Puts a few open battles on a local Surfpool fork so the lobby isn't empty.
//   npx tsx scripts/seed-local.ts [yourWalletAddress]   (optionally funds your wallet with 100 SOL)
import { createClient, generateKeyPairSigner } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';
import { buildCreate } from '../src/chain';

const RPC = 'http://127.0.0.1:8899';
const cheat = (method: string, params: unknown[]) =>
  fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());

const stakes: [bigint, 0 | 1][] = [[250_000_000n, 0], [100_000_000n, 1], [500_000_000n, 0], [1_000_000_000n, 1]];
for (const [amount, side] of stakes) {
  const kp = await generateKeyPairSigner();
  await cheat('surfnet_setAccount', [kp.address, { lamports: 5_000_000_000 }]);
  const c = createClient().use(signer(kp)).use(solanaRpc({ rpcUrl: RPC }));
  await c.sendTransaction([(await buildCreate(kp, amount, side)).ix]);
  console.log(`open battle: ${kp.address.slice(0, 4)}… ${Number(amount) / 1e9} SOL ${side ? 'TAILS' : 'HEADS'}`);
}
if (process.argv[2]) {
  await cheat('surfnet_setAccount', [process.argv[2], { lamports: 100_000_000_000 }]);
  console.log(`funded ${process.argv[2]} with 100 SOL`);
}
