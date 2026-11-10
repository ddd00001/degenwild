import { type Address } from '@solana/kit';
import { useEffect, useState } from 'react';
import { useConnect, useConnectedWallet, useDisconnect, useWallets, useWalletStatus } from '@solana/kit-plugin-wallet/react';
import { client } from '../client';
import { CLUSTER } from '../config';
import { describeError, isUsernameTaken, validateUsername } from '../chain';
import { short } from '../format';
import { Modal } from '../components/Modal';

/** Shown while a wallet request is open; Solana transactions expire after roughly a minute. */
export function WalletWaitPill({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, 60 - Math.floor((now - since) / 1000));
  return (
    <div className="wallet-wait" role="status">
      <span className="wallet-wait-dot" /> Approve in your wallet · {left > 0 ? `${left}s` : 'expiring…'}
    </div>
  );
}

export function WalletButton(props: { me?: Address; name?: string; onOpen: () => void; onAccount: () => void }) {
  const status = useWalletStatus(client);
  if (props.me) {
    return (
      <button className="wallet-btn" onClick={props.onAccount} title="Account">
        <span className="wallet-symbol">◈</span>
        {props.name ?? short(props.me)}
      </button>
    );
  }
  return (
    <button className="wallet-btn" onClick={props.onOpen}>
      <span className="wallet-symbol">◈</span>
      {status === 'connecting' || status === 'reconnecting' ? 'Connecting…' : 'Connect Wallet'}
    </button>
  );
}

export function ProfileDialog(props: {
  first: boolean;
  me: Address;
  current?: string;
  busy: string | null;
  onClose: () => void;
  onSave: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(props.current ?? '');
  const [taken, setTaken] = useState<boolean | null>(null);
  const { dispatch: disconnect } = useDisconnect(client);
  const trimmed = name.trim();
  const unchanged = props.current !== undefined && trimmed === props.current;
  const caseOnly = props.current !== undefined && !unchanged && trimmed.toLowerCase() === props.current.toLowerCase();
  const error = trimmed ? (validateUsername(trimmed) ?? (caseOnly ? "Changing only capital letters isn't supported." : null)) : null;
  const saving = props.busy === 'profile';

  // Live availability check, debounced.
  useEffect(() => {
    setTaken(null);
    if (!trimmed || error || unchanged) return;
    const id = window.setTimeout(() => {
      isUsernameTaken(client.rpc, trimmed).then(setTaken, () => setTaken(null));
    }, 350);
    return () => window.clearTimeout(id);
  }, [trimmed, error, unchanged]);

  const canSave = !!trimmed && !error && !unchanged && taken === false && !saving;
  const hint = !trimmed
    ? '3–16 characters: letters, numbers and _'
    : error ?? (unchanged ? 'This is your current name.' : taken === null ? 'Checking…' : taken ? 'Already taken.' : 'Available!');

  return (
    <Modal title={props.first ? 'Pick your name' : 'Your account'} onClose={props.onClose}>
      <p>
        {props.first
          ? 'Other players will see this instead of your wallet address.'
          : <>Wallet <code>{short(props.me)}</code></>}
      </p>
      <form
        className="username-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) props.onSave(trimmed);
        }}
      >
        <div className={`amount-input ${error || taken ? 'invalid' : ''}`}>
          <span className="sol-symbol">@</span>
          <input
            autoFocus
            maxLength={16}
            value={name}
            placeholder="DegenLord"
            onChange={(e) => setName(e.target.value.replace(/\s/g, ''))}
            aria-label="Username"
          />
        </div>
        <small className={`username-hint ${error || taken ? 'bad' : taken === false ? 'good' : ''}`}>{hint}</small>
        <button className="primary-btn" type="submit" disabled={!canSave}>
          {saving ? 'Confirm in wallet…' : props.current ? 'Change name' : 'Claim name'}
        </button>
      </form>
      <p className="dialog-muted">
        Stored on-chain. Costs ~0.0025 SOL rent, fully refunded if you delete it. Offensive or impersonating names can be
        removed by DegenWild.
      </p>
      <div className="dialog-actions">
        {props.first ? (
          <button className="link-btn" onClick={props.onClose}>Maybe later</button>
        ) : (
          <>
            {props.current && (
              <button className="link-btn" disabled={saving} onClick={props.onDelete}>Delete username</button>
            )}
            <button className="link-btn" onClick={() => { disconnect(); props.onClose(); }}>Disconnect wallet</button>
          </>
        )}
      </div>
    </Modal>
  );
}

export function WalletDialog({ onClose }: { onClose: () => void }) {
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatch: connect, isRunning, error } = useConnect(client);
  useEffect(() => {
    if (connected) onClose();
  }, [connected, onClose]);
  return (
    <Modal title="Connect wallet" onClose={onClose}>
      {wallets.length === 0 ? (
        <p>
          No Solana wallet found. Install <a href="https://phantom.com" target="_blank" rel="noreferrer">Phantom</a>,{' '}
          <a href="https://solflare.com" target="_blank" rel="noreferrer">Solflare</a> or{' '}
          <a href="https://backpack.app" target="_blank" rel="noreferrer">Backpack</a> and reload.
          {CLUSTER !== 'mainnet' && ` Make sure it is set to ${CLUSTER}.`}
        </p>
      ) : (
        <div className="wallet-list">
          {wallets.map((w) => (
            <button key={w.name} className="wallet-option" disabled={isRunning} onClick={() => connect(w)}>
              <img src={w.icon} alt="" width={26} height={26} />
              {w.name}
            </button>
          ))}
        </div>
      )}
      {error != null && <p className="dialog-error">{describeError(error)}</p>}
      <p className="dialog-muted">
        Your wallet asks you to approve every transaction. DegenWild never sees your keys.
      </p>
    </Modal>
  );
}
