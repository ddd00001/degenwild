import { useEffect, useState } from 'react';
import { useSolPrice } from '../price';

const STALE_MS = 5 * 60_000;
const SITES = { CoinGecko: 'https://www.coingecko.com', Jupiter: 'https://jup.ag' } as const;

export function PriceSource() {
  const price = useSolPrice();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!price) return <div className="price-source">USD estimates unavailable: SOL/USD price feed offline.</div>;
  const link = (
    <a href={SITES[price.source]} target="_blank" rel="noreferrer">{price.source}</a>
  );
  const stale = now - price.at >= STALE_MS;
  return (
    <div className="price-source">
      {stale
        ? <>USD estimates use the last known SOL/USD price from {link} (feed delayed).</>
        : <>USD estimates use live SOL/USD pricing from {link}.</>}
    </div>
  );
}
