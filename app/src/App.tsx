import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Address, type Instruction, none, some } from '@solana/kit';
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  useWalletStatus,
} from '@solana/kit-plugin-wallet/react';
import { client, clientV0 } from './client';
import {
  CLUSTER,
  MAX_STAKE_LAMPORTS,
  MIN_STAKE_LAMPORTS,
  PLATFORM_ADMIN,
  POLL_MS,
  explorerTx,
} from './config';
import {
  type BattleView,
  type Randomness,
  buildCancel,
  buildChangeUsername,
  buildCreate,
  buildCreateProfile,
  buildDeleteProfile,
  buildInitPlatform,
  buildJoin,
  buildRefund,
  buildSettle,
  describeError,
  fetchAllBattles,
  fetchAllUsernames,
  fetchRandomness,
  fetchTreasury,
  isUsernameTaken,
  opponentOf,
  payoutFor,
  refundDeadline,
  validateUsername,
  winnerOf,
} from './chain';
import { BattleStatus } from './generated';
import { MatchScreen } from './MatchScreen';
import { type GameResult, GameHistory } from './history';

type Side = 0 | 1;
const SIDE_NAME = ['HEADS', 'TAILS'] as const;

// ------------------------------------------------------------ formatting

const LAMPORTS = 1_000_000_000n;
function fmtSol(l: bigint, max = 4): string {
  const whole = l / LAMPORTS;
  const frac = (l % LAMPORTS).toString().padStart(9, '0').slice(0, max).replace(/0+$/, '');
  return `${whole}.${frac.padEnd(2, '0')}`;
}
/** Parses a user-typed SOL amount into lamports without floating point. */
function parseSol(input: string): bigint | null {
  const m = input.trim().match(/^(\d+)(?:\.(\d{0,9}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * LAMPORTS + BigInt((m[2] ?? '').padEnd(9, '0'));
}
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const avatar = (a: string) => a[0].toUpperCase();

function timeAgo(t: number | null): string {
  if (!t) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Shapes a finished-game event like a battle so rows and replays can reuse the battle UI. */
function resultToBattle(r: GameResult): BattleView {
  const settled = r.kind === 'settled';
  return {
    address: r.battle,
    discriminator: new Uint8Array(8),
    creator: r.creator,
    opponent: some(r.opponent),
    amount: settled ? (r.payout + r.fee) / 2n : r.amount,
    battleId: r.battleId,
    status: settled ? BattleStatus.Settled : BattleStatus.Refunded,
    randomnessSeed: new Uint8Array(32),
    randomnessAccount: r.battle,
    winner: settled ? some(r.winner) : none(),
    // Settled: the creator's side follows from who won. Refund events don't carry it (shown as "?").
    creatorSide: settled ? (r.winner === r.creator ? r.coin : 1 - r.coin) : 255,
    joinedSlot: 0n,
    bump: 0,
  };
}

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

type Names = Map<Address, string>;

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
  const [view, setView] = useState<'coinflip' | 'jackpot'>('coinflip');
  const [side, setSide] = useState<Side>(0);
  const [stakeInput, setStakeInput] = useState('0.1');
  const [battles, setBattles] = useState<BattleView[]>([]);
  const [randomness, setRandomness] = useState<Record<string, Randomness>>({});
  // Finished games, read from the program's BattleSettled / BattleRefunded events (newest first).
  const [results, setResults] = useState<GameResult[]>([]);
  const history = useRef(new GameHistory(client.rpc));
  const [slot, setSlot] = useState<bigint>(0n);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
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
      const [all, s, usernames, tre] = await Promise.all([
        fetchAllBattles(client.rpc),
        client.rpc.getSlot({ commitment: 'confirmed' }).send(),
        fetchAllUsernames(client.rpc),
        fetchTreasury(client.rpc),
      ]);
      setTreasury(tre);
      setNames(usernames);
      setNamesLoaded(true);
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
      try {
        const ix = await build();
        const sender = connected.supportedTransactionVersions.has(1) ? client : clientV0;
        const result = await sender.sendTransaction([ix]);
        toast.show(success, explorerTx(result.context.signature));
        await Promise.all([refresh(), refreshBalance()]);
        return true;
      } catch (e) {
        console.error(e);
        toast.show(describeError(e));
        return false;
      } finally {
        setBusy(null);
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
  const othersOpen = open.filter((b) => b.creator !== me);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={() => setView('coinflip')} aria-label="DEGEN WILD home">
          <img className="brand-logo" src="/degenwild-logo.png" alt="DEGEN WILD" />
        </a>
        <div className="nav-label">PLAY</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={`nav-link ${view === 'coinflip' ? 'active' : ''}`} onClick={() => setView('coinflip')}>
            <span className="nav-icon">◉</span>Coinflip
          </button>
          <button className={`nav-link ${view === 'jackpot' ? 'active' : ''}`} onClick={() => setView('jackpot')}>
            <span className="nav-icon">♜</span>Jackpot
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
            <img className="brand-logo small" src="/degenwild-logo.png" alt="DEGEN WILD" />
          </div>
          <div className="page-kicker">
            {view === 'coinflip' ? (
              <>PVP ARENA <span>/</span> COINFLIP</>
            ) : (
              <>GAME MODE <span>/</span> JACKPOT</>
            )}
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
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="red-line"></span> THE PVP ARENA
                </div>
                <h1>
                  CALL YOUR
                  <br />
                  <em>FLIP.</em>
                </h1>
                <p>Pick a side. Match a player. Let it ride.</p>
              </div>
              <div className="hero-emblem" aria-hidden="true">
                <img className="hero-logo" src="/degenwild-logo.png" alt="" />
              </div>
              <div className="hero-glow"></div>
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
                <span className="step-label">
                  01 <i>/</i> 02
                </span>
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
                        <span className="coin-mini">{s === 0 ? 'H' : 'T'}</span>
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
                    `Win ${fmtSol(payoutFor(stake).payout)} SOL (pot ${fmtSol(payoutFor(stake).pot)} minus 3.5% fee). Stakes ${fmtSol(MIN_STAKE_LAMPORTS)}–${fmtSol(MAX_STAKE_LAMPORTS, 0)} SOL. Your stake is held in on-chain escrow until someone joins or you cancel.`)}
              </div>
            </section>

            {me && (mine.length > 0 || myOpen.length > 0) && (
              <section className="lobby-section">
                <div className="lobby-heading">
                  <div>
                    <div className="eyebrow">YOUR MATCHES</div>
                    <h2>
                      My battles <span className="count-pill">{String(mine.length + myOpen.length).padStart(2, '0')}</span>
                    </h2>
                  </div>
                </div>
                <div className="battle-list">
                  {[...myOpen, ...mine].map((b) => (
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
                          <span className={`recent-coin ${r.coin ? 'tails' : 'heads'}`}>{r.coin ? 'T' : 'H'}</span>
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
        ) : (
          <section className="view active">
            <section className="hero jackpot-hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="red-line"></span> THE BIG POT
                </div>
                <h1>
                  ONE POT.
                  <br />
                  <em>ONE WINNER.</em>
                </h1>
                <p>Jackpot mode is a separate game area.</p>
              </div>
              <div className="hero-emblem jackpot-emblem" aria-hidden="true">
                <div className="emblem-ring">
                  <span>777</span>
                </div>
                <b>JACKPOT</b>
              </div>
              <div className="hero-glow"></div>
            </section>
            <section className="panel jackpot-card">
              <div className="eyebrow">NEXT ROUND</div>
              <h2>Jackpot is coming soon.</h2>
              <p>
                We're getting the coinflip experience working first. Jackpot will be built and tested as its own feature
                afterwards.
              </p>
              <div className="coming-soon">
                <span></span> IN DEVELOPMENT
              </div>
            </section>
          </section>
        )}

        <footer>
          DEGEN WILD <span>·</span> {CLUSTER.toUpperCase()} <span>·</span>{' '}
          {CLUSTER === 'mainnet' ? 'PLAY RESPONSIBLY' : 'TEST NETWORK — NO REAL FUNDS'}
        </footer>
      </main>

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

// ------------------------------------------------------------ battle row

function BattleRow(props: {
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
  const label = (a: Address) => (a === me ? `You${nameOf(a) ? ` (${nameOf(a)})` : ''}` : (nameOf(a) ?? short(a)));
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
        <span className={`avatar ${winner === b.creator ? 'win' : ''}`}>{avatar(nameOf(b.creator) ?? b.creator)}</span>
        <div>
          <b>{label(b.creator)}</b>
          <small>
            {creatorSide} · {fmtSol(b.amount)} SOL
          </small>
        </div>
      </div>
      <span className="versus">VS</span>
      <div className="player">
        <span className={`avatar ${opp && winner === opp ? 'win' : ''}`}>{opp ? avatar(nameOf(opp) ?? opp) : '?'}</span>
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

// ------------------------------------------------------------ wallet

function WalletButton(props: { me?: Address; name?: string; onOpen: () => void; onAccount: () => void }) {
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

function ProfileDialog(props: {
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
        removed by DEGEN WILD.
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

function WalletDialog({ onClose }: { onClose: () => void }) {
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
        Your wallet asks you to approve every transaction. DEGEN WILD never sees your keys.
      </p>
    </Modal>
  );
}

function HowDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How coinflip works" onClose={onClose}>
      <p>
        <b>1.</b> Pick Heads or Tails and a stake ({fmtSol(MIN_STAKE_LAMPORTS)}–{fmtSol(MAX_STAKE_LAMPORTS, 0)} SOL). Your stake
        goes into an on-chain escrow account owned by the DEGEN WILD program. You can cancel any time until someone joins.
      </p>
      <p>
        <b>2.</b> An opponent joins with the exact same stake on the other side. Joining requests a provably fair random
        result from an independent randomness network; the joiner pays its small fee (~0.0003 SOL).
      </p>
      <p>
        <b>3.</b> Seconds later the coin lands. The winner claims the pot minus a 3.5% platform fee. If no result arrives within
        ~5 minutes, either player can refund both stakes.
      </p>
      <p className="dialog-muted">
        Provably fair: neither player nor DEGEN WILD can choose the outcome. The randomness is signed by several independent
        nodes and checked on-chain before anyone is paid.
      </p>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    // No close() in cleanup: React dev mode runs effects twice, and close() fires onClose,
    // which would unmount the dialog straight away. Unmounting removes it anyway.
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
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
