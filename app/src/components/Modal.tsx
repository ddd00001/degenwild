import { Embers } from './Embers';
import { useEffect, useRef } from 'react';
import { MAX_STAKE_LAMPORTS, MIN_STAKE_LAMPORTS } from '../config';
import { fmtSol } from '../format';

export function HowDialog({ game, onClose }: { game: 'coinflip' | 'jackpot'; onClose: () => void }) {
  if (game === 'jackpot')
    return (
      <Modal title="How jackpot works" onClose={onClose}>
        <p>
          <b>1.</b> Put 0.05–10 SOL into the round's pot. Your stake sits in an on-chain account owned by the DegenWild
          program, and your slice of the wheel is your share of the pot. You can add more before the spin.
        </p>
        <p>
          <b>2.</b> When a second player joins, a 2-minute countdown starts. More players can join until it hits zero (up to 30
          per round).
        </p>
        <p>
          <b>3.</b> The wheel spins on a provably fair random number. The winner is paid the pot automatically, minus a 3.5%
          platform fee. If no result arrives in time, everyone is refunded.
        </p>
        <p className="dialog-muted">
          Provably fair: nobody, including DegenWild, can choose where the wheel stops. The randomness is signed by independent
          nodes and checked on-chain before anyone is paid.
        </p>
      </Modal>
    );
  return (
    <Modal title="How coinflip works" onClose={onClose}>
      <p>
        <b>1.</b> Pick Heads or Tails and a stake ({fmtSol(MIN_STAKE_LAMPORTS)}–{fmtSol(MAX_STAKE_LAMPORTS, 0)} SOL). Your stake
        goes into an on-chain escrow account owned by the DegenWild program. You can cancel any time until someone joins.
      </p>
      <p>
        <b>2.</b> An opponent joins with the exact same stake on the other side. Joining requests a provably fair random
        result from an independent randomness network; the joiner pays its small fee (~0.0003 SOL).
      </p>
      <p>
        <b>3.</b> Seconds later the coin lands. The winner is paid the pot automatically, minus a 3.5% platform fee. If no result arrives within
        ~5 minutes, either player can refund both stakes.
      </p>
      <p className="dialog-muted">
        Provably fair: neither player nor DegenWild can choose the outcome. The randomness is signed by several independent
        nodes and checked on-chain before anyone is paid.
      </p>
    </Modal>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    // No close() in cleanup: React dev mode runs effects twice, and close() fires onClose,
    // which would unmount the dialog straight away. Unmounting removes it anyway.
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <Embers count={10} />
      <div className="dialog-head">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
