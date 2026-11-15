import { useEffect, useState } from 'react';

/** $WILD launch time: 20:00 Bern time (CET, UTC+1) on 15 Nov 2026. Before it, the banner says "today at 20:00". */
export const WILD_LAUNCH_AT = Date.parse('2026-11-15T19:00:00Z');
/** pump.fun page of the $WILD coin. Fill in once the coin exists; the banner then shows a Buy button. */
export const WILD_PUMP_URL = '';

const LOGO = `${import.meta.env.BASE_URL}pumpfun-logo.svg`;

export function LaunchBanner() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const live = now >= WILD_LAUNCH_AT || !!WILD_PUMP_URL;

  return (
    <div className={`launch-banner ${live ? 'is-live' : ''}`} role="status">
      <div className="launch-main">
        {live && <span className="launch-live-tag"><i /> LIVE</span>}
        <b>{live ? '$WILD token launch is live on pump.fun!' : '$WILD launches on pump.fun today at 20:00 (Bern time)'}</b>
        <img className="launch-logo" src={LOGO} alt="pump.fun" width={22} height={22} />
        {WILD_PUMP_URL && (
          <a className="launch-cta" href={WILD_PUMP_URL} target="_blank" rel="noreferrer">
            Buy on pump.fun ↗
          </a>
        )}
      </div>
      <span className="launch-note">
        <span className="launch-devnet">ARENA: DEVNET</span> Free play money. Mainnet comes after a security review.
      </span>
    </div>
  );
}
