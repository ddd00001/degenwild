import { useEffect, useState } from 'react';

/** $WILD launch time: 20:00 Bern time (CET, UTC+1) on 15 Nov 2026. */
export const WILD_LAUNCH_AT = Date.parse('2026-11-15T19:00:00Z');
/** pump.fun page of the $WILD coin. Fill in once the coin exists; the banner links to it. */
export const WILD_PUMP_URL = '';

const LOGO = `${import.meta.env.BASE_URL}pumpfun-logo.svg`;

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    { v: pad(Math.floor(s / 3600)), l: 'HRS' },
    { v: pad(Math.floor((s % 3600) / 60)), l: 'MIN' },
    { v: pad(s % 60), l: 'SEC' },
  ];
}

export function LaunchBanner() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const live = now >= WILD_LAUNCH_AT;
  const pump = <img className="launch-logo" src={LOGO} alt="pump.fun" width={22} height={22} />;

  return (
    <div className={`launch-banner ${live ? 'is-live' : ''}`} role="status">
      <div className="launch-main">
        {live ? (
          <>
            <span className="launch-live-tag"><i /> LIVE</span>
            <b>$WILD token launch is live on pump.fun!</b>
            {pump}
            {WILD_PUMP_URL && (
              <a className="launch-cta" href={WILD_PUMP_URL} target="_blank" rel="noreferrer">
                Buy on pump.fun ↗
              </a>
            )}
          </>
        ) : (
          <>
            <b>$WILD launches on pump.fun</b>
            {pump}
            <span className="launch-timer" aria-label="Time until launch">
              {parts(WILD_LAUNCH_AT - now).map((p, i) => (
                <span key={p.l} className="launch-unit-wrap">
                  {i > 0 && <span className="launch-colon">:</span>}
                  <span className="launch-unit">
                    <span className="launch-digits">{p.v}</span>
                    <small>{p.l}</small>
                  </span>
                </span>
              ))}
            </span>
          </>
        )}
      </div>
      <span className="launch-note">The arena runs on devnet with free play money.</span>
    </div>
  );
}
