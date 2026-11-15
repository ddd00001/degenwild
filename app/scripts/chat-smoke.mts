// Smoke test for the chat edge function: login with a fresh keypair, send, read back, check rate limit + bad token.
import { generateKeyPairSigner } from '@solana/kit';
import { SUPABASE_KEY, SUPABASE_URL, chatLogin, sendChat } from '../src/chat.ts';

const s = await generateKeyPairSigner();
const token = await chatLogin(s);
console.log('login ok');
await sendChat(token, `smoke test ${new Date().toISOString()}`);
console.log('send ok');
try { await sendChat(token, 'too fast'); console.log('RATE LIMIT MISSING'); } catch (e) { console.log('rate limit ok:', (e as Error).message); }
try { await sendChat(token.slice(0, -2) + 'xx', 'forged'); console.log('FORGERY ACCEPTED'); } catch (e) { console.log('forged token rejected:', (e as Error).message); }
const r = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages?select=wallet,body&order=id.desc&limit=1`, { headers: { apikey: SUPABASE_KEY } });
console.log('read:', JSON.stringify(await r.json()));
const w = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, { method: 'POST', headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ wallet: s.address, body: 'direct insert' }) });
console.log('direct anon insert status (want 401/403):', w.status);
