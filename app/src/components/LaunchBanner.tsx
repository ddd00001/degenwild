import { useEffect, useState } from 'react';

/** $WILD launch time: 20:00 Bern time (CET, UTC+1) on 15 Nov 2026. */
export const WILD_LAUNCH_AT = Date.parse('2026-11-15T19:00:00Z');
/** pump.fun page of the $WILD coin. Fill in once the coin exists; the banner links to it. */
export const WILD_PUMP_URL = '';

function left(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h > 0 ? `${h}:` : ''}${pad(m)}:${pad(s % 60)}`;
}

export function LaunchBanner() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const live = now >= WILD_LAUNCH_AT;

  return (
    <div className="launch-banner" role="status">
      <span className="launch-dot" aria-hidden="true" />
      <span className="launch-main">
        {live ? (
          <>
            <b>$WILD token launch is live on pump.fun!</b>
            {WILD_PUMP_URL && (
              <a href={WILD_PUMP_URL} target="_blank" rel="noreferrer">
                View on pump.fun ↗
              </a>
            )}
          </>
        ) : (
          <>
            <b>$WILD launches on pump.fun in</b>
            <span className="launch-timer">{left(WILD_LAUNCH_AT - now)}</span>
          </>
        )}
      </span>
      <span className="launch-note">The arena runs on devnet with free play money.</span>
    </div>
  );
}
