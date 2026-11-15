import { type Address } from '@solana/kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../client';
import { type JackpotView, fetchJackpot } from '../chain';
import { JackpotStatus } from '../generated';
import { fmtSol, parseSol, short, type Names } from '../format';
import { Avatar } from './Avatar';
import { Amount } from './Amount';

/** Keep in sync with programs/degenwild/src/constants.rs. */
const MIN_ENTRY = 10_000_000n; // 0.01 SOL
const MAX_ENTRY = 10_000_000_000n; // 10 SOL
const COUNTDOWN_SECS = 120;
const POLL_MS = 2_000;
const KEEPER_URL: string = import.meta.env?.VITE_JACKPOT_URL ?? '/api/jackpot';

/** Segment colors, in join order. */
const SEGMENTS = ['#ff3038', '#f5c542', '#3ddc84', '#4f7cff', '#ff8a1f', '#a855f7', '#22d3ee', '#ff4fb4', '#14b8a6', '#e5e7eb', '#b91c1c', '#84cc16'];

type Entry = { player: Address; amount: bigint };
type Snapshot = { roundId: bigint; total: bigint; entries: Entry[] };
type Result = { roundId: bigint; winner: Address; total: bigint; payout: bigint; ticket: bigint; entries: Entry[] };

const C = 200; // wheel center
const R_OUT = 182;
const R_IN = 96;

