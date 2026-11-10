import { type Address, type Instruction } from '@solana/kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { client, clientV0 } from './client';
import { CLUSTER, MAX_STAKE_LAMPORTS, MIN_STAKE_LAMPORTS, PLATFORM_ADMIN, POLL_MS, explorerTx } from './config';
import { type BattleView, type Randomness, buildCancel, buildChangeUsername, buildCreate, buildCreateProfile, buildDeleteProfile, buildInitPlatform, buildJoin, buildRefund, buildSettle, describeError, isExpiredError, fetchAllBattles, fetchAllUsernames, fetchRandomness, fetchTreasury, opponentOf, payoutFor, winnerOf } from './chain';
import { BattleStatus } from './generated';
import { MatchScreen } from './MatchScreen';
import { Coin } from './components/Coin';
import { type GameResult, GameHistory, resultToBattle } from './history';
import { SIDE_NAME, type Side, fmtSol, parseSol, short, timeAgo, type Names } from './format';
import { BattleRow } from './components/BattleRow';
import { WalletWaitPill, WalletButton, ProfileDialog, WalletDialog } from './components/wallet';
import { HowDialog } from './components/Modal';

const skipKey = (a: string) => `dw-skip-username:${a}`;
function skippedUsername(a: string): boolean {
  try {
    return sessionStorage.getItem(skipKey(a)) === '1';
  } catch {
    return false;
  }
}
function skipUsername(a: string) {
  try {
    sessionStorage.setItem(skipKey(a), '1');
  } catch {
    /* storage unavailable */
  }
}

// ------------------------------------------------------------ toast

type ToastMsg = { text: string; link?: string };
function useToast() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string, link?: string) => {
    setMsg({ text, link });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), link ? 7000 : 4000);
  }, []);
  return { msg, show };
}

// ------------------------------------------------------------ app

