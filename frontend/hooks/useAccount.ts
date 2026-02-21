"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import * as perpApi from "@/lib/api/perp";

/**
 * Hook to fetch user's collateral info (total collateral, available margin)
 */
export function useCollateral() {
  const { token, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["collateral"],
    queryFn: () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.getCollateral(token);
    },
    enabled: isAuthenticated && !!token,
    refetchInterval: 10000, // Refetch every 10 seconds
  });
}

/**
 * Hook to fetch user's token balances (USDC, USDT)
 */
export function useBalances() {
  const { token, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["balances"],
    queryFn: () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.getBalances(token);
    },
    enabled: isAuthenticated && !!token,
    refetchInterval: 10000, // Refetch every 10 seconds
  });
}
