import { useEffect, useState } from 'react';

/** pump.fun page of the $WILD coin. Fill in once the coin exists; the banner then shows a Buy button. */
export const WILD_PUMP_URL = '';

/** Planned switch of the arena to mainnet: 20:20 Bern time (CET, UTC+1) on 15 Nov 2026. */
export const MAINNET_SWITCH_AT = Date.parse('2026-11-15T19:20:00Z');

const LOGO = `${import.meta.env.BASE_URL}pumpfun-logo.svg`;

function parts(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    { v: pad(Math.floor(t / 3600)), l: 'HRS' },
    { v: pad(Math.floor((t % 3600) / 60)), l: 'MIN' },
    { v: pad(t % 60), l: 'SEC' },
  ];
}

export function LaunchBanner() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const due = now >= MAINNET_SWITCH_AT;

  return (
    <div className="launch-banner" role="status">
      <div className="launch-main">
        <span className="launch-live-tag"><i /> LIVE</span>
        <b>$WILD Token launch live on pump.fun</b>
        <img className="launch-logo" src={LOGO} alt="pump.fun" width={22} height={22} />
        {WILD_PUMP_URL && (
          <a className="launch-cta" href={WILD_PUMP_URL} target="_blank" rel="noreferrer">
            Buy on pump.fun ↗
          </a>
        )}
      </div>
      <span className="launch-note">
        <span className="launch-devnet">ARENA: DEVNET</span>
        {due ? (
          <span>Switching to mainnet…</span>
        ) : (
          <>
            <span>Switch to mainnet in</span>
            <span className="launch-timer" aria-label="Time until the switch to mainnet">
              {parts(MAINNET_SWITCH_AT - now).map((p, i) => (
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
      </span>
    </div>
  );
}
