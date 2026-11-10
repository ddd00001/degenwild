import { useSyncExternalStore } from 'react';

export type Price = { usd: number; source: 'CoinGecko' | 'Jupiter'; at: number };

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const REFRESH_MS = 60_000;

let current: Price | null = null;
let timer: number | undefined;
const listeners = new Set<() => void>();

async function fetchSolUsd(): Promise<Price | null> {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const usd = Number((await r.json())?.solana?.usd);
    if (r.ok && usd > 0) return { usd, source: 'CoinGecko', at: Date.now() };
  } catch {
    /* fall through to Jupiter */
  }
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`);
    const usd = Number((await r.json())?.[SOL_MINT]?.usdPrice);
    if (r.ok && usd > 0) return { usd, source: 'Jupiter', at: Date.now() };
  } catch {
    /* keep the last known price */
  }
  return null;
}

async function refresh() {
  const p = await fetchSolUsd();
  if (p) {
    current = p;
    listeners.forEach((l) => l());
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) {
    void refresh();
    timer = window.setInterval(() => void refresh(), REFRESH_MS);
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) window.clearInterval(timer);
  };
}

/** Live SOL/USD price shared by the whole page (one request a minute). Null until the first answer. */
export function useSolPrice(): Price | null {
  return useSyncExternalStore(subscribe, () => current);
}

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const usdSmall = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
export const fmtUsd = (v: number) => (v > 0 && v < 0.01 ? usdSmall : usdFmt).format(v);
