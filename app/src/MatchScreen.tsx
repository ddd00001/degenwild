import { useEffect, useRef, useState } from 'react';
import type { Address } from '@solana/kit';
import { type BattleView, type Randomness, opponentOf, payoutFor } from './chain';

type Phase = 'waiting' | 'countdown' | 'flip' | 'result';

const SIDE = ['HEADS', 'TAILS'] as const;
const FLIP_MS = 2600;
const SPINS = 6;

/**
 * Full-screen match pop-up for a battle the viewer is in:
 * MATCH FOUND → waits for the randomness result → 3 · 2 · 1 → coin flip landing on the real result → win / loss.
 */
export function MatchScreen(props: {
  battle: BattleView;
  rnd?: Randomness;
  me: Address;
  nameOf: (a: Address) => string;
  fmtSol: (l: bigint) => string;
  claiming: boolean;
  claimed: boolean;
  replay?: boolean;
  onClaim: () => void;
  onClose: () => void;
}) {
  const { battle: b, rnd, me } = props;
  const opp = opponentOf(b);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [count, setCount] = useState(3);
  const [rotation, setRotation] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const coin = rnd?.state === 'fulfilled' ? rnd.coin : null;

  // Randomness arrived: start the countdown (once).
  useEffect(() => {
    if (coin !== null && phase === 'waiting') {
      setPhase('countdown');
      setCount(3);
    }
  }, [coin, phase]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count === 0) {
      setPhase('flip');
      return;
    }
    const id = window.setTimeout(() => setCount((c) => c - 1), 900);
    return () => window.clearTimeout(id);
  }, [phase, count]);

  useEffect(() => {
    if (phase !== 'flip' || coin === null) return;
    // Next frame, so the transition runs from the starting angle.
    const raf = requestAnimationFrame(() => setRotation(360 * SPINS + (coin === 1 ? 180 : 0)));
    const id = window.setTimeout(() => setPhase('result'), FLIP_MS + 200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(id);
    };
  }, [phase, coin]);

  const creatorWins = coin !== null && coin === b.creatorSide;
  const winner = coin === null ? null : creatorWins ? b.creator : opp;
  const iWon = winner === me;
  const { pot, payout } = payoutFor(b.amount);
  const mySide = b.creator === me ? b.creatorSide : 1 - b.creatorSide;

  const player = (a: Address | null, side: number) => (
    <div className={`match-player ${phase === 'result' && a === winner ? 'winner' : ''} ${phase === 'result' && a !== winner ? 'loser' : ''}`}>
      <span className="match-avatar">{a ? props.nameOf(a)[0].toUpperCase() : '?'}</span>
      <b>{a === me ? 'You' : a ? props.nameOf(a) : '…'}</b>
      <small>{SIDE[side]}</small>
    </div>
  );

  return (
    <dialog ref={dialog} className="match-dialog" onClose={props.onClose} onCancel={(e) => phase !== 'result' && phase !== 'waiting' && e.preventDefault()}>
      <div className="match-kicker">{props.replay ? 'REPLAY' : phase === 'result' ? 'RESULT' : 'MATCH FOUND'}</div>
      <div className="match-pot">{props.fmtSol(pot)} SOL POT</div>

      <div className="match-versus">
        {player(b.creator, b.creatorSide)}
        <span className="match-vs">VS</span>
        {player(opp, 1 - b.creatorSide)}
      </div>

      <div className="match-stage">
        {phase === 'countdown' && count > 0 ? (
          <div key={count} className="match-count">{count}</div>
        ) : (
          <div className={`coin3d-wrap ${phase === 'waiting' ? 'idle' : ''}`}>
            <div
              className="coin3d"
              style={{
                transform: `rotateY(${rotation}deg)`,
                transition: phase === 'flip' ? `transform ${FLIP_MS}ms cubic-bezier(.15,.7,.2,1)` : 'none',
              }}
            >
              <div className="coin-face heads">H</div>
              <div className="coin-face tails">T</div>
            </div>
          </div>
        )}
      </div>

      <div className="match-status">
        {phase === 'waiting' && (rnd?.state === 'missing' ? 'Requesting a fair result…' : 'Waiting for the provably fair result…')}
        {phase === 'countdown' && 'Flipping in…'}
        {phase === 'flip' && `You called ${SIDE[mySide]}`}
        {phase === 'result' && coin !== null && (
          <>
            <div className="match-landed">LANDED {SIDE[coin]}</div>
            <div className={`match-outcome ${iWon ? 'win' : 'loss'}`}>{iWon ? `YOU WON ${props.fmtSol(payout)} SOL` : 'YOU LOST'}</div>
          </>
        )}
      </div>

      <div className="match-actions">
        {phase === 'result' && iWon && !props.claimed && (
          <button className="primary-btn" disabled={props.claiming} onClick={props.onClaim}>
            {props.claiming ? 'Confirm in wallet…' : `Claim ${props.fmtSol(payout)} SOL`}
          </button>
        )}
        {phase === 'result' && iWon && props.claimed && !props.replay && <div className="match-claimed">Paid to your wallet ✓</div>}
        {(phase === 'result' || phase === 'waiting') && (
          <button className="link-btn" onClick={props.onClose}>
            {phase === 'waiting' ? 'Hide — I’ll watch from the lobby' : iWon && !props.claimed && !props.replay ? 'Claim later' : 'Close'}
          </button>
        )}
      </div>
    </dialog>
  );
}
