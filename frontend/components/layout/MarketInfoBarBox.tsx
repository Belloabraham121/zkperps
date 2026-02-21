"use client";

import { useMarketStats } from "@/hooks/useMarketStats";

/** Placeholder stats (CoinGecko does not provide Open Interest / Funding / Skew; use a perp data source when available). */
const PLACEHOLDER_OPEN_INTEREST = "$12.5M/$15.4M";
const PLACEHOLDER_FUNDING_RATE = "0.005%";
const PLACEHOLDER_SKEW_LONG = "50.32%";
const PLACEHOLDER_SKEW_SHORT = "49.68%";

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

function formatChange(change24h: number, changePercent24h: number): string {
  const sign = change24h >= 0 ? "+" : "-";
  const abs = Math.abs(change24h);
  const pct = changePercent24h;
  return `${sign}${formatPrice(abs)} ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/**
 * Market information bar: trading pair, price (CoinGecko), 24h change, Open Interest, Funding Rate, Skew.
 */
export function MarketInfoBarBox() {
  const { data, isLoading, error } = useMarketStats("ethereum");

  const priceStr = data ? formatPrice(data.price) : "$—";
  const changeStr =
    data != null
      ? formatChange(data.change24h, data.changePercent24h)
      : "—";
  const isPositive = data != null && data.changePercent24h >= 0;
  const changeColor = data == null ? "text-[#7d8590]" : isPositive ? "text-[#4a9b6e]" : "text-[#b54a4a]";

  return (
    <div className="flex h-12 shrink-0 items-center gap-4 border-b border-[#363d4a] bg-[#21262e] px-4">
      {/* Trading pair + current price (CoinGecko) */}
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-[#3d4a5c]">
          <span className="text-xs font-semibold text-[#8b9dc3]" aria-hidden>Ξ</span>
        </div>
        <span className="font-medium text-[#c8cdd4]">ETHUSD</span>
        {isLoading ? (
          <span className="font-medium text-[#7d8590]">Loading…</span>
        ) : error ? (
          <span className="font-medium text-amber-400" title={error instanceof Error ? error.message : "Error"}>
            {priceStr}
          </span>
        ) : (
          <span className="font-medium text-[#4a9b6e]">{priceStr}</span>
        )}
        <button
          type="button"
          className="p-0.5 text-[#7d8590] hover:bg-[#363d4a] hover:text-[#c8cdd4]"
          aria-label="Market details"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
      </div>

      <div className="h-5 w-px shrink-0 bg-[#363d4a]" aria-hidden />

      {/* 24h Change (CoinGecko) */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-[#7d8590]">24h Change</span>
        <span className={`text-sm font-medium ${changeColor}`}>{changeStr}</span>
      </div>

      <div className="h-5 w-px shrink-0 bg-[#363d4a]" aria-hidden />

      {/* Open Interest (placeholder – not from CoinGecko) */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-[#7d8590]">Open Interest</span>
        <span className="text-sm font-medium text-[#c8cdd4]">{PLACEHOLDER_OPEN_INTEREST}</span>
      </div>

      <div className="h-5 w-px shrink-0 bg-[#363d4a]" aria-hidden />

      {/* Funding Rate (placeholder) */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-[#7d8590]">Funding Rate</span>
        <span className="text-sm font-medium text-[#c8a855]">{PLACEHOLDER_FUNDING_RATE}</span>
      </div>

      <div className="h-5 w-px shrink-0 bg-[#363d4a]" aria-hidden />

      {/* Skew (placeholder) */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-[#7d8590]">Skew</span>
        <span className="text-sm font-medium">
          <span className="text-[#4a9b6e]">{PLACEHOLDER_SKEW_LONG}</span>
          <span className="text-[#7d8590]">/</span>
          <span className="text-[#b54a4a]">{PLACEHOLDER_SKEW_SHORT}</span>
        </span>
      </div>
    </div>
  );
}