export default function App() {
  const [view, setView] = useState<'coinflip'>('coinflip');
  const [side, setSide] = useState<Side>(0);
  const [stakeInput, setStakeInput] = useState('0.1');
  const [battles, setBattles] = useState<BattleView[]>([]);
  const [randomness, setRandomness] = useState<Record<string, Randomness>>({});
  // Finished games, read from the program's BattleSettled / BattleRefunded events (newest first).
  const [results, setResults] = useState<GameResult[]>([]);
  const history = useRef(new GameHistory(client.rpc));
  const pollTick = useRef(0);
  const [slot, setSlot] = useState<bigint>(0n);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [names, setNames] = useState<Names>(new Map());
  const [treasury, setTreasury] = useState<Address | null | undefined>(undefined);
  const [namesLoaded, setNamesLoaded] = useState(false);
  const [profileOpen, setProfileOpen] = useState<'first' | 'edit' | null>(null);
  const [match, setMatch] = useState<BattleView | null>(null);
  const [matchRnd, setMatchRnd] = useState<Randomness | undefined>(undefined);
  const [matchClaimed, setMatchClaimed] = useState(false);
  const [matchReplay, setMatchReplay] = useState(false);
  const seenMatches = useRef<Set<string>>(new Set());
  const toast = useToast();

  const connected = useConnectedWallet(client);
  const me = connected?.account.address as Address | undefined;
  const signer = connected?.signer ?? null;

  // -------------------------------------------------------- polling chain state
  const refresh = useCallback(async () => {
    try {
      // Names and platform config rarely change: refresh them every 6th poll (~30s) to stay under RPC limits.
      const slow = pollTick.current++ % 6 === 0;
      const [all, s, usernames, tre] = await Promise.all([
        fetchAllBattles(client.rpc),
        client.rpc.getSlot({ commitment: 'confirmed' }).send(),
        slow ? fetchAllUsernames(client.rpc) : Promise.resolve(null),
        slow ? fetchTreasury(client.rpc) : Promise.resolve(undefined),
      ]);
      if (tre !== undefined) setTreasury(tre);
      if (usernames) {
        setNames(usernames);
        setNamesLoaded(true);
      }
      setSlot(s);
      setLoadError(null);
      const pending = all.filter((b) => b.status === BattleStatus.RandomnessPending);
      const entries = await Promise.all(
        pending.map(async (b) => [b.address, await fetchRandomness(client.rpc, b.randomnessAccount)] as const),
      );
      const rnd = Object.fromEntries(entries);

      // Settled/refunded battles close their accounts; their outcome lives on in the event log.
      try {
        const fresh = await history.current.poll();
        if (fresh.length)
          setResults((r) => [...fresh, ...r.filter((x) => !fresh.some((f) => f.signature === x.signature))].slice(0, 60));
      } catch {
        /* history is best-effort */
      }

      setBattles(all);
      setRandomness(rnd);
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!me) return setBalance(null);
    try {
      const { value } = await client.rpc.getBalance(me, { commitment: 'confirmed' }).send();
      setBalance(value);
    } catch {
      /* keep the last value */
    }
  }, [me]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    void refreshBalance();
    const id = window.setInterval(() => void refreshBalance(), POLL_MS * 2);
    return () => window.clearInterval(id);
  }, [refreshBalance]);

  // -------------------------------------------------------- sending
  const send = useCallback(
    async (label: string, build: () => Promise<Instruction> | Instruction, success: string): Promise<boolean> => {
      if (!connected) {
        setWalletOpen(true);
        return false;
      }
      if (!connected.signer) {
        toast.show('This wallet account cannot sign transactions on this network.');
        return false;
      }
      setBusy(label);
      const sender = connected.supportedTransactionVersions.has(1) ? client : clientV0;
      try {
        for (let attempt = 1; ; attempt++) {
          setBusySince(Date.now());
          try {
            const ix = await build();
            const result = await sender.sendTransaction([ix]);
            toast.show(success, explorerTx(result.context.signature));
            await Promise.all([refresh(), refreshBalance()]);
            return true;
          } catch (e) {
            // An expired transaction can never land, so one fresh attempt can't double-charge.
            if (attempt === 1 && isExpiredError(e)) {
              toast.show('That request expired before it was approved — sending a fresh one to your wallet.');
              continue;
            }
            throw e;
          }
        }
      } catch (e) {
        console.error(e);
        toast.show(describeError(e));
        return false;
      } finally {
        setBusy(null);
        setBusySince(null);
      }
    },
    [connected, refresh, refreshBalance, toast],
  );

  // First connect: ask for a username once names have loaded, unless they chose "later" this session.
  const myName = me ? names.get(me) : undefined;
  useEffect(() => {
    if (me && namesLoaded && !myName && !skippedUsername(me)) setProfileOpen((p) => p ?? 'first');
    if (!me) setProfileOpen(null);
  }, [me, namesLoaded, myName]);

  // Match pop-up: open when a battle I'm in has just been joined. Skip ones that were joined
  // long before this page loaded (~60s), so reloading doesn't replay old matches.
  useEffect(() => {
    if (!me || match) return;
    const fresh = battles.find(
      (b) =>
        b.status === BattleStatus.RandomnessPending &&
        (b.creator === me || opponentOf(b) === me) &&
        !seenMatches.current.has(b.address) &&
        slot > 0n &&
        slot - b.joinedSlot < 150n,
    );
    if (fresh) {
      seenMatches.current.add(fresh.address);
      setMatch(fresh);
      setMatchRnd(undefined);
      setMatchClaimed(false);
      setMatchReplay(false);
    }
  }, [battles, me, match, slot]);
  useEffect(() => {
    if (!match) return;
    if (randomness[match.address]) return setMatchRnd(randomness[match.address]);
    // Settled before we saw the coin land (e.g. by the auto-settle bot): take the result from its event.
    const r = results.find((x) => x.battle === match.address);
    if (r?.kind === 'settled') {
      setMatchRnd({ state: 'fulfilled', coin: r.coin });
      setMatchClaimed(true);
    }
  }, [match, randomness, results]);

  // The bot can settle a battle between two polls, so we may never see it "pending".
  // A fresh result for one of my battles (last ~90s) opens the pop-up too.
  useEffect(() => {
    if (!me || match) return;
    const now = Date.now() / 1000;
    const r = results.find(
      (x) =>
        x.kind === 'settled' &&
        (x.creator === me || x.opponent === me) &&
        !seenMatches.current.has(x.battle) &&
        x.blockTime !== null &&
        now - x.blockTime < 90,
    );
    if (r && r.kind === 'settled') {
      seenMatches.current.add(r.battle);
      setMatch(resultToBattle(r));
      setMatchRnd({ state: 'fulfilled', coin: r.coin });
      setMatchClaimed(true);
      setMatchReplay(false);
    }
  }, [results, me, match]);

  /** Re-runs the match pop-up for a battle whose coin has already landed. */
  const replay = (b: BattleView) => {
    const r = randomness[b.address];
    const w = winnerOf(b);
    const coin = r?.state === 'fulfilled' ? r.coin : w ? ((w === b.creator ? b.creatorSide : 1 - b.creatorSide) as 0 | 1) : null;
    if (coin === null) return;
    seenMatches.current.add(b.address);
    setMatch(b);
    setMatchRnd({ state: 'fulfilled', coin });
    setMatchClaimed(b.status === BattleStatus.Settled);
    setMatchReplay(true);
  };

  const stake = parseSol(stakeInput);
  const stakeError =
    stake === null
      ? 'Enter a SOL amount.'
      : stake < MIN_STAKE_LAMPORTS
        ? `Minimum stake is ${fmtSol(MIN_STAKE_LAMPORTS)} SOL.`
        : stake > MAX_STAKE_LAMPORTS
          ? `Maximum stake is ${fmtSol(MAX_STAKE_LAMPORTS)} SOL.`
          : null;

  const onCreate = () => {
    if (stakeError || stake === null) return toast.show(stakeError ?? 'Invalid stake.');
    if (!signer) return setWalletOpen(true);
    void send(
      'create',
      async () => (await buildCreate(signer, stake, side)).ix,
      `Coinflip created: ${fmtSol(stake)} SOL on ${SIDE_NAME[side]}.`,
    );
  };

  // -------------------------------------------------------- derived lists
  const open = useMemo(() => battles.filter((b) => b.status === BattleStatus.Open), [battles]);
  const mine = useMemo(
    () =>
      me
        ? battles
            .filter((b) => b.creator === me || opponentOf(b) === me)
            .filter((b) => b.status !== BattleStatus.Open)
            .concat(
              results
                .filter((r) => r.creator === me || r.opponent === me)
                .filter((r) => !battles.some((b) => b.address === r.battle))
                .map(resultToBattle),
            )
            .slice(0, 15)
        : [],
    [battles, results, me],
  );
  const myOpen = open.filter((b) => b.creator === me);
  const isDone = (b: BattleView) => b.status === BattleStatus.Settled || b.status === BattleStatus.Refunded;
  const myActive = [...myOpen, ...mine.filter((b) => !isDone(b))];
  const myHistory = mine.filter(isDone);
  const othersOpen = open.filter((b) => b.creator !== me);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setView('coinflip')} aria-label="DEGEN WILD home">
          <img className="brand-logo" src="/degenwild-logo-t.png" alt="DEGEN WILD" />
        </a>
        <div className="nav-label">PLAY</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={`nav-link ${view === 'coinflip' ? 'active' : ''}`} onClick={() => setView('coinflip')}>
            <span className="nav-icon">◉</span>Coinflip
          </button>
          <button className="nav-link" onClick={() => setHowOpen(true)}>
            <span className="nav-icon">?</span>How it works
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <i className={loadError ? 'down' : ''}></i>
            <span>{loadError ? 'RPC UNREACHABLE' : `${CLUSTER.toUpperCase()} · SLOT ${slot.toString()}`}</span>
          </div>
          <div className="sidebar-tag">
            PLAY <b>·</b> FLIP <b>·</b> WIN
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand">
            <img className="brand-logo small" src="/degenwild-logo-t.png" alt="DEGEN WILD" />
            <button className="mobile-help" onClick={() => setHowOpen(true)} aria-label="How it works">
              ?
            </button>
          </div>
          <div className="page-kicker">
            PVP ARENA <span>/</span> COINFLIP
          </div>
          <div className="top-actions">
            <span className={`network-label ${CLUSTER}`}>
              <i></i> {CLUSTER.toUpperCase()}
            </span>
            {me && balance !== null && <span className="balance">◎ {fmtSol(balance, 3)}</span>}
            <WalletButton me={me} name={myName} onOpen={() => setWalletOpen(true)} onAccount={() => setProfileOpen('edit')} />
          </div>
        </header>

        {view === 'coinflip' ? (
          <section className="view active">
            <section className="hero slim">
              <h1>
                CALL YOUR <em>FLIP.</em>
              </h1>
              <p>Pick a side. Match a player. Winner takes the pot.</p>
              <div className="trust-badges">
                <span>
                  <b>⛓ 100% on-chain</b> — every stake, flip and payout is a Solana transaction
                </span>
                <span>
                  <b>✓ Provably fair</b> — nobody can pick the result
                </span>
                <span>
                  <b>⚡ Auto payouts</b> — winnings sent in seconds
                </span>
              </div>
            </section>

            {loadError && (
              <div className="banner">
                <b>Can't load battles:</b> {loadError}
              </div>
            )}

            {treasury === null && !loadError && (
              <div className="banner">
                {me === PLATFORM_ADMIN && signer ? (
                  <>
                    <b>Admin:</b> the platform isn't set up on {CLUSTER} yet, so battles can't be settled.{' '}
                    <button
                      className="join-small hot inline"
                      disabled={busy !== null}
                      onClick={() =>
                        void send('init', () => buildInitPlatform(signer), 'Platform initialized — fees go to your wallet.')
                      }
                    >
                      {busy === 'init' ? 'Confirm…' : 'Initialize platform'}
                    </button>
                  </>
                ) : (
                  <>
                    <b>Heads up:</b> DEGEN WILD isn't fully set up on {CLUSTER} yet. Battles can be created and joined, but
                    not settled until the admin finishes setup.
                  </>
                )}
              </div>
            )}

            <section className="create-panel panel">
              <div className="section-top">
                <div>
                  <div className="eyebrow">START A MATCH</div>
                  <h2>Create coinflip</h2>
                </div>
              </div>
              <div className="create-controls">
                <div className="choice-group">
                  <label>Choose your side</label>
                  <div className="side-choices" role="group" aria-label="Choose coin side">
                    {([0, 1] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`side-choice ${side === s ? 'selected' : ''}`}
                        onClick={() => setSide(s)}
                      >
                        <span className="coin-mini" aria-hidden="true"><Coin side={s} /></span>
                        {s === 0 ? 'Heads' : 'Tails'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="amount-group">
                  <label htmlFor="bet-amount">Your stake</label>
                  <div className={`amount-input ${stakeError ? 'invalid' : ''}`}>
                    <span className="sol-symbol">◎</span>
                    <input
                      id="bet-amount"
                      inputMode="decimal"
                      value={stakeInput}
                      onChange={(e) => setStakeInput(e.target.value)}
                    />
                    <span className="sol-unit">SOL</span>
                  </div>
                  <div className="quick-amounts">
                    {['0.05', '0.1', '0.5', '1', '5'].map((a) => (
                      <button key={a} type="button" onClick={() => setStakeInput(a)}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="primary-btn create-btn" onClick={onCreate} disabled={busy !== null || !!stakeError}>
                  {busy === 'create' ? 'Confirm in wallet…' : connected ? 'Create coinflip' : 'Connect to create'}{' '}
                  <span>↗</span>
                </button>
              </div>
              <div className="panel-foot">
                <span className="info-dot">i</span>
                {stakeError ??
                  (stake !== null &&
                    `Win ${fmtSol(payoutFor(stake).payout)} SOL · 3.5% fee · stakes ${fmtSol(MIN_STAKE_LAMPORTS)}–${fmtSol(MAX_STAKE_LAMPORTS, 0)} SOL`)}
              </div>
            </section>

            {me && myActive.length > 0 && (
              <section className="lobby-section">
                <div className="lobby-heading">
                  <div>
                    <div className="eyebrow">YOUR MATCHES</div>
                    <h2>
                      Active <span className="count-pill">{String(myActive.length).padStart(2, '0')}</span>
                    </h2>
                  </div>
                </div>
                <div className="battle-list">
                  {myActive.map((b) => (
                    <BattleRow
                      names={names}
                      key={b.address}
                      b={b}
                      me={me}
                      slot={slot}
                      rnd={randomness[b.address]}
                      busy={busy}
                      onReplay={() => replay(b)}
                      onCancel={() =>
                        void send(`cancel:${b.address}`, () => buildCancel(signer!, b), 'Battle cancelled — stake refunded.')
                      }
                      onSettle={() =>
                        void send(`settle:${b.address}`, () => buildSettle(client.rpc, b), `You won ${fmtSol(payoutFor(b.amount).payout)} SOL — paid to your wallet.`)
                      }
                      onRefund={() =>
                        void send(`refund:${b.address}`, () => buildRefund(b), `Refunded — ${fmtSol(b.amount)} SOL back to each player.`)
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {me && myHistory.length > 0 && (
              <details className="lobby-section history">
                <summary className="lobby-heading">
                  <div>
                    <div className="eyebrow">YOUR MATCHES</div>
                    <h2>
                      History <span className="count-pill">{String(myHistory.length).padStart(2, '0')}</span>
                      <span className="history-toggle" aria-hidden="true">▾</span>
                    </h2>
                  </div>
                </summary>
                <div className="battle-list">
                  {myHistory.map((b) => (
                    <BattleRow
                      names={names}
                      key={b.address}
                      b={b}
                      me={me}
                      slot={slot}
                      rnd={randomness[b.address]}
                      busy={busy}
                      onReplay={() => replay(b)}
                      onCancel={() =>
                        void send(`cancel:${b.address}`, () => buildCancel(signer!, b), 'Battle cancelled — stake refunded.')
                      }
                      onSettle={() =>
                        void send(`settle:${b.address}`, () => buildSettle(client.rpc, b), `You won ${fmtSol(payoutFor(b.amount).payout)} SOL — paid to your wallet.`)
                      }
                      onRefund={() =>
                        void send(`refund:${b.address}`, () => buildRefund(b), `Refunded — ${fmtSol(b.amount)} SOL back to each player.`)
                      }
                    />
                  ))}
                </div>
              </details>
            )}

            <section className="lobby-section">
              <div className="lobby-heading">
                <div>
                  <div className="eyebrow">FIND YOUR OPPONENT</div>
                  <h2>
                    Open battles <span className="count-pill">{String(othersOpen.length).padStart(2, '0')}</span>
                  </h2>
                </div>
                <button
                  className="refresh-btn"
                  onClick={() => {
                    void refresh();
                    toast.show('Lobby refreshed.');
                  }}
                >
                  ↻ <span>Refresh</span>
                </button>
              </div>
              <div className="battle-list">
                {othersOpen.length === 0 ? (
                  <div className="empty-state">No open battles right now. Create one and start the lobby.</div>
                ) : (
                  othersOpen.map((b) => (
                    <BattleRow
                      names={names}
                      key={b.address}
                      b={b}
                      me={me}
                      slot={slot}
                      busy={busy}
                      onJoin={() => {
                        if (!signer) return setWalletOpen(true);
                        void send(
                          `join:${b.address}`,
                          () => buildJoin(client.rpc, signer, b),
                          `Joined for ${fmtSol(b.amount)} SOL on ${SIDE_NAME[1 - b.creatorSide]}. Flipping…`,
                        );
                      }}
                    />
                  ))
                )}
              </div>
            </section>

            <section className="lobby-section">
              <div className="lobby-heading">
                <div>
                  <div className="eyebrow">LIVE FEED</div>
                  <h2>Recent games</h2>
                </div>
              </div>
              <div className="recent-list">
                {results.filter((r) => r.kind === 'settled').length === 0 ? (
                  <div className="empty-state">No finished games yet.</div>
                ) : (
                  results
                    .filter((r): r is Extract<GameResult, { kind: 'settled' }> => r.kind === 'settled')
                    .slice(0, 10)
                    .map((r) => {
                      const loser = r.winner === r.creator ? r.opponent : r.creator;
                      const nm = (a: Address) => (a === me ? 'You' : (names.get(a) ?? short(a)));
                      return (
                        <div key={r.signature} className={`recent-row ${r.winner === me ? 'mine-win' : ''}`}>
                          <span className="recent-coin" aria-label={r.coin ? 'Tails' : 'Heads'}><Coin side={r.coin} /></span>
                          <span className="recent-text">
                            <b>{nm(r.winner)}</b> beat {nm(loser)} · won <b>{fmtSol(r.payout)} SOL</b>
                          </span>
                          <span className="recent-time">{timeAgo(r.blockTime)}</span>
                          <button className="replay-btn" title="Replay the flip" aria-label="Replay the flip" onClick={() => replay(resultToBattle(r))}>
                            ▶
                          </button>
                        </div>
                      );
                    })
                )}
              </div>
            </section>
          </section>
        ) : null}

        <footer>
          DEGEN WILD <span>·</span> EVERYTHING ON-CHAIN <span>·</span> {CLUSTER.toUpperCase()} <span>·</span>{' '}
          {CLUSTER === 'mainnet' ? 'PLAY RESPONSIBLY' : 'TEST NETWORK — NO REAL FUNDS'}
        </footer>
      </main>

      {busySince !== null && <WalletWaitPill since={busySince} />}
      <div className={`toast ${toast.msg ? 'show' : ''}`} role="status" aria-live="polite">
        {toast.msg?.text}
        {toast.msg?.link && (
          <>
            {' '}
            <a href={toast.msg.link} target="_blank" rel="noreferrer">
              View tx ↗
            </a>
          </>
        )}
      </div>

      {walletOpen && <WalletDialog onClose={() => setWalletOpen(false)} />}
      {match && me && (
        <MatchScreen
          battle={match}
          rnd={matchRnd}
          me={me}
          nameOf={(a) => names.get(a) ?? short(a)}
          fmtSol={fmtSol}
          claiming={busy === `settle:${match.address}`}
          claimed={matchClaimed}
          replay={matchReplay}
          payoutTx={results.find((r) => r.kind === 'settled' && r.battle === match.address)?.signature}
          doubleDown={
            signer
              ? {
                  amount: match.amount * 2n > MAX_STAKE_LAMPORTS ? MAX_STAKE_LAMPORTS : match.amount * 2n,
                  busy: busy === 'double',
                  onClick: async (amount, s) => {
                    const ok = await send(
                      'double',
                      async () => (await buildCreate(signer, amount, s)).ix,
                      `Double Down: ${fmtSol(amount)} SOL on ${SIDE_NAME[s]} is open — waiting for a challenger.`,
                    );
                    if (ok) setMatch(null);
                  },
                }
              : undefined
          }
          onClaim={async () => {
            const ok = await send(
              `settle:${match.address}`,
              () => buildSettle(client.rpc, match),
              `You won ${fmtSol(payoutFor(match.amount).payout)} SOL — paid to your wallet.`,
            );
            if (ok) setMatchClaimed(true);
          }}
          onClose={() => setMatch(null)}
        />
      )}
      {profileOpen && me && signer && (
        <ProfileDialog
          first={profileOpen === 'first'}
          me={me}
          current={myName}
          busy={busy}
          onClose={() => {
            if (profileOpen === 'first') skipUsername(me);
            setProfileOpen(null);
          }}
          onSave={async (name) => {
            const ok = myName
              ? await send('profile', () => buildChangeUsername(signer, myName, name), `You're now ${name}.`)
              : await send('profile', () => buildCreateProfile(signer, name), `Welcome to the arena, ${name}!`);
            if (ok) setProfileOpen(null);
          }}
          onDelete={async () => {
            if (!myName) return;
            const ok = await send('profile', () => buildDeleteProfile(signer, myName), 'Username deleted — rent refunded.');
            if (ok) setProfileOpen(null);
          }}
        />
      )}
      {howOpen && <HowDialog onClose={() => setHowOpen(false)} />}
    </div>
  );
}
