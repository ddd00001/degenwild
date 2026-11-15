/** pump.fun page of the $WILD coin. Fill in once the coin exists; the banner then shows a Buy button. */
export const WILD_PUMP_URL = '';

const LOGO = `${import.meta.env.BASE_URL}pumpfun-logo.svg`;

export function LaunchBanner() {
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
        <span className="launch-devnet">ARENA: DEVNET</span> Free play money. Mainnet comes after a security review.
      </span>
    </div>
  );
}
