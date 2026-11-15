// Calls the faucet handler locally against devnet: FAUCET_SECRET_KEY="$(cat faucet.json)" npx tsx scripts/test-faucet.mts
import { generateKeyPairSigner } from '@solana/kit';
import { POST } from '../api/faucet.ts';

const kp = await generateKeyPairSigner();
const call = async () => {
  const res = await POST(new Request('http://x/api/faucet', { method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify({ address: kp.address }) }));
  console.log(res.status, await res.text());
};
await call(); // should send 0.2 SOL
await call(); // should hit the IP cooldown
const bad = await POST(new Request('http://x', { method: 'POST', body: '{"address":"nope"}' }));
console.log(bad.status, await bad.text());
