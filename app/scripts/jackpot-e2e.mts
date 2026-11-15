// Devnet: initialize the jackpot (once) and optionally play a full round with 3 throwaway wallets.
//   npx tsx scripts/jackpot-e2e.mts init
//   npx tsx scripts/jackpot-e2e.mts round
import { homedir } from 'node:os';
import { AccountRole, type Instruction, createClient, generateKeyPairSigner, getU32Encoder, getU64Encoder, address } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer, signerFromFile } from '@solana/kit-plugin-signer';
import { buildDrawJackpot, buildEnterJackpot, buildInitJackpot, buildSettleJackpot, describeError, fetchJackpot, fetchRandomnessBytes, jackpotWinner } from '../src/chain.ts';

const RPC = process.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com';
const cli = await createClient().use(signerFromFile(`${homedir()}/.config/solana/id.json`)).use(solanaRpc({ rpcUrl: RPC }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function transfer(to: string, lamports: bigint): Instruction {
  const data = new Uint8Array(12);
  data.set(getU32Encoder().encode(2), 0);
  data.set(getU64Encoder().encode(lamports), 4);
  return {
    programAddress: address('11111111111111111111111111111111'),
    accounts: [
      { address: cli.identity.address, role: AccountRole.WRITABLE_SIGNER, signer: cli.identity } as never,
      { address: address(to), role: AccountRole.WRITABLE },
    ],
    data,
  };
}

if (process.argv[2] === 'init') {
  const j = await fetchJackpot(cli.rpc);
  if (j.state) console.log('already initialized, current round', j.state.currentRound);
  else {
    await cli.sendTransaction([await buildInitJackpot(cli.identity)]);
    console.log('initialized:', (await fetchJackpot(cli.rpc)).state);
  }
} else {
  const stakes = [1_000_000_000n, 2_000_000_000n, 500_000_000n];
  const players = await Promise.all(stakes.map(() => generateKeyPairSigner()));
  await cli.sendTransaction(players.map((p, i) => transfer(p.address, stakes[i] + 30_000_000n)));
  for (const [i, p] of players.entries()) {
    const c = await createClient().use(signer(p)).use(solanaRpc({ rpcUrl: RPC }));
    const j = await fetchJackpot(c.rpc);
    await c.sendTransaction([await buildEnterJackpot(p, stakes[i], j.state!.currentRound)]);
    console.log(`player ${i + 1} entered ${Number(stakes[i]) / 1e9} SOL`);
  }
  let j = await fetchJackpot(cli.rpc);
  const end = Number(j.round!.countdownEnd);
  console.log(`round ${j.state!.currentRound}: total ${Number(j.round!.total) / 1e9} SOL, countdown ends in ${end - Math.floor(Date.now() / 1000)}s`);
  while (Date.now() / 1000 < end + 2) await sleep(5000);
  await cli.sendTransaction([await buildDrawJackpot(cli.rpc, cli.identity, j.round!.address, j.round!.roundId)]);
  console.log('draw requested');
  j = await fetchJackpot(cli.rpc);
  for (let i = 0; i < 30; i++) {
    const r = await fetchRandomnessBytes(cli.rpc, j.round!.randomnessAccount);
    if (r) {
      const w = jackpotWinner(j.round!.entries, j.round!.total, r);
      console.log(`randomness landed: ticket ${Number(w.ticket) / 1e9} SOL -> player ${w.index + 1}`);
      break;
    }
    await sleep(2000);
  }
  const before = await Promise.all(players.map((p) => cli.rpc.getBalance(p.address).send()));
  try {
    await cli.sendTransaction([await buildSettleJackpot(cli.rpc, j.round!)]);
  } catch (e) {
    console.error('settle failed:', describeError(e));
    process.exit(1);
  }
  const after = await Promise.all(players.map((p) => cli.rpc.getBalance(p.address).send()));
  after.forEach((a, i) => console.log(`player ${i + 1}: +${(Number(a.value - before[i].value) / 1e9).toFixed(6)} SOL`));
  console.log('state after:', (await fetchJackpot(cli.rpc)).state);
}
