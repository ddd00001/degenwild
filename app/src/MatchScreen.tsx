import { useEffect, useRef, useState } from 'react';
import type { Address } from '@solana/kit';
import { type BattleView, type Randomness, opponentOf, payoutFor } from './chain';
import { explorerTx } from './config';
import { Coin } from './components/Coin';
import { Embers } from './components/Embers';
import { Amount } from './components/Amount';

type Phase = 'open' | 'waiting' | 'countdown' | 'flip' | 'result';

const SIDE = ['HEADS', 'TAILS'] as const;
const FLIP_MS = 2600;
const SPINS = 6;

/**
 * Full-screen battle pop-up. Works for players and spectators:
 * (open: waiting for an opponent) → MATCH FOUND → waits for the randomness result → 3 · 2 · 1 → flip → result.
 */
export function MatchScreen(props: {
  battle: BattleView;
  rnd?: Randomness;
  me?: Address;
  nameOf: (a: Address) => string;
  fmtSol: (l: bigint) => string;
  claiming: boolean;
  claimed: boolean;
  replay?: boolean;
  /** Signature of the transaction that paid the winner, if known (from the event log). */
  payoutTx?: string;
  /** Double Down: open a new battle at this stake on the same side. */
  doubleDown?: { amount: bigint; busy: boolean; onClick: (amount: bigint, side: 0 | 1) => void };
  /** Open battle: lets a spectator join, or the creator cancel, from the pop-up. */
  open?: { joining: boolean; cancelling: boolean; onJoin?: () => void; onCancel?: () => void };
  onClaim: () => void;
  onClose: () => void;
}) {
  const { battle: b, rnd, me } = props;
  const opp = opponentOf(b);
  const [phase, setPhase] = useState<Phase>(opp ? 'waiting' : 'open');
  const [count, setCount] = useState(3);
  const [rotation, setRotation] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const coin = rnd?.state === 'fulfilled' ? rnd.coin : null;

  // Someone joined while we were watching an open battle.
  useEffect(() => {
    if (phase === 'open' && opp) setPhase('waiting');
  }, [phase, opp]);

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
  const iWon = !!me && winner === me;
  const playing = !!me && (b.creator === me || opp === me);
  const { pot, payout } = payoutFor(b.amount);
  const mySide = b.creator === me ? b.creatorSide : 1 - b.creatorSide;

  const player = (a: Address | null, side: number) => (
    <div className={`match-player ${phase === 'result' && a === winner ? 'winner' : ''} ${phase === 'result' && a !== winner ? 'loser' : ''}`}>
      <span className={`match-coin ${side === 1 ? 'tails' : 'heads'}`} aria-label={SIDE[side] ?? 'Unknown side'}>
        {side === 0 || side === 1 ? <Coin side={side as 0 | 1} /> : '?'}
      </span>
      <b>{a === me ? 'You' : a ? props.nameOf(a) : '…'}</b>
      <small>{SIDE[side]}</small>
    </div>
  );

  return (
    <dialog ref={dialog} className="match-dialog" onClose={props.onClose}>
      <Embers />
      <button className="match-close" onClick={props.onClose} aria-label="Close">
        ×
      </button>
      <div className="match-kicker">
        {props.replay ? 'REPLAY' : phase === 'open' ? 'WAITING FOR OPPONENT' : phase === 'result' ? 'RESULT' : playing ? 'MATCH FOUND' : 'LIVE'}
      </div>
      <div className="match-pot">
        <Amount lamports={pot} /> POT
      </div>

      <div className="match-versus">
        {player(b.creator, b.creatorSide)}
        <span className="match-vs">VS</span>
        {player(opp, 1 - b.creatorSide)}
      </div>

      <div className="match-stage">
        {phase === 'countdown' && count > 0 ? (
          <div key={count} className="match-count">{count}</div>
        ) : (
          <div className={`coin3d-wrap ${phase === 'waiting' || phase === 'open' ? 'idle' : ''}`}>
            <div
              className="coin3d"
              style={{
                transform: `rotateY(${rotation}deg)`,
                transition: phase === 'flip' ? `transform ${FLIP_MS}ms cubic-bezier(.15,.7,.2,1)` : 'none',
              }}
            >
              <div className="coin-face heads">
                <Coin side={0} detailed />
              </div>
              <div className="coin-face tails">
                <Coin side={1} detailed />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="match-status">
        {phase === 'open' &&
          (b.creator === me
            ? 'Your battle is live in the lobby — this flips the moment someone joins.'
            : `Join on ${SIDE[1 - b.creatorSide]} for ${props.fmtSol(b.amount)} SOL to start the flip.`)}
        {phase === 'waiting' && (rnd?.state === 'missing' ? 'Requesting a fair result…' : 'Waiting for the provably fair result…')}
        {phase === 'countdown' && 'Flipping in…'}
        {phase === 'flip' && (playing ? `You called ${SIDE[mySide]}` : 'Flipping…')}
        {phase === 'result' && coin !== null && (
          <>
            <div className="match-landed">LANDED {SIDE[coin]}</div>
            <div className={`match-outcome ${iWon || !playing ? 'win' : 'loss'}`}>
              {iWon ? `YOU WON ${props.fmtSol(payout)} SOL` : playing ? 'YOU LOST' : `${winner ? props.nameOf(winner) : '?'} WON ${props.fmtSol(payout)} SOL`}
            </div>
            {iWon && props.claimed && !props.replay && (
              <div className="match-claimed">✓ Already sent to your wallet — nothing to claim</div>
            )}
            {props.replay && winner && (
              <div className="match-receipt">
                <span>
                  <b>{winner === me ? 'You' : props.nameOf(winner)}</b> got paid <b>{props.fmtSol(payout)} SOL</b>
                </span>
                {props.payoutTx ? (
                  <a href={explorerTx(props.payoutTx)} target="_blank" rel="noreferrer" title={props.payoutTx}>
                    tx {props.payoutTx.slice(0, 6)}…{props.payoutTx.slice(-6)} ↗
                  </a>
                ) : (
                  <span className="match-receipt-muted">payout tx not in recent history</span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="match-actions">
        {phase === 'open' && props.open?.onJoin && (
          <button className="primary-btn" disabled={props.open.joining} onClick={props.open.onJoin}>
            {props.open.joining ? 'Confirm in wallet…' : `Join on ${SIDE[1 - b.creatorSide]} · ${props.fmtSol(b.amount)} SOL`}
          </button>
        )}
        {phase === 'open' && props.open?.onCancel && (
          <button className="link-btn" disabled={props.open.cancelling} onClick={props.open.onCancel}>
            {props.open.cancelling ? 'Confirm in wallet…' : 'Cancel battle & refund my stake'}
          </button>
        )}
        {phase === 'result' && iWon && !props.claimed && (
          <button className="primary-btn" disabled={props.claiming} onClick={props.onClaim}>
            {props.claiming ? 'Confirm in wallet…' : `Claim ${props.fmtSol(payout)} SOL`}
          </button>
        )}
        {phase === 'result' && iWon && !props.replay && props.doubleDown && (
          <button
            className="double-down-btn"
            disabled={props.doubleDown.busy}
            onClick={() => props.doubleDown!.onClick(props.doubleDown!.amount, mySide as 0 | 1)}
          >
            {props.doubleDown.busy ? 'Confirm in wallet…' : `🔥 Double Down · ${props.fmtSol(props.doubleDown.amount)} SOL on ${SIDE[mySide]}`}
          </button>
        )}
        {phase === 'result' && iWon && !props.replay && props.doubleDown && (
          <small className="match-optional">Optional — bet again at double the stake, or close with ×</small>
        )}
      </div>
    </dialog>
  );
}
