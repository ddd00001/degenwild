import { type Address } from '@solana/kit';
import { type BattleView, type Randomness, opponentOf, payoutFor, refundDeadline, winnerOf } from '../chain';
import { BattleStatus } from '../generated';
import { Coin } from './Coin';
import { SIDE_NAME, fmtSol, short, type Names } from '../format';

export function BattleRow(props: {
  b: BattleView;
  names: Names;
  me?: Address;
  slot: bigint;
  rnd?: Randomness;
  busy: string | null;
  onJoin?: () => void;
  onCancel?: () => void;
  onSettle?: () => void;
  onRefund?: () => void;
  onReplay?: () => void;
}) {
  const { b, me, slot, rnd, busy } = props;
  const opp = opponentOf(b);
  const winner = winnerOf(b);
  const { pot, payout } = payoutFor(b.amount);
  const creatorSide = SIDE_NAME[b.creatorSide] ?? '?';
  const oppSide = SIDE_NAME[1 - b.creatorSide] ?? '?';
  const nameOf = (a: Address) => props.names.get(a);
  const label = (a: Address) => (a === me ? 'You' : (nameOf(a) ?? short(a)));
  const isBusy = (k: string) => busy === `${k}:${b.address}`;

  let meta = 'POT';
  let action: React.ReactNode = null;
  let rowClass = '';

  switch (b.status) {
    case BattleStatus.Open:
      if (b.creator === me) {
        meta = 'WAITING FOR PLAYER';
        action = (
          <button className="join-small ghost" disabled={busy !== null} onClick={props.onCancel}>
            {isBusy('cancel') ? 'Confirm…' : 'Cancel'}
          </button>
        );
      } else {
        action = (
          <button className="join-small" disabled={busy !== null} onClick={props.onJoin}>
            {isBusy('join') ? 'Confirm…' : `Join ${oppSide.toLowerCase()}`}
          </button>
        );
      }
      break;
    case BattleStatus.Joined:
    case BattleStatus.RandomnessPending: {
      const deadline = refundDeadline(b);
      if (rnd?.state === 'fulfilled') {
        const flipWinner = rnd.coin === b.creatorSide ? b.creator : opp;
        if (flipWinner === me) {
          // Only the winner is asked to sign: settling pays them, so they're the one with a reason to.
          meta = `LANDED ${SIDE_NAME[rnd.coin]} · YOU WON`;
          rowClass = 'ready';
          action = (
            <button className="join-small hot" disabled={busy !== null} onClick={props.onSettle}>
              {isBusy('settle') ? 'Confirm…' : `Claim ${fmtSol(payout)}`}
            </button>
          );
        } else {
          // The loser's stake is already in escrow; nothing for them to sign.
          meta = `LANDED ${SIDE_NAME[rnd.coin]} · WINNER CLAIMS`;
          rowClass = 'lost';
          action = <span className="result-tag">LOSS</span>;
        }
      } else if (slot >= deadline) {
        meta = 'FLIP TIMED OUT';
        action = (
          <button className="join-small ghost" disabled={busy !== null} onClick={props.onRefund}>
            {isBusy('refund') ? 'Confirm…' : 'Refund both'}
          </button>
        );
      } else {
        const left = Number(deadline - slot);
        meta = `FLIPPING… refund in ~${Math.ceil((left * 0.4) / 60)}m`;
        rowClass = 'flipping';
        action = <span className="coin-spin" aria-label="Waiting for randomness" />;
      }
      break;
    }
    case BattleStatus.Settled:
      meta = winner === me ? `YOU WON ${fmtSol(payout)}` : winner ? `${label(winner)} WON` : 'SETTLED';
      rowClass = winner === me ? 'won' : 'lost';
      action = <span className={`result-tag ${winner === me ? 'won' : ''}`}>{winner === me ? 'WIN' : 'LOSS'}</span>;
      break;
    case BattleStatus.Refunded:
      meta = 'REFUNDED';
      action = <span className="result-tag">REFUND</span>;
      break;
  }

  return (
    <div className={`battle-row ${rowClass}`}>
      <div className="player">
        <span className={`row-coin ${b.creatorSide === 1 ? 'tails' : 'heads'} ${winner === b.creator ? 'win' : ''}`}>{b.creatorSide <= 1 ? <Coin side={b.creatorSide as 0 | 1} /> : '?'}</span>
        <div>
          <b>{label(b.creator)}</b>
          <small>
            {creatorSide} · {fmtSol(b.amount)} SOL
          </small>
        </div>
      </div>
      <span className="versus">VS</span>
      <div className="player">
        <span className={`row-coin ${b.creatorSide === 1 ? 'heads' : 'tails'} ${opp && winner === opp ? 'win' : ''} ${opp ? '' : 'empty'}`}>{b.creatorSide <= 1 ? <Coin side={(1 - b.creatorSide) as 0 | 1} /> : '?'}</span>
        <div>
          <b>{opp ? label(opp) : 'Waiting for player'}</b>
          <small>{opp ? `${oppSide} · ${fmtSol(b.amount)} SOL` : `${oppSide} available`}</small>
        </div>
      </div>
      <div className="battle-meta">
        <strong>{fmtSol(pot)} SOL</strong>
        <small>{meta}</small>
      </div>
      <div className="battle-action">
        {action}
        {props.onReplay && (b.status === BattleStatus.Settled || rnd?.state === 'fulfilled') && (
          <button className="replay-btn" title="Replay the flip" aria-label="Replay the flip" onClick={props.onReplay}>
            ▶
          </button>
        )}
      </div>
    </div>
  );
}
