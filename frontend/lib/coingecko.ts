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

/** CoinGecko coin id for simple/price (e.g. "bitcoin", "ethereum"). */
export type CoinGeckoId = "bitcoin" | "ethereum";

/** Response shape for /simple/price with include_24hr_change=true. */
export type SimplePriceResponse = Record<
  CoinGeckoId,
  { usd: number; usd_24h_change: number | null }
>;

/**
 * Fetch current price and 24h change from CoinGecko simple/price.
 * Used for the market info bar (BTCUSD, 24h change).
 */
export async function fetchSimplePrice(
  coinId: CoinGeckoId,
  vsCurrency = "usd"
): Promise<{ price: number; change24h: number; changePercent24h: number }> {
  const url = `${COINGECKO_BASE}/simple/price?ids=${coinId}&vs_currencies=${vsCurrency}&include_24hr_change=true`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CoinGecko simple price failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as SimplePriceResponse;
  const row = data[coinId];
  if (!row || typeof row.usd !== "number") {
    throw new Error("CoinGecko: missing price data");
  }
  const price = row.usd;
  const changePercent24h = row.usd_24h_change ?? 0;
  const change24h = price * (changePercent24h / 100);
  return { price, change24h, changePercent24h };
}
