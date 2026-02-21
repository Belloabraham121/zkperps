import type { OHLCPoint, VolumePoint } from "./chart-data";

/** Demo API (and free) use this base. */
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/** CoinGecko OHLC item: [timestamp_ms, open, high, low, close] */
type CoinGeckoOhlcItem = [number, number, number, number, number];

function getHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_COINGECKO_API_KEY;
  const headers: HeadersInit = { Accept: "application/json" };
  if (key) {
    (headers as Record<string, string>)["x-cg-demo-api-key"] = key;
  }
  return headers;
}

/**
 * Fetch ETH/USD OHLC from CoinGecko.
 */
export async function fetchEthUsdOhlc(days: number): Promise<CoinGeckoOhlcItem[]> {
  const url = `${COINGECKO_BASE}/coins/ethereum/ohlc?vs_currency=usd&days=${days}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CoinGecko OHLC failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as CoinGeckoOhlcItem[];
  return data;
}

/**
 * Convert CoinGecko OHLC to generic points (no volume in API).
 */
export function coingeckoOhlcToChart(raw: CoinGeckoOhlcItem[]): { points: OHLCPoint[]; volume: VolumePoint[] } {
  const points: OHLCPoint[] = [];
  const volume: VolumePoint[] = [];
  for (const [tsMs, open, high, low, close] of raw) {
    const time = Math.floor(tsMs / 1000);
    points.push({ time, open, high, low, close });
    volume.push({ time, value: 0 });
  }
  return { points, volume };
}

/** Map UI timeframe to CoinGecko days. */
export const TIMEFRAME_TO_DAYS: Record<string, number> = {
  "1M": 1,
  "15M": 1,
  "1H": 1,
  "1D": 7,
  "1W": 30,
};

export function hasCoingeckoApiKey(): boolean {
  return Boolean(
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_COINGECKO_API_KEY
  );
}
