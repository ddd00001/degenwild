import { type Address } from '@solana/kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { client } from '../client';
import { type JackpotView, fetchJackpot } from '../chain';
import { JackpotStatus } from '../generated';
import { fmtSol, parseSol, short, timeAgo, type Names } from '../format';
import { explorerTx } from '../config';
import { fetchJackpotEntries } from '../jackpotReplay';
import { JackpotReplay } from './JackpotReplay';
import type { JackpotResult } from '../history';
import { Avatar, avatarName } from './Avatar';
import { WheelBezel, WheelDefs, WheelHub, WheelPointer, WheelShading, WheelSheen, VaultLiquid, VaultGlass } from './WheelFrame';
import { fmtUsd, useSolPrice } from '../price';
import { crossedMilestone, jackpotTier } from '../visualTiers';
import { play } from '../sound';

/** Keep in sync with programs/degenwild/src/constants.rs. */
const MIN_ENTRY = 50_000_000n; // 0.05 SOL
const MAX_ENTRY = 10_000_000_000n; // 10 SOL
const COUNTDOWN_SECS = 120;
const POLL_MS = 2_000;
const KEEPER_URL: string = import.meta.env?.VITE_JACKPOT_URL ?? '/api/jackpot';

/**
 * Player colors, by join order in the round (stable on-chain order, so the same after a refresh
 * and unchanged when someone else joins). Gold and red first; the rest only with more players.
 */
export const SEGMENTS = ['#f5c542', '#ff3038', '#3d8bff', '#a855f7', '#22d3ee', '#ff8a1f', '#3ddc84', '#ff4fb4', '#e5e7eb', '#14b8a6', '#b91c1c', '#84cc16'];

type Entry = { player: Address; amount: bigint };

/** "$12.34" for an amount in lamports, or '' until the SOL price has loaded. */
export function usd(lamports: bigint, solUsd: number | undefined): string {
  return solUsd ? fmtUsd((Number(lamports) / 1e9) * solUsd) : '';
}
type Snapshot = { roundId: bigint; total: bigint; entries: Entry[] };
type Result = { roundId: bigint; winner: Address; total: bigint; payout: bigint; ticket: bigint; entries: Entry[] };

export const C = 200; // wheel center
export const R_OUT = 182;
export const R_IN = 96;

