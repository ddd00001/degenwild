import { type Address } from '@solana/kit';
import { useEffect, useState } from 'react';
import { WILD_MINT } from '../config';
import { short, type Names } from '../format';

type Holder = { rank: number; owner: string; amount: string; percent: number };
type HoldersResponse = { decimals: number; supply: string; holderCount: number; updatedAt: number; holders: Holder[] };

const REFRESH_MS = 60_000;

function fmtTokens(raw: string, decimals: number): string {
  const v = Number(BigInt(raw) / 10n ** BigInt(Math.max(0, decimals - 2))) / 100;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function LeaderboardPage({ names, me }: { names: Names; me?: Address }) {
  const [data, setData] = useState<HoldersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!WILD_MINT) return;
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/holders?mint=${WILD_MINT}`);
        const body = await res.json();
        if (stop) return;
        if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
        setData(body);
        setError(null);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : 'Could not load holders.');
      }
    };
    void load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="lb-page">
      <header className="lb-hero panel">
        <div className="eyebrow">
          <span className="red-line" /> $WILD
        </div>
        <h1>
          $WILD <span>Leaderboard</span>
        </h1>
        <p className="lb-intro">
          The top 100 $WILD holders, live from Solana. $WILD is getting playable features in the arena, and holders will be
          able to earn rewards. Climb the board.
        </p>
        <div className="lb-stats">
          <div>
            <small>HOLDERS</small>
            <b>{data ? data.holderCount.toLocaleString() : '—'}</b>
          </div>
          <div>
            <small>SHOWING</small>
            <b>TOP 100</b>
          </div>
          <div>
            <small>UPDATED</small>
            <b>{data ? new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</b>
          </div>
        </div>
      </header>

      <section className="lb-table panel">
        <div className="lb-row lb-head">
          <span>#</span>
          <span>HOLDER</span>
          <span className="lb-num">$WILD</span>
          <span className="lb-num">SUPPLY</span>
        </div>

        {!WILD_MINT ? (
          <div className="lb-empty">
            <b>The leaderboard goes live with $WILD.</b>
            <span>As soon as the coin is out, the biggest holders show up here, updated every minute.</span>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="lb-row lb-skeleton" aria-hidden="true">
                <span>{i + 1}</span>
                <span><i style={{ width: `${46 - i * 3}%` }} /></span>
                <span className="lb-num"><i /></span>
                <span className="lb-num"><i /></span>
              </div>
            ))}
          </div>
        ) : error && !data ? (
          <div className="lb-empty"><b>{error}</b><span>Retrying in a minute.</span></div>
        ) : !data ? (
          <div className="lb-empty"><span>Loading holders…</span></div>
        ) : (
          data.holders.map((h) => {
            const name = names.get(h.owner as Address);
            const mine = h.owner === me;
            return (
              <div key={h.owner} className={`lb-row ${h.rank <= 3 ? `lb-top lb-top${h.rank}` : ''} ${mine ? 'lb-me' : ''}`}>
                <span className="lb-rank">{h.rank}</span>
                <span className="lb-holder">
                  <a href={`https://solscan.io/account/${h.owner}`} target="_blank" rel="noreferrer" title={h.owner}>
                    {mine ? 'You' : (name ?? short(h.owner))}
                  </a>
                  {name && !mine && <small>{short(h.owner)}</small>}
                </span>
                <span className="lb-num">{fmtTokens(h.amount, data.decimals)}</span>
                <span className="lb-num lb-pct">
                  <i style={{ width: `${Math.min(100, h.percent * 4)}%` }} />
                  {h.percent.toFixed(2)}%
                </span>
              </div>
            );
          })
        )}
      </section>
      <p className="lb-foot">Includes the pump.fun bonding curve and liquidity pool accounts. Not financial advice.</p>
    </div>
  );
}
