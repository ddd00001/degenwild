import { type Address } from '@solana/kit';
import { useEffect, useRef, useState } from 'react';
import { client } from '../client';
import { explorerTx } from '../config';
import { fmtSol, short, timeAgo } from '../format';
import type { JackpotResult } from '../history';
import { type ReplayEntry, fetchJackpotEntries } from '../jackpotReplay';
import { useSolPrice } from '../price';
import { Avatar } from './Avatar';
import { Embers } from './Embers';
import { C, R_IN, R_OUT, SEGMENTS, arc, pct, polar, ring, usd } from './JackpotPage';

const SPIN_MS = 6500;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/** Replays a finished jackpot: rebuilds the wheel from the round's entries and lands on the drawn ticket. */
export function JackpotReplay(props: { result: JackpotResult; me?: Address; nameOf: (a: Address) => string; onClose: () => void }) {
  const r = props.result;
  const dialog = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<ReplayEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rot, setRot] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'countdown' | 'spinning' | 'result'>('loading');
  const [count, setCount] = useState(3);
  const solUsd = useSolPrice()?.usd;

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    let alive = true;
    fetchJackpotEntries(client.rpc, r.round)
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setError('Could not load this round from the chain. Try again in a moment.'));
    return () => {
      alive = false;
    };
  }, [r.round]);

  // Spin: ticket's spot on the wheel ends under the pointer at the top.
  // Short 3-2-1 before the wheel goes, like the coinflip pop-up.
  useEffect(() => {
    if (!entries || entries.length === 0) return;
    setPhase('countdown');
    setCount(3);
    const ids = [1, 2].map((n) => window.setTimeout(() => setCount(3 - n), n * 800));
    const go = window.setTimeout(() => setPhase('spinning'), 2400);
    return () => [...ids, go].forEach((id) => window.clearTimeout(id));
  }, [entries]);

  useEffect(() => {
    if (phase !== 'spinning') return;
    const theta = (Number((r.ticket * 1_000_000n) / r.total) / 1_000_000) * 360;
    const target = 360 * 5 + ((360 - theta) % 360);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / SPIN_MS);
      setRot(target * easeOut(k));
      if (k < 1) raf = requestAnimationFrame(step);
      else setPhase('result');
    };
    setRot(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'spinning']);

  let acc = 0n;
  const segs = (entries ?? []).map((e, i) => {
    const start = (Number((acc * 1_000_000n) / r.total) / 1_000_000) * 360;
    acc += e.amount;
    const end = (Number((acc * 1_000_000n) / r.total) / 1_000_000) * 360;
    return { ...e, start, end, color: SEGMENTS[i % SEGMENTS.length], chance: pct(e.amount, r.total) };
  });
  const win = segs.find((s) => s.player === r.winner);
  const done = phase === 'result';
  const label = (a: Address) => (a === props.me ? 'You' : props.nameOf(a));

  return (
    <dialog ref={dialog} className="match-dialog jp-replay" onClose={props.onClose}>
      <Embers />
      <button className="match-close" onClick={props.onClose} aria-label="Close">
        ×
      </button>
      <div className="match-kicker">
        JACKPOT #{r.roundId.toString()} · REPLAY · {timeAgo(r.blockTime)}
      </div>

      <div className="jp-replay-wheel">
        <svg viewBox="0 0 400 400" className="jp-wheel" role="img" aria-label="Jackpot wheel replay">
          <circle cx={C} cy={C} r={R_OUT + 12} className="jp-rim" />
          {Array.from({ length: 60 }, (_, i) => {
            const [x1, y1] = polar(R_OUT + 5, i * 6);
            const [x2, y2] = polar(R_OUT + (i % 5 === 0 ? 14 : 10), i * 6);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="jp-tick" />;
          })}
          <g transform={`rotate(${rot} ${C} ${C})`}>
            {segs.length === 0 ? (
              <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} className="jp-empty" strokeWidth={R_OUT - R_IN} />
            ) : (
              segs.map((s) => (
                <path key={s.player} d={s.end - s.start >= 359.9 ? ring() : arc(s.start, s.end)} fill={s.color} className={`jp-seg ${done && s.player !== r.winner ? 'dim' : ''}`} />
              ))
            )}
            {segs.map((s) => {
              const span = s.end - s.start;
              if (span < 9) return null;
              const size = Math.max(22, Math.min(46, span * 0.9));
              const [x, y] = polar((R_OUT + R_IN) / 2, (s.start + s.end) / 2);
              return (
                <g key={`a-${s.player}`} transform={`rotate(${-rot} ${x} ${y})`}>
                  <Avatar address={s.player} size={size} x={x - size / 2} y={y - size / 2} ring={s.color} />
                </g>
              );
            })}
          </g>
          <circle cx={C} cy={C} r={R_IN - 4} fill="#0f0a0b" className="jp-hub" />
          {phase !== 'countdown' && (
            <>
          <text x={C} y={C - 26} className="jp-hub-label">
            {done ? 'WON' : 'POT'}
          </text>
          <text x={C} y={C} className="jp-hub-pot">
            {fmtSol(r.total)}
          </text>
          <text x={C} y={C + 28} className="jp-hub-sol">
            SOL
            {solUsd ? <tspan className="jp-hub-usd"> ≈ {usd(r.total, solUsd)}</tspan> : null}
          </text>
            </>
          )}
          <path d={`M${C - 15} 2 L${C + 15} 2 L${C} 34 Z`} className="jp-pointer" />
        </svg>
        {phase === 'countdown' && (
          <div className="jp-replay-count" key={count}>
            <div className="match-count-wrap">
              <svg className="match-count-ring" viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r="52" className="track" />
                <circle cx="60" cy="60" r="52" className="bar" />
              </svg>
              <div className="match-count">{count}</div>
            </div>
          </div>
        )}
        {phase === 'loading' && !error && <div className="jp-replay-status">Loading the round from the chain…</div>}
        {error && <div className="jp-replay-status">{error}</div>}
      </div>

      <div className={`jp-replay-result ${done ? 'show' : ''}`}>
        <Avatar address={r.winner} size={48} ring={win?.color} />
        <div>
          <b>{label(r.winner)} won</b>
          <span>
            the {fmtSol(r.total)} SOL pot{solUsd ? ` (≈ ${usd(r.total, solUsd)})` : ''} with a {win ? win.chance.toFixed(2) : '?'}% chance
          </span>
        </div>
      </div>

      <ul className="jp-replay-players">
        {[...segs]
          .sort((a, b) => (b.amount > a.amount ? 1 : -1))
          .map((s) => (
            <li key={s.player} className={done && s.player === r.winner ? 'won' : ''}>
              <i style={{ background: s.color }} />
              <span className="jp-name">{label(s.player)}</span>
              <span>{fmtSol(s.amount)} SOL</span>
              <b>{s.chance.toFixed(2)}%</b>
            </li>
          ))}
      </ul>

      <dl className="jp-replay-proof show">
        <dt>Payout tx</dt>
        <dd>
          <a href={explorerTx(r.signature)} target="_blank" rel="noreferrer" title={r.signature}>
            {r.signature.slice(0, 8)}…{r.signature.slice(-8)} ↗
          </a>
        </dd>
        <dt>Winning ticket</dt>
        <dd>
          {r.ticket.toString()} of {r.total.toString()} lamports
        </dd>
        <dt>Round account</dt>
        <dd>{short(r.round)}</dd>
      </dl>

    </dialog>
  );
}