export function polar(r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

export function arc(start: number, end: number) {
  // Full circle needs two arcs.
  if (end - start >= 359.999) end = start + 359.999;
  const [x1, y1] = polar(R_OUT, start);
  const [x2, y2] = polar(R_OUT, end);
  const [x3, y3] = polar(R_IN, end);
  const [x4, y4] = polar(R_IN, start);
  const large = end - start > 180 ? 1 : 0;
  return `M${x1} ${y1}A${R_OUT} ${R_OUT} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${R_IN} ${R_IN} 0 ${large} 0 ${x4} ${y4}Z`;
}

/** A full donut (one player owns the whole wheel): two half arcs, so there's no seam. */
export function ring() {
  return `M${C} ${C - R_OUT}A${R_OUT} ${R_OUT} 0 1 1 ${C} ${C + R_OUT}A${R_OUT} ${R_OUT} 0 1 1 ${C} ${C - R_OUT}ZM${C} ${C - R_IN}A${R_IN} ${R_IN} 0 1 0 ${C} ${C + R_IN}A${R_IN} ${R_IN} 0 1 0 ${C} ${C - R_IN}Z`;
}

export const pct = (part: bigint, total: bigint) => (total > 0n ? Number((part * 10_000n) / total) / 100 : 0);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function JackpotPage(props: {
  me?: Address;
  names: Names;
  busy: string | null;
  canPlay: boolean;
  onConnect: () => void;
  onEnter: (amount: bigint, roundId: bigint) => Promise<boolean>;
  onLeave: (roundId: bigint) => Promise<boolean>;
  recent: JackpotResult[];
  /** Every known result, including ones still held back from the feed (for the payout tx link). */
  allRecent: JackpotResult[];
}) {
  const { me, names } = props;
  const [view, setView] = useState<JackpotView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [stakeInput, setStakeInput] = useState('0.1');
  const [replaying, setReplaying] = useState<JackpotResult | null>(null);
  // Winner's chance per finished round, rebuilt from the round's entries (cached per round).
  const [chances, setChances] = useState<Record<string, { chance: number; stake: bigint }>>({});
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const r of props.recent.slice(0, 10)) {
        if (!alive || chances[r.signature] !== undefined) continue;
        try {
          const e = await fetchJackpotEntries(client.rpc, r.round);
          const mine = e.find((x) => x.player === r.winner)?.amount ?? 0n;
          if (alive && mine > 0n) setChances((c) => ({ ...c, [r.signature]: { chance: pct(mine, r.total), stake: mine } }));
        } catch {
          /* best effort */
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.recent]);
  const [hover, setHover] = useState<{ player: Address; x: number; y: number; left: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hoverAt = (player: Address) => (e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    // Window coordinates: the card is position:fixed so the wheel panel can't clip it.
    if (r) setHover({ player, x: e.clientX, y: e.clientY, left: e.clientX > r.left + r.width / 2 });
  };
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
    }, 18_000);
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
    stake === null ? 'Enter an amount' : stake < MIN_ENTRY ? 'Minimum is 0.05 SOL' : stake > MAX_ENTRY ? 'Maximum is 10 SOL' : null;
  const total = round?.total ?? 0n;
  const price = useSolPrice();
  const solUsd = price?.usd;
  const priceSource = price?.source;
  const stakeUsd = stake && !stakeError ? usd(stake, solUsd) : '';
  const myAmount = round?.entries.find((e) => e.player === me)?.amount ?? 0n;
  const previewChance = stake && !stakeError ? pct(myAmount + stake, total + stake) : null;
  const entriesClosed = drawing || due || phase === 'landing' || phase === 'result';
  const roundId = view?.state?.currentRound ?? 1n;
  const players = round?.entries.length ?? 0;
  const canLeave = !!round && players === 1 && round.entries[0].player === me && round.countdownEnd === 0n && !drawing;
  // continuous (not per whole second) so the ring drains smoothly; now ticks every 250ms + a 250ms linear transition
  const ringFrac = countdownEnd ? Math.max(0, Math.min(1, (countdownEnd - now) / (COUNTDOWN_SECS * 1000))) : 1;
  const winnerSeg = result ? segments.find((s) => s.player === result.winner) : undefined;

  // ---------------------------------------------------------------- segments ease to new sizes
  // A new player grows in from the top; everyone else shrinks to make room. Purely visual: the
  // odds shown everywhere come from `segments`, never from these in-between angles.
  const segSig = segments.map((g) => `${g.player}:${g.start.toFixed(3)}:${g.end.toFixed(3)}`).join('|');
  const segFrom = useRef(new Map<string, { start: number; end: number }>());
  const segOnScreen = useRef(new Map<string, { start: number; end: number }>());
  const segMounted = useRef(false);
  const [segK, setSegK] = useState(1);
  useEffect(() => {
    segFrom.current = new Map(segOnScreen.current);
    if (!segMounted.current || reducedMotion()) {
      segMounted.current = true;
      setSegK(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 650);
      setSegK(k);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    setSegK(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [segSig]);
  const segE = easeOut(segK);
  const wheelSegs = segments.map((g) => {
    const from = segFrom.current.get(g.player) ?? { start: 360, end: 360 };
    return { ...g, start: from.start + (g.start - from.start) * segE, end: from.end + (g.end - from.end) * segE };
  });
  segOnScreen.current = new Map(wheelSegs.map((g) => [g.player, { start: g.start, end: g.end }]));

  // ---------------------------------------------------------------- pot counts up to its new value
  const potTarget = Number(shown?.total ?? 0n) / 1e9;
  const [potShown, setPotShown] = useState(potTarget);
  const potRef = useRef(potTarget);
  const [potBump, setPotBump] = useState(0);
  useEffect(() => {
    const from = potRef.current;
    const to = potTarget;
    if (from === to) return;
    if (to > from && from > 0) setPotBump((n) => n + 1);
    if (reducedMotion()) {
      potRef.current = to;
      setPotShown(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      const v = from + (to - from) * easeOut(k);
      potRef.current = v;
      setPotShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [potTarget]);
  const potLamports = BigInt(Math.round(potShown * 1e9));

  // ---------------------------------------------------------------- tier + milestones (whole pot)
  const tier = jackpotTier(shown?.total ?? 0n);
  const msPrev = useRef<{ round: bigint; total: bigint } | null>(null);
  const [celebrate, setCelebrate] = useState<{ at: number; special: boolean; key: string } | null>(null);
  useEffect(() => {
    if (!view) return;
    if (!round) {
      msPrev.current ??= { round: -1n, total: 0n }; // saw the jackpot empty: the next round starts from 0
      return;
    }
    const prev = msPrev.current;
    msPrev.current = { round: round.roundId, total: round.total };
    if (!prev) return; // first look after (re)loading: never replay old milestones
    const before = prev.round === round.roundId ? prev.total : 0n;
    const hit = crossedMilestone(before, round.total);
    if (!hit) return;
    const key = `dw-jp-ms:${round.roundId}:${hit.at}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* storage blocked: still celebrate once for this page */
    }
    setCelebrate({ ...hit, key });
  }, [view, round?.roundId, round?.total]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!celebrate) return;
    const id = window.setTimeout(() => setCelebrate(null), celebrate.special ? 3200 : 2200);
    return () => window.clearTimeout(id);
  }, [celebrate]);

  // ---------------------------------------------------------------- countdown stages
  const cdStage =
    secondsLeft === null || entriesClosed ? '' : secondsLeft <= 10 ? 'cd-final' : secondsLeft <= 30 ? 'cd-hot' : 'cd-on';
  const winnerChance = result && winnerSeg ? winnerSeg.chance : 0;
  const payoutTx = result ? props.allRecent.find((x) => x.roundId === result.roundId)?.signature : undefined;
  // Bring the winner's row into view in the (scrolling) player list when the result shows.
  useEffect(() => {
    if (phase !== 'result') return;
    document.querySelector('.jp-players li.won')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [phase]);

  // ---------------------------------------------------------------- sounds (from observed round state)
  const sndPrev = useRef<{ round: bigint; players: number; countdown: boolean } | null>(null);
  useEffect(() => {
    if (!view) return;
    if (!round) {
      sndPrev.current ??= { round: -1n, players: 0, countdown: false }; // saw it empty
      return;
    }
    const cur = { round: round.roundId, players: round.entries.length, countdown: round.countdownEnd > 0n };
    const prev = sndPrev.current;
    sndPrev.current = cur;
    if (!prev) return; // first look after (re)loading: nothing to announce
    const before = prev.round === cur.round ? prev : { players: 0, countdown: false };
    if (cur.players > before.players) play('jpJoin', `jp-join:${cur.round}:${cur.players}`);
    if (cur.countdown && !before.countdown) play('jpCountdown', `jp-cd:${cur.round}`);
  }, [view, round?.roundId, round?.entries.length, round?.countdownEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (round && secondsLeft !== null && secondsLeft > 0 && secondsLeft <= 10 && !entriesClosed)
      play('jpTick', `jp-tick:${round.roundId}:${secondsLeft}`);
  }, [secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase === 'spinning') play('jpSpin', `jp-spin:${shown?.roundId ?? ''}`);
    if (phase === 'result' && result) play('jpWin', `jp-win:${result.roundId}`);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  let status: React.ReactNode;
  if (phase === 'result' && result) status = <>Round #{result.roundId.toString()} complete</>;
  else if (phase === 'landing') status = <>Landing…</>;
  else if (drawing) status = <>Awaiting on-chain confirmation…</>;
  else if (due) status = <>Locking the round on-chain…</>;
  else if (secondsLeft !== null) status = secondsLeft <= 10 ? <>Last call!</> : <>Entries open</>;
  else if (players === 1) status = <>Need 1 more player</>;
  else status = <>Be the first in</>;

  return (
    <div className="jp-page">
      <div className="jp-grid">
        <section
          className={`jp-stage panel ${phase} jp-tier-${tier.tier} ${cdStage}`}
          style={{ ['--jp-i' as string]: tier.intensity.toFixed(3) } as React.CSSProperties}
        >
          {solUsd ? (
            <div className="jp-usd-corner" tabIndex={0}>
              <small>POT VALUE</small>
              <b>≈ {usd(phase === 'result' && result ? result.total : potLamports, solUsd)}</b>
              <span className="jp-usd-tip" role="tooltip">
                <b>US dollar estimate</b>
                <span>
                  {fmtSol(phase === 'result' && result ? result.total : potLamports)} SOL × {fmtUsd(solUsd)} per SOL
                </span>
                <em>Live SOL/USD price from {priceSource ?? 'CoinGecko'}. Devnet SOL is test money; the estimate uses the real price.</em>
              </span>
            </div>
          ) : null}
          <div className="jp-wheel-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
            <svg className="jp-wheel" viewBox="0 0 400 400" role="img" aria-label="Jackpot wheel">
              <WheelDefs />

              {/* outer rim with tick marks */}
              <WheelBezel />

              <VaultLiquid total={phase === 'result' && result ? result.total : potLamports} />
              <g transform={`rotate(${rot} ${C} ${C})`}>
                {segments.length === 0 ? (
                  <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} className="jp-empty" strokeWidth={R_OUT - R_IN} />
                ) : (
                  wheelSegs.map((s) => (
                    <path
                      key={s.player}
                      d={s.end - s.start >= 359.9 ? ring() : arc(s.start, s.end)}
                      fill={s.color}
                      className={`jp-seg ${s.player === me ? 'mine' : ''} ${phase === 'result' && winnerSeg && winnerSeg.player !== s.player ? 'dim' : ''} ${hover?.player === s.player ? 'hot' : ''}`}
                      onMouseMove={hoverAt(s.player)}
                      onClick={hoverAt(s.player)}
                    />
                  ))
                )}
              </g>
              <WheelShading empty={wheelSegs.length === 0} />
              <VaultGlass />
              {/* avatars sit on top of the glass so they stay clear */}
              <g transform={`rotate(${rot} ${C} ${C})`} className="jp-avatars">
                {wheelSegs.map((s) => {
                  const span = s.end - s.start;
                  if (span < 9) return null;
                  const size = Math.max(22, Math.min(46, span * 0.9));
                  const [x, y] = polar((R_OUT + R_IN) / 2, (s.start + s.end) / 2);
                  return (
                    <g
                      key={`a-${s.player}`}
                      transform={`rotate(${-rot} ${x} ${y})`}
                      className="jp-av"
                      onMouseMove={hoverAt(s.player)}
                      onClick={hoverAt(s.player)}
                    >
                      <Avatar address={s.player} size={size} x={x - size / 2} y={y - size / 2} ring={s.color} tint={s.color} />
                    </g>
                  );
                })}
              </g>

              {/* hub with the pot and countdown */}
              <WheelHub />
              
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
                className={`jp-ring ${phase === 'result' ? 'off' : ''}`}
                strokeDasharray={`${2 * Math.PI * (R_IN - 12)}`}
                strokeDashoffset={`${2 * Math.PI * (R_IN - 12) * (1 - ringFrac)}`}
                transform={`rotate(-90 ${C} ${C})`}
              />
              {phase === 'result' && result ? (
                // Winner, inside the hub: no extra card under the wheel, so the panel never changes height.
                <g className="jp-hub-win" key={`win-${result.roundId}`} style={{ ['--win' as string]: winnerSeg?.color ?? '#ffd166' }}>
                  <circle cx={C} cy={C} r={R_IN - 6} className="jp-hub-win-ring" />
                  <text x={C} y={C - 56} className="jp-hub-win-label">
                    WINNER
                  </text>
                  <g className="jp-hub-win-av">
                    <Avatar address={result.winner} size={50} x={C - 25} y={C - 49} ring={winnerSeg?.color} tint={winnerSeg?.color} />
                  </g>
                  <text x={C} y={C + 18} className="jp-hub-win-name">
                    {nameOf(result.winner).length > 12 ? `${nameOf(result.winner).slice(0, 11)}…` : nameOf(result.winner)}
                  </text>
                  <text x={C} y={C + 47} className="jp-hub-win-amt">
                    ◎ {fmtSol(result.total)}
                  </text>
                  <text x={C} y={C + 64} className="jp-hub-win-chance">
                    {winnerChance.toFixed(2)}% chance
                  </text>
                </g>
              ) : (
                <>
                  <text x={C} y={C - 36} className="jp-hub-label">
                    JACKPOT
                  </text>
                  {(() => {
                    // Center "◎ 0.50" as one unit: estimate the amount's width (condensed digits ~21px, dot ~9px).
                    const txt = fmtSol(potLamports, 2);
                    const w = [...txt].reduce((a, ch) => a + (ch === '.' ? 9 : 21), 0);
                    const left = C - (w + 26) / 2;
                    return (
                      <g key={`pot-${potBump}`} className={`jp-hub-pot-row ${potBump ? 'bump' : ''}`}>
                        <text x={left + 9} y={C + 2} className="jp-hub-sol-glyph" aria-hidden="true">
                          ◎
                        </text>
                        <text x={left + 26} y={C + 4} className="jp-hub-pot left">
                          {txt}
                        </text>
                      </g>
                    );
                  })()}
                  <text x={C} y={C + 30} className="jp-hub-sol">
                    SOL
                  </text>
                  <text x={C} y={C + 58} className={`jp-hub-timer ${secondsLeft !== null && secondsLeft <= 10 && !entriesClosed ? 'hot' : ''}`}>
                    {secondsLeft !== null && !entriesClosed
                      ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
                      : ''}
                  </text>
                </>
              )}

              <WheelSheen />
              <WheelPointer />
            </svg>
            {hover &&
              shown &&
              (() => {
                const s = segments.find((g) => g.player === hover.player);
                if (!s) return null;
                const winPot = shown.total;
                return (
                  <div
                    className={`jp-tip ${hover.left ? 'left' : ''}`}
                    style={{ left: hover.x, top: Math.min(Math.max(hover.y, 135), window.innerHeight - 135), borderColor: s.color }}
                    role="tooltip"
                  >
                    <div className="jp-tip-head">
                      <Avatar address={s.player} size={36} ring={s.color} tint={s.color} />
                      <div>
                        <b>{nameOf(s.player)}</b>
                        <small>{avatarName(s.player)} · {short(s.player)}</small>
                      </div>
                    </div>
                    <div className="jp-tip-chance" style={{ color: s.color }}>
                      {s.chance.toFixed(2)}%<span>chance to win</span>
                    </div>
                    <div className="jp-tip-bar">
                      <i style={{ width: `${Math.max(2, s.chance)}%`, background: s.color }} />
                    </div>
                    <dl>
                      <dt>Stake</dt>
                      <dd>
                        {fmtSol(s.amount)} SOL{solUsd ? <em> ≈ {usd(s.amount, solUsd)}</em> : null}
                      </dd>
                      <dt>Multiplier if picked</dt>
                      <dd>{s.amount > 0n ? (Number(winPot) / Number(s.amount)).toFixed(2) : '0'}x</dd>
                    </dl>
                  </div>
                );
              })()}
            {celebrate && (
              <div className={`jp-celebrate ${celebrate.special ? 'special' : ''}`} key={celebrate.key} aria-live="polite">
                <b>{celebrate.at} SOL</b>
                <span>{celebrate.special ? 'JACKPOT IS HEATING UP' : 'POT MILESTONE'}</span>
              </div>
            )}
            <div className="jp-status">
              {status}
              {phase === 'result' && result && (
                <span className="jp-status-tx">
                  {payoutTx ? (
                    <a href={explorerTx(payoutTx)} target="_blank" rel="noreferrer" title={payoutTx}>
                      Payout tx {payoutTx.slice(0, 6)}…{payoutTx.slice(-6)} ↗
                    </a>
                  ) : (
                    'Payout tx confirming…'
                  )}
                </span>
              )}
            </div>
          </div>

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
                  ? 'Entries closed: drawing on-chain'
                  : !props.canPlay
                    ? 'Connect to enter'
                    : myAmount > 0n
                      ? `Add ${stakeInput || '0'} SOL${stakeUsd ? ` (≈ ${stakeUsd})` : ''}`
                      : `Enter with ${stakeInput || '0'} SOL${stakeUsd ? ` (≈ ${stakeUsd})` : ''}`}
            </button>
            <small className="jp-hint">
              {stakeError
                ? stakeError
                : previewChance !== null
                  ? `Your chance after this: ${previewChance}% · stakes 0.05–10.00 SOL`
                  : 'Stakes 0.05–10.00 SOL'}
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
                    <li key={s.player} className={`${s.player === me ? 'mine' : ''} ${phase === 'result' && result?.winner === s.player ? 'won' : ''}`}>
                      <i style={{ background: s.color }} />
                      <Avatar address={s.player} size={30} ring={s.color} tint={s.color} />
                      <span className="jp-name">{nameOf(s.player)}</span>
                      <span className="jp-amt">
                        <b>{fmtSol(s.amount)} SOL</b>
                        {solUsd ? <small>≈ {usd(s.amount, solUsd)}</small> : null}
                      </span>
                      <span className="jp-chance">{s.chance.toFixed(2)}%</span>
                    </li>
                  ))}
              </ul>
            )}
          </section>

        </aside>
      </div>

      <section className="lobby-section jp-history">
        <div className="lobby-heading">
          <div>
            <div className="eyebrow">LIVE FEED</div>
            <h2>
              Recent jackpots <span className="count-pill">{String(Math.min(10, props.recent.length)).padStart(2, '0')}</span>
            </h2>
          </div>
        </div>
        <div className="recent-list">
          {props.recent.length === 0 ? (
            <div className="empty-state">No finished jackpots yet.</div>
          ) : (
            [...props.recent]
              .sort((a, b) => (b.roundId > a.roundId ? 1 : -1))
              .slice(0, 10)
              .map((r) => (
                <div key={r.signature} className={`recent-row jp-recent ${r.winner === me ? 'mine-win' : ''}`}>
                  <Avatar address={r.winner} size={28} />
                  <span className="recent-text">
                    <span className="jp-round">#{r.roundId.toString()}</span> <b>{nameOf(r.winner)}</b> won{' '}
                    <b>{fmtSol(r.total)} SOL</b>
                    {solUsd ? <span className="jp-usd"> ({usd(r.total, solUsd)})</span> : null}
                    {chances[r.signature] !== undefined && (
                      <span className="jp-chance-pill" tabIndex={0}>
                        {chances[r.signature].chance.toFixed(2)}% chance
                        <span className="jp-chance-tip" role="tooltip">
                          <small>BET SIZE</small>
                          <b>{fmtSol(chances[r.signature].stake)} SOL</b>
                          {solUsd ? <em>≈ {usd(chances[r.signature].stake, solUsd)}</em> : null}
                        </span>
                      </span>
                    )}
                    <span className="jp-recent-meta">
                      {' '}
                      · {r.players} players
                    </span>
                  </span>
                  <span className="recent-time">{timeAgo(r.blockTime)}</span>
                  <button className="replay-btn" title="Replay this jackpot" aria-label="Replay this jackpot" onClick={() => setReplaying(r)}>
                    Replay <span aria-hidden="true">▶</span>
                  </button>
                </div>
              ))
          )}
        </div>
      </section>
      {replaying && <JackpotReplay result={replaying} me={me} nameOf={nameOf} onClose={() => setReplaying(null)} />}
    </div>
  );
}
