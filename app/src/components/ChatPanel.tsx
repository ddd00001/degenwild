import { type Address, type MessageSigner, type TransactionSigner } from '@solana/kit';
import { useEffect, useRef, useState } from 'react';
import { CHAT_ENABLED, MAX_CHAT_LEN, chatLogin, forgetToken, savedToken, sendChat, useChatMessages, useOnlineCount } from '../chat';
import { short, type Names } from '../format';
import { Avatar } from './Avatar';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function OnlinePill() {
  const n = useOnlineCount();
  if (!CHAT_ENABLED) return null;
  return (
    <span className="online-pill" title="People on DegenWild right now">
      <i /> {n > 0 ? n : '…'} online
    </span>
  );
}

export function ChatPanel(props: {
  me?: Address;
  signer: (TransactionSigner | MessageSigner) | null;
  names: Names;
  onConnect: () => void;
}) {
  const { me, signer, names } = props;
  const msgs = useChatMessages();
  const online = useOnlineCount();
  const [token, setToken] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => setToken(me ? savedToken(me) : null), [me]);

  // Fill the screen from wherever the panel starts down to the bottom of the window, then stay pinned while scrolling.
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (getComputedStyle(el).position !== 'sticky') return void (el.style.height = '');
        // Visible part of the chat's column: from max(its top, 16px) to min(its bottom, window bottom - 16px).
        const col = el.parentElement!.getBoundingClientRect();
        const top = Math.max(16, col.top);
        const bottom = Math.min(window.innerHeight - 16, col.bottom);
        el.style.height = `${Math.max(320, bottom - top)}px`;
      });
    };
    fit();
    window.addEventListener('scroll', fit, { passive: true });
    window.addEventListener('resize', fit);
    const ro = new ResizeObserver(fit); // lists loading in change the column height without a scroll
    ro.observe(el.parentElement!);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
    };
  }, []);

  // Keep the newest message in view unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const nameOf = (a: Address) => (a === me ? 'You' : (names.get(a) ?? short(a)));

  async function login() {
    if (!signer) return props.onConnect();
    setBusy(true);
    setErr(null);
    try {
      setToken(await chatLogin(signer));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const body = text.trim();
    if (!body || !token || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await sendChat(token, body);
      setText('');
      stick.current = true;
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Message not sent.';
      if (/expired|invalid token/i.test(m) && me) {
        forgetToken(me);
        setToken(null);
      }
      setErr(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="chat-panel" aria-label="Live chat" ref={panelRef}>
      <div className="chat-head">
        <div>
          <div className="eyebrow">DEGEN LOUNGE</div>
          <h2>Live chat</h2>
        </div>
        <span className="online-pill">
          <i /> {CHAT_ENABLED ? (online > 0 ? online : '…') : 0} online
        </span>
      </div>

      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!CHAT_ENABLED ? (
          <p className="chat-empty">Chat is warming up. Back in a moment.</p>
        ) : msgs.length === 0 ? (
          <p className="chat-empty">No messages yet. Say gm.</p>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={`chat-msg ${m.wallet === me ? 'mine' : ''}`}>
              <Avatar address={m.wallet} size={28} />
              <div>
                <div className="chat-meta">
                  <b>{nameOf(m.wallet)}</b>
                  <time>{timeOf(m.created_at)}</time>
                </div>
                <p>{m.body}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {err && <p className="chat-err">{err}</p>}
      {!me ? (
        <button className="chat-cta" onClick={props.onConnect}>
          Connect a wallet to chat
        </button>
      ) : !token ? (
        <button className="chat-cta" disabled={busy || !CHAT_ENABLED} onClick={() => void login()}>
          {busy ? 'Check your wallet…' : 'Sign in to chat (free, no transaction)'}
        </button>
      ) : (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={text}
            maxLength={MAX_CHAT_LEN}
            placeholder="Talk your trash…"
            onChange={(e) => setText(e.target.value)}
            aria-label="Chat message"
          />
          <button disabled={busy || !text.trim()} aria-label="Send">
            ➤
          </button>
        </form>
      )}
    </aside>
  );
}
