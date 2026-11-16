// Devnet: initialize the jackpot (once) and optionally play a full round with 3 throwaway wallets.
//   npx tsx scripts/jackpot-e2e.mts init
//   npx tsx scripts/jackpot-e2e.mts round    (full round, 3 wallets)
//   npx tsx scripts/jackpot-e2e.mts enter    (2 wallets enter, the site/keeper does the rest)
//   npx tsx scripts/jackpot-e2e.mts crowd    (4 wallets join 8s apart: 0.15/0.10/0.35/0.40 SOL)
//   npx tsx scripts/jackpot-e2e.mts sweep    (send everything left in saved test wallets back to the house)
// Test wallet keys are saved to ~/.config/solana/degenwild-test-wallets.json (outside the repo) so no SOL is stranded.
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AccountRole, type Instruction, type KeyPairSigner, createClient, createKeyPairSignerFromPrivateKeyBytes, getU32Encoder, getU64Encoder, address } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer, signerFromFile } from '@solana/kit-plugin-signer';
import { buildDrawJackpot, buildEnterJackpot, buildInitJackpot, buildSettleJackpot, describeError, fetchJackpot, fetchRandomnessBytes, jackpotWinner } from '../src/chain.ts';

const RPC = process.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com';
const cli = await createClient().use(signerFromFile(`${homedir()}/.config/solana/id.json`)).use(solanaRpc({ rpcUrl: RPC }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HOUSE = address('CMSsRH5GeVceA6Ck3nhi63C8o6ZgJQR3mujypXHF7sqo');
const WALLETS_FILE = `${homedir()}/.config/solana/degenwild-test-wallets.json`;
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
const savedSeeds = (): string[] => (existsSync(WALLETS_FILE) ? (JSON.parse(readFileSync(WALLETS_FILE, 'utf8')) as string[]) : []);
/** A throwaway wallet whose key is kept on disk, so `sweep` can return its SOL later. */
async function testWallet(): Promise<KeyPairSigner> {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  writeFileSync(WALLETS_FILE, JSON.stringify([...savedSeeds(), toHex(seed)]), { mode: 0o600 });
  return createKeyPairSignerFromPrivateKeyBytes(seed);
}

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

if (process.argv[2] === 'sweep') {
  let total = 0n;
  const keep: string[] = [];
  for (const hex of savedSeeds()) {
    const kp = await createKeyPairSignerFromPrivateKeyBytes(fromHex(hex));
    const c = await createClient().use(signer(kp)).use(solanaRpc({ rpcUrl: RPC }));
    const bal = BigInt((await c.rpc.getBalance(kp.address).send()).value);
    const amount = bal - 5_000n;
    if (amount <= 0n) continue;
    const data = new Uint8Array(12);
    data.set(getU32Encoder().encode(2), 0);
    data.set(getU64Encoder().encode(amount), 4);
    try {
      await c.sendTransaction([
        {
          programAddress: address('11111111111111111111111111111111'),
          accounts: [
            { address: kp.address, role: AccountRole.WRITABLE_SIGNER, signer: kp } as never,
            { address: HOUSE, role: AccountRole.WRITABLE },
          ],
          data,
        },
      ]);
      total += amount;
      console.log(`${kp.address}: returned ${Number(amount) / 1e9} SOL`);
    } catch (e) {
      keep.push(hex); // still in a round, try again later
      console.log(`${kp.address}: kept (${describeError(e)})`);
    }
  }
  writeFileSync(WALLETS_FILE, JSON.stringify(keep), { mode: 0o600 });
  console.log(`returned ${Number(total) / 1e9} SOL to the house`);
  process.exit(0);
} else if (process.argv[2] === 'init') {
  const j = await fetchJackpot(cli.rpc);
  if (j.state) console.log('already initialized, current round', j.state.currentRound);
  else {
    await cli.sendTransaction([await buildInitJackpot(cli.identity)]);
    console.log('initialized:', (await fetchJackpot(cli.rpc)).state);
  }
} else {
  // crowd: 4 wallets join one by one (8s apart) so the site's join animations, colors and milestones can be watched.
  // eleven: 11 wallets, 7s apart; the pot crosses 0.5 (3rd), 1 (5th), 2 (7th) and 5 SOL (11th).
  const eleven = process.argv[2] === 'eleven';
  // fourteen: 14 wallets, ~3 SOL total (vault ~3/4 full), 6s apart.
  const fourteen = process.argv[2] === 'fourteen';
  const crowd = process.argv[2] === 'crowd' || eleven || fourteen;
  const onlyEnter = process.argv[2] === 'enter' || crowd;
  const stakes = fourteen
    ? [150, 100, 250, 200, 300, 100, 150, 350, 200, 250, 150, 300, 100, 200].map((m) => BigInt(m) * 1_000_000n)
    : eleven
    ? [200, 200, 150, 250, 300, 400, 600, 700, 900, 600, 800].map((m) => BigInt(m) * 1_000_000n)
    : crowd
    ? [150_000_000n, 100_000_000n, 350_000_000n, 400_000_000n]
    : onlyEnter
      ? [300_000_000n, 200_000_000n]
      : [1_000_000_000n, 2_000_000_000n, 500_000_000n];
  const players: KeyPairSigner[] = [];
  for (const _ of stakes) players.push(await testWallet());
  await cli.sendTransaction(players.map((p, i) => transfer(p.address, stakes[i] + 30_000_000n)));
  for (const [i, p] of players.entries()) {
    const c = await createClient().use(signer(p)).use(solanaRpc({ rpcUrl: RPC }));
    const j = await fetchJackpot(c.rpc);
    await c.sendTransaction([await buildEnterJackpot(p, stakes[i], j.state!.currentRound)]);
    console.log(`player ${i + 1} entered ${Number(stakes[i]) / 1e9} SOL`);
    if (crowd && i < players.length - 1) await sleep(fourteen ? 6000 : eleven ? 7000 : 8000);
  }
  if (onlyEnter) process.exit(0);
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
