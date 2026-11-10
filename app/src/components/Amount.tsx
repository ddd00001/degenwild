import { useEffect, useState } from 'react';
import { CLUSTER } from '../config';
import { fmtSol } from '../format';
import { fmtUsd, useSolPrice } from '../price';

/**
 * A token amount with a USD tooltip on hover, keyboard focus or tap.
 * `token="WILD"` is ready for the $WILD launch; it has no price source until the token has a market.
 */
export function Amount({ lamports, token = 'SOL', max = 4 }: { lamports: bigint; token?: 'SOL' | 'WILD'; max?: number }) {
  const price = useSolPrice();
  const [open, setOpen] = useState(false);
  const amount = Number(lamports) / 1e9;
  const usd = token === 'SOL' && price ? amount * price.usd : null;

  // Tap anywhere else to close on touch screens.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const id = window.setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [open]);

  return (
    <span
      className={`amount ${open ? 'open' : ''}`}
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
      aria-label={`${fmtSol(lamports, max)} ${token}${usd !== null ? `, about ${fmtUsd(usd)}` : ''}`}
    >
      {fmtSol(lamports, max)} {token}
      <span className="amount-tip" role="tooltip">
        <b>
          {fmtSol(lamports, max)} {token} {usd !== null ? `≈ ${fmtUsd(usd)}` : ''}
        </b>
        {token === 'WILD' ? (
          <span>$WILD price available after launch.</span>
        ) : price ? (
          <span>
            1 SOL = {fmtUsd(price.usd)} · {price.source} · <Ago at={price.at} />
          </span>
        ) : (
          <span>Loading SOL price…</span>
        )}
        {token === 'SOL' && CLUSTER !== 'mainnet' && <em>{CLUSTER} SOL is test money: USD uses the real SOL price.</em>}
      </span>
    </span>
  );
}

function Ago({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((now - at) / 1000));
  return <>{s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`}</>;
}
