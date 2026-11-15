// Live chat + "online now" counter, backed by Supabase.
// Reading is public. Writing goes through the `chat` edge function, which only accepts
// a wallet that has signed a one-time login message (no transaction, no fee).
import { type Address, type MessageSigner, type TransactionSigner, createSignableMessage, getBase58Decoder } from '@solana/kit';
import { type RealtimeChannel, type SupabaseClient, createClient } from '@supabase/supabase-js';
import { useEffect, useState, useSyncExternalStore } from 'react';

/** Public project URL + publishable key (safe in the browser: the table is read-only for it). */
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';
export const CHAT_ENABLED = !!SUPABASE_URL && !!SUPABASE_KEY;

export type ChatMessage = { id: number; wallet: Address; body: string; created_at: string };
export const MAX_CHAT_LEN = 200;

let sb: SupabaseClient | null = null;
const supa = () => (sb ??= createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } }));

// ---------- online counter (Realtime presence, one shared channel per tab) ----------
let online = 0;
let presence: RealtimeChannel | null = null;
const listeners = new Set<() => void>();
const visitorId = (() => {
  try {
    const k = 'dw-visitor';
    return localStorage.getItem(k) ?? (localStorage.setItem(k, crypto.randomUUID()), localStorage.getItem(k)!);
  } catch {
    return crypto.randomUUID();
  }
})();

function startPresence() {
  if (presence || !CHAT_ENABLED) return;
  presence = supa().channel('online', { config: { presence: { key: visitorId } } });
  presence
    .on('presence', { event: 'sync' }, () => {
      online = Object.keys(presence!.presenceState()).length;
      listeners.forEach((l) => l());
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') void presence!.track({ at: Date.now() });
    });
}

/** Number of people with the site open right now (0 until connected). */
export function useOnlineCount(): number {
  return useSyncExternalStore(
    (cb) => {
      startPresence();
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => online,
  );
}

// ---------- messages ----------
export function useChatMessages(): ChatMessage[] {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  useEffect(() => {
    if (!CHAT_ENABLED) return;
    let alive = true;
    void supa()
      .from('chat_messages')
      .select('id,wallet,body,created_at')
      .order('id', { ascending: false })
      .limit(60)
      .then(({ data }) => alive && data && setMsgs((data as ChatMessage[]).reverse()));
    const ch = supa()
      .channel('chat-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (p) => {
        const m = p.new as ChatMessage;
        setMsgs((old) => (old.some((o) => o.id === m.id) ? old : [...old, m].slice(-100)));
      })
      .subscribe();
    return () => {
      alive = false;
      void supa().removeChannel(ch);
    };
  }, []);
  return msgs;
}

// ---------- login (sign once, keep a token for 7 days) ----------
const tokenKey = (w: string) => `dw-chat-token:${w}`;
export function savedToken(wallet: Address): string | null {
  try {
    const t = localStorage.getItem(tokenKey(wallet));
    if (!t) return null;
    const exp = Number(atob(t.split('.')[0]).split('|')[1]);
    return exp * 1000 > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}

async function signText(signer: TransactionSigner | MessageSigner, text: string): Promise<string> {
  const msg = createSignableMessage(text);
  let sig: Uint8Array | undefined;
  if ('signMessages' in signer && typeof signer.signMessages === 'function') {
    const [d] = await signer.signMessages([msg]);
    sig = d[signer.address];
  } else if ('modifyAndSignMessages' in signer && typeof signer.modifyAndSignMessages === 'function') {
    const [m] = await signer.modifyAndSignMessages([msg]);
    sig = m.signatures[signer.address] ?? undefined;
  }
  if (!sig) throw new Error('This wallet cannot sign messages. Try Phantom, Solflare or the demo wallet.');
  return getBase58Decoder().decode(sig);
}

async function call(body: object): Promise<{ token?: string; error?: string }> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!r.ok) throw new Error(j.error ?? `Chat error ${r.status}`);
  return j;
}

/** Proves wallet ownership with a free signature (no transaction). */
export async function chatLogin(signer: TransactionSigner | MessageSigner): Promise<string> {
  const issued = Math.floor(Date.now() / 1000);
  const text = `DegenWild chat login\nWallet: ${signer.address}\nIssued: ${issued}\n\nThis signature is free and does not move any funds.`;
  const signature = await signText(signer, text);
  const { token } = await call({ action: 'login', wallet: signer.address, issued, signature });
  try {
    localStorage.setItem(tokenKey(signer.address), token!);
  } catch {
    /* private mode: token lives for this page only */
  }
  return token!;
}

export async function sendChat(token: string, body: string): Promise<void> {
  await call({ action: 'send', token, body: body.trim().slice(0, MAX_CHAT_LEN) });
}

export function forgetToken(wallet: Address) {
  try {
    localStorage.removeItem(tokenKey(wallet));
  } catch {
    /* ignore */
  }
}
