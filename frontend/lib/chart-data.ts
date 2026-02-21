import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";

const SEED = 25968;
function seeded(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/**
 * Generate mock OHLCV data for the candlestick chart.
 * Returns candles and volume for the last N periods (e.g. 60 for 1H of 1M bars).
 */
export function generateCandleData(
  basePrice: number,
  count: number,
  intervalMinutes: number = 1
): { candles: CandlestickData<UTCTimestamp>[]; volume: HistogramData<UTCTimestamp>[] } {
  const rand = seeded(SEED);
  const now = Math.floor(Date.now() / 1000);
  const intervalSec = intervalMinutes * 60;
  const candles: CandlestickData<UTCTimestamp>[] = [];
  const volume: HistogramData<UTCTimestamp>[] = [];

  let open = basePrice;
  for (let i = 0; i < count; i++) {
    const time = (now - (count - i) * intervalSec) as UTCTimestamp;
    const change = (rand() - 0.48) * 0.006;
    const high = open * (1 + Math.abs(change) + rand() * 0.002);
    const low = open * (1 - Math.abs(change) - rand() * 0.002);
    const close = open * (1 + change);
    const vol = rand() * 100 + 10;
    candles.push({ time, open, high, low, close });
    volume.push({
      time,
      value: vol,
      color: close >= open ? "rgba(38, 166, 154, 0.5)" : "rgba(239, 83, 80, 0.5)",
    });
    open = close;
  }

  return { candles, volume };
}

/**
 * Compute OHLCV summary for the data bar (Open, High, Low, Close, Volume %, Amplitude %).
 */
export function getOhlcvSummary(
  candles: CandlestickData<UTCTimestamp>[]
): { open: number; high: number; low: number; close: number; volumePct: number; amplitudePct: number } {
  if (candles.length === 0) {
    return { open: 0, high: 0, low: 0, close: 0, volumePct: 0, amplitudePct: 0 };
  }
  const first = candles[0];
  const last = candles[candles.length - 1];
  let high = first.high;
  let low = first.low;
  for (const c of candles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  const open = first.open;
  const close = last.close;
  const range = high - low;
  const amplitudePct = range > 0 ? (range / low) * 100 : 0;
  return {
    open,
    high,
    low,
    close,
    volumePct: 0.02,
    amplitudePct,
  };
}

export type DepthLevel = { price: number; size: number };

/**
 * Generate mock order book depth (bids and asks).
 */
export function generateDepthData(
  midPrice: number,
  levels: number = 12,
  spreadPct: number = 0.05
): { bids: DepthLevel[]; asks: DepthLevel[] } {
  const rand = seeded(SEED + 1);
  const halfSpread = (midPrice * spreadPct) / 100 / 2;
  const bids: DepthLevel[] = [];
  const asks: DepthLevel[] = [];
  for (let i = 0; i < levels; i++) {
    const bidPrice = midPrice - halfSpread - i * (midPrice * 0.0005);
    const askPrice = midPrice + halfSpread + i * (midPrice * 0.0005);
    bids.push({ price: bidPrice, size: rand() * 2500 + 50 });
    asks.push({ price: askPrice, size: rand() * 1600 + 0.1 });
  }
  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);
  return { bids, asks };
}