function polar(r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arc(start: number, end: number) {
  // Full circle needs two arcs.
  if (end - start >= 359.999) end = start + 359.999;
  const [x1, y1] = polar(R_OUT, start);
  const [x2, y2] = polar(R_OUT, end);
  const [x3, y3] = polar(R_IN, end);
  const [x4, y4] = polar(R_IN, start);
  const large = end - start > 180 ? 1 : 0;
  return `M${x1} ${y1}A${R_OUT} ${R_OUT} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${R_IN} ${R_IN} 0 ${large} 0 ${x4} ${y4}Z`;
}

const pct = (part: bigint, total: bigint) => (total > 0n ? Number((part * 10_000n) / total) / 100 : 0);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

export function JackpotPage(props: {
  me?: Address;
  names: Names;
  busy: string | null;
  canPlay: boolean;
  onConnect: () => void;
  onEnter: (amount: bigint, roundId: bigint) => Promise<boolean>;
  onLeave: (roundId: bigint) => Promise<boolean>;
}) {
  const { me, names } = props;
  const [view, setView] = useState<JackpotView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stakeInput, setStakeInput] = useState('0.1');
  const [rot, setRot] = useState(0);
  const [phase, setPhase] = useState<'live' | 'spinning' | 'landing' | 'result'>('live');
  const [result, setResult] = useState<Result | null>(null);
  const snapshot = useRef<Snapshot | null>(null);
  const rotRef = useRef(0);
  const anim = useRef<number | null>(null);
  const seenResult = useRef<bigint>(-1n);

  const nameOf = useCallback((a: Address) => (a === me ? 'You' : (names.get(a) ?? short(a))), [me, names]);

  // ---------------------------------------------------------------- polling
  const refresh = useCallback(async () => {
    try {
      const v = await fetchJackpot(client.rpc);
      setView(v);
      setLoadError(null);
      if (v.round) snapshot.current = { roundId: v.round.roundId, total: v.round.total, entries: v.round.entries };
      // A round we were watching just paid out.
      const st = v.state;
      const snap = snapshot.current;
      if (st && snap && st.lastRound === snap.roundId && st.lastRound !== seenResult.current && !v.round) {
        seenResult.current = st.lastRound;
        setResult({
          roundId: st.lastRound,
          winner: st.lastWinner,
          total: st.lastTotal,
          payout: st.lastPayout,
          ticket: st.lastTicket,
          entries: snap.entries,
        });
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the jackpot.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, [refresh]);

  const round = view?.round ?? null;
  const countdownEnd = round && round.countdownEnd > 0n ? Number(round.countdownEnd) * 1000 : 0;
  const secondsLeft = countdownEnd ? Math.max(0, Math.ceil((countdownEnd - now) / 1000)) : null;
  const drawing = round?.status === JackpotStatus.Drawing;
  const due = !!round && round.status === JackpotStatus.Open && countdownEnd > 0 && now >= countdownEnd;

  // ---------------------------------------------------------------- keeper: nudge the server to draw / pay out
  useEffect(() => {
    if (!due && !drawing) return;
    const poke = () => {
      if (document.visibilityState === 'visible') void fetch(KEEPER_URL, { method: 'POST' }).catch(() => {});
    };
    poke();
    const id = window.setInterval(poke, 3_000);
    return () => window.clearInterval(id);
  }, [due, drawing]);

  // ---------------------------------------------------------------- wheel motion
  const stopAnim = () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  };

  // Free spin while the fair result is on its way.
  useEffect(() => {
    if (!(due || drawing) || phase === 'landing' || phase === 'result') return;
    setPhase('spinning');
    let last = performance.now();
    let speed = 0;
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      speed = Math.min(420, speed + 360 * dt); // ramp up to ~1.2 turns/s
      rotRef.current += speed * dt;
      setRot(rotRef.current);
      anim.current = requestAnimationFrame(step);
    };
    stopAnim();
    anim.current = requestAnimationFrame(step);
    return stopAnim;
  }, [due, drawing, phase]);

  // Land on the winning ticket.
  useEffect(() => {
    if (!result || result.total === 0n) return;
    stopAnim();
    setPhase('landing');
    const theta = (Number((result.ticket * 1_000_000n) / result.total) / 1_000_000) * 360;
    const start = rotRef.current;
    const base = start + 4 * 360;
    const target = base + ((((-theta - base) % 360) + 360) % 360);
    const t0 = performance.now();
    const dur = 6000;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      rotRef.current = start + (target - start) * easeOut(k);
      setRot(rotRef.current);
      if (k < 1) anim.current = requestAnimationFrame(step);
      else {
        anim.current = null;
        setPhase('result');
      }
    };
    anim.current = requestAnimationFrame(step);
    return stopAnim;
  }, [result]);

  // Clear the result card after a while, back to the live round.
  useEffect(() => {
    if (phase !== 'result') return;
    const id = window.setTimeout(() => {
      setResult(null);
      setPhase('live');
      rotRef.current %= 360;
      setRot(rotRef.current);
    }, 10_000);
    return () => window.clearTimeout(id);
  }, [phase]);

  // ---------------------------------------------------------------- what the wheel shows
  const shown: Snapshot | null = result
    ? { roundId: result.roundId, total: result.total, entries: result.entries }
    : round
      ? { roundId: round.roundId, total: round.total, entries: round.entries }
      : null;

  const segments = useMemo(() => {
    if (!shown || shown.total === 0n) return [];
    let acc = 0n;
    return shown.entries.map((e, i) => {
      const start = (Number((acc * 1_000_000n) / shown.total) / 1_000_000) * 360;
      acc += e.amount;
      const end = (Number((acc * 1_000_000n) / shown.total) / 1_000_000) * 360;
      return { ...e, start, end, color: SEGMENTS[i % SEGMENTS.length], chance: pct(e.amount, shown.total) };
    });
  }, [shown]);

  const myEntry = shown?.entries.find((e) => e.player === me);
  const stake = parseSol(stakeInput);
  const stakeError =
    stake === null ? 'Enter an amount' : stake < MIN_ENTRY ? 'Minimum is 0.01 SOL' : stake > MAX_ENTRY ? 'Maximum is 10 SOL' : null;
  const total = round?.total ?? 0n;
  const myAmount = round?.entries.find((e) => e.player === me)?.amount ?? 0n;
  const previewChance = stake && !stakeError ? pct(myAmount + stake, total + stake) : null;
  const entriesClosed = drawing || due || phase === 'landing' || phase === 'result';
  const roundId = view?.state?.currentRound ?? 1n;
  const players = round?.entries.length ?? 0;
  const canLeave = !!round && players === 1 && round.entries[0].player === me && round.countdownEnd === 0n && !drawing;
  const ringFrac = secondsLeft === null ? 1 : secondsLeft / COUNTDOWN_SECS;
  const winnerSeg = result ? segments.find((s) => s.player === result.winner) : undefined;

  let status: React.ReactNode;
  if (phase === 'result' && result) status = <>Winner!</>;
  else if (phase === 'landing') status = <>Landing…</>;
  else if (drawing || due) status = <>Spinning…</>;
  else if (secondsLeft !== null) status = <>Spin in</>;
  else if (players === 1) status = <>Need 1 more player</>;
  else status = <>Be the first in</>;

  return (
    <div className="jp-page">
      <header className="jp-hero panel">
        <div className="eyebrow">
          <span className="red-line" /> JACKPOT
        </div>
        <h1>
          One pot. <span>One winner.</span>
        </h1>
        <p>
          Throw SOL in the pot: the more you put in, the bigger your slice of the wheel. When the second player joins, a
          2-minute countdown starts. Then the wheel spins and provably fair randomness picks the winner, who takes the pot
          minus a 3.5% fee.
        </p>
      </header>

      <div className="jp-grid">
        <section className={`jp-stage panel ${phase}`}>
          <div className="jp-wheel-wrap">
            <svg className="jp-wheel" viewBox="0 0 400 400" role="img" aria-label="Jackpot wheel">
              <defs>
                <radialGradient id="jp-hub" cx="50%" cy="40%" r="70%">
                  <stop offset="0%" stopColor="#2a1012" />
                  <stop offset="100%" stopColor="#0c0909" />
                </radialGradient>
                <filter id="jp-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="6" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* outer rim with tick marks */}
              <circle cx={C} cy={C} r={R_OUT + 12} className="jp-rim" />
              {Array.from({ length: 60 }, (_, i) => {
                const [x1, y1] = polar(R_OUT + 5, i * 6);
                const [x2, y2] = polar(R_OUT + (i % 5 === 0 ? 14 : 10), i * 6);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="jp-tick" />;
              })}

              <g transform={`rotate(${rot} ${C} ${C})`}>
                {segments.length === 0 ? (
                  <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} className="jp-empty" strokeWidth={R_OUT - R_IN} />
                ) : (
                  segments.map((s) => (
                    <path
                      key={s.player}
                      d={arc(s.start, s.end)}
                      fill={s.color}
                      className={`jp-seg ${s.player === me ? 'mine' : ''} ${winnerSeg && winnerSeg.player !== s.player ? 'dim' : ''}`}
                    />
                  ))
                )}
                {segments.map((s) => {
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

              {/* hub with the pot and countdown */}
              <circle cx={C} cy={C} r={R_IN - 4} fill="url(#jp-hub)" className="jp-hub" />
              <circle
                cx={C}
                cy={C}
                r={R_IN - 12}
                className="jp-ring-bg"
              />
              <circle
                cx={C}
                cy={C}
                r={R_IN - 12}
                className="jp-ring"
                strokeDasharray={`${2 * Math.PI * (R_IN - 12)}`}
                strokeDashoffset={`${2 * Math.PI * (R_IN - 12) * (1 - ringFrac)}`}
                transform={`rotate(-90 ${C} ${C})`}
              />
              <text x={C} y={C - 30} className="jp-hub-label">
                {phase === 'result' ? 'WON' : 'POT'}
              </text>
              <text x={C} y={C + 2} className="jp-hub-pot">
                {fmtSol(phase === 'result' && result ? result.payout : (shown?.total ?? 0n))}
              </text>
              <text x={C} y={C + 22} className="jp-hub-sol">SOL</text>
              <text x={C} y={C + 50} className={`jp-hub-timer ${secondsLeft !== null && secondsLeft <= 10 && !entriesClosed ? 'hot' : ''}`}>
                {secondsLeft !== null && !entriesClosed
                  ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
                  : ''}
              </text>

              {/* pointer */}
              <g filter="url(#jp-glow)">
                <path d={`M${C - 15} 2 L${C + 15} 2 L${C} 34 Z`} className="jp-pointer" />
              </g>
            </svg>
            <div className="jp-status">{status}</div>
          </div>

          {phase === 'result' && result && (
            <div className="jp-winner" role="status">
              <Avatar address={result.winner} size={64} ring={winnerSeg?.color} />
              <div>
                <small>ROUND #{result.roundId.toString()} WINNER</small>
                <b>{nameOf(result.winner)}</b>
                <span>
                  won <Amount lamports={result.payout} /> SOL with a {pct(
                    result.entries.find((e) => e.player === result.winner)?.amount ?? 0n,
                    result.total,
                  )}% chance
                </span>
              </div>
            </div>
          )}
        </section>

        <aside className="jp-side">
          <section className="panel jp-enter">
            <div className="eyebrow">ROUND #{roundId.toString()}</div>
            <h2>Enter the pot</h2>
            <div className={`amount-input ${stakeError ? 'invalid' : ''}`}>
              <span className="sol-symbol">◎</span>
              <input
                inputMode="decimal"
                value={stakeInput}
                onChange={(e) => setStakeInput(e.target.value.replace(',', '.'))}
                aria-label="Jackpot entry in SOL"
                disabled={entriesClosed}
              />
              <span className="sol-unit">SOL</span>
            </div>
            <div className="quick-amounts">
              {['0.05', '0.1', '0.5', '1'].map((v) => (
                <button key={v} onClick={() => setStakeInput(v)} disabled={entriesClosed}>
                  {v}
                </button>
              ))}
            </div>
            <button
              className="primary-btn jp-enter-btn"
              disabled={entriesClosed || !!stakeError || props.busy !== null}
              onClick={async () => {
                if (!props.canPlay) return props.onConnect();
                const ok = await props.onEnter(stake!, roundId);
                if (ok) void refresh();
              }}
            >
              {props.busy === 'jackpot'
                ? 'Entering…'
                : entriesClosed
                  ? 'Entries closed: spinning'
                  : !props.canPlay
                    ? 'Connect to enter'
                    : myAmount > 0n
                      ? `Add ${stakeInput || '0'} SOL`
                      : `Enter with ${stakeInput || '0'} SOL`}
            </button>
            <small className="jp-hint">
              {stakeError
                ? stakeError
                : previewChance !== null
                  ? `Your chance after this: ${previewChance}% · entries 0.01–10 SOL`
                  : 'Entries 0.01–10 SOL'}
            </small>
            {canLeave && (
              <button
                className="link-btn"
                disabled={props.busy !== null}
                onClick={async () => {
                  if (await props.onLeave(roundId)) void refresh();
                }}
              >
                Leave and take my SOL back
              </button>
            )}
          </section>

          <section className="panel jp-players">
            <div className="jp-players-head">
              <h2>
                Players <span className="count-pill">{String(shown?.entries.length ?? 0).padStart(2, '0')}</span>
              </h2>
              {myEntry && shown && <span className="jp-mychance">You: {pct(myEntry.amount, shown.total)}%</span>}
            </div>
            {loadError && <p className="dialog-error">{loadError}</p>}
            {segments.length === 0 ? (
              <p className="jp-empty-text">Nobody's in yet. Be the first: your avatar is waiting.</p>
            ) : (
              <ul>
                {[...segments]
                  .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
                  .map((s) => (
                    <li key={s.player} className={`${s.player === me ? 'mine' : ''} ${result?.winner === s.player ? 'won' : ''}`}>
                      <i style={{ background: s.color }} />
                      <Avatar address={s.player} size={30} ring={s.color} />
                      <span className="jp-name">{nameOf(s.player)}</span>
                      <span className="jp-amt">
                        <Amount lamports={s.amount} /> SOL
                      </span>
                      <span className="jp-chance">{s.chance.toFixed(2)}%</span>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          {view?.state && view.state.lastRound > 0n && phase !== 'result' && (
            <p className="jp-last">
              Last pot #{view.state.lastRound.toString()}: <Avatar address={view.state.lastWinner} size={18} />{' '}
              <b>{nameOf(view.state.lastWinner)}</b> won <Amount lamports={view.state.lastPayout} /> SOL
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
