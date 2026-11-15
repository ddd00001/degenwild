// DegenWild chat: the only way to write to public.chat_messages.
//  POST { action: 'login', wallet, issued, signature }  -> { token }   (wallet signed the login text)
//  POST { action: 'send', token, body }                  -> { ok }
// Tokens are HMAC-signed "wallet|expiry", valid 7 days. Keyed from the service role key, so nothing to configure.
import { createClient } from 'npm:@supabase/supabase-js@2';
import bs58 from 'npm:bs58@6';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY, { auth: { persistSession: false } });
const TOKEN_DAYS = 7;
const MAX_LEN = 200;
const MIN_GAP_MS = 2500;
const ORIGINS = [/^https:\/\/degenwild(-[a-z0-9-]+)?\.vercel\.app$/, /^https:\/\/[a-z0-9-]+\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

const cors = (origin: string | null) => ({
  'access-control-allow-origin': origin && ORIGINS.some((r) => r.test(origin)) ? origin : 'https://degenwild.vercel.app',
  'access-control-allow-headers': 'content-type, apikey, authorization, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  vary: 'origin',
});

const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
let hmacKey: CryptoKey | null = null;
async function hmac(data: string): Promise<string> {
  hmacKey ??= await crypto.subtle.importKey('raw', enc.encode(`degenwild-chat:${SERVICE_KEY}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, enc.encode(data))));
}

async function verifyToken(token: string): Promise<string | null> {
  const [payload, mac] = String(token).split('.');
  if (!payload || !mac || (await hmac(payload)) !== mac) return null;
  const [wallet, exp] = atob(payload).split('|');
  return Number(exp) * 1000 > Date.now() ? wallet : null;
}

async function verifySignature(wallet: string, text: string, sigB58: string): Promise<boolean> {
  try {
    const pub = bs58.decode(wallet);
    const sig = bs58.decode(sigB58);
    if (pub.length !== 32 || sig.length !== 64) return false;
    const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, sig, enc.encode(text));
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get('origin'));
  const out = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, 'content-type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return out(405, { error: 'POST only.' });

  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return out(400, { error: 'Bad request.' });
  }

  if (b.action === 'login') {
    const wallet = String(b.wallet ?? '');
    const issued = Number(b.issued);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return out(400, { error: 'Bad wallet.' });
    if (!Number.isFinite(issued) || Math.abs(Date.now() / 1000 - issued) > 600) return out(400, { error: 'Login expired, try again.' });
    const text = `DegenWild chat login\nWallet: ${wallet}\nIssued: ${issued}\n\nThis signature is free and does not move any funds.`;
    if (!(await verifySignature(wallet, text, String(b.signature ?? '')))) return out(401, { error: 'Signature check failed.' });
    const payload = btoa(`${wallet}|${Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400}`);
    return out(200, { token: `${payload}.${await hmac(payload)}` });
  }

  if (b.action === 'send') {
    const wallet = await verifyToken(String(b.token ?? ''));
    if (!wallet) return out(401, { error: 'Invalid token: sign in again.' });
    const body = String(b.body ?? '')
      .replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_LEN);
    if (!body) return out(400, { error: 'Empty message.' });

    const { data: last } = await db.from('chat_messages').select('created_at').eq('wallet', wallet).order('id', { ascending: false }).limit(1);
    if (last?.[0] && Date.now() - Date.parse(last[0].created_at) < MIN_GAP_MS) return out(429, { error: 'Slow down a little.' });

    const { error } = await db.from('chat_messages').insert({ wallet, body });
    if (error) return out(500, { error: 'Message not saved.' });
    return out(200, { ok: true });
  }

  return out(400, { error: 'Unknown action.' });
});
