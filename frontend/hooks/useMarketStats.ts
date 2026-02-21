"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchSimplePrice, type CoinGeckoId } from "@/lib/coingecko";

/**
 * Hook to fetch market stats from CoinGecko for the market info bar.
 * Returns current price and 24h change; refetches every 60s to respect rate limits.
 */
export function useMarketStats(coinId: CoinGeckoId = "ethereum") {
  return useQuery({
    queryKey: ["market-stats", coinId],
    queryFn: () => fetchSimplePrice(coinId),
    refetchInterval: 60_000, // 1 minute
    staleTime: 30_000, // Consider fresh for 30s
  });
}
