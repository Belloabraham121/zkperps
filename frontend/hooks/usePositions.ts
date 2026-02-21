"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import * as perpApi from "@/lib/api/perp";
import type { OrderStatus } from "@/lib/api/perp";

/**
 * Hook to fetch user's position for a market
 */
export function usePosition(marketId?: string) {
  const { token, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["position", marketId],
    queryFn: () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.getPosition(marketId, token);
    },
    enabled: isAuthenticated && !!token,
    refetchInterval: 10000, // Refetch every 10 seconds
  });
}

/**
 * Hook to fetch user's orders (open orders or full order history).
 * @param status "pending" for open orders, "executed" | "cancelled" | "all" for history
 */
export function useOrders(status: OrderStatus | "all" = "pending") {
  const { token, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["perp-orders", status],
    queryFn: () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.getOrders(token, status);
    },
    enabled: isAuthenticated && !!token,
    refetchInterval: 15000,
  });
}

/**
 * Hook to fetch user's trade history (executed trades).
 */
export function useTradeHistory(limit: number = 50) {
  const { token, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["perp-trade-history", limit],
    queryFn: () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.getTradeHistory(token, limit);
    },
    enabled: isAuthenticated && !!token,
  });
}

/**
 * Hook to fetch position history (trades that opened/closed positions).
 */
export function usePositionHistory(options?: { marketId?: string; limit?: number }) {
  const { token, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["perp-position-history", options?.marketId, options?.limit],
    queryFn: () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.getPositionHistory(token, options);
    },
    enabled: isAuthenticated && !!token,
  });
}

/**
 * Hook to close a position (submit close intent)
 */
export function useClosePosition() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intent,
      poolKey,
    }: {
      intent: perpApi.PerpIntent;
      poolKey?: perpApi.PoolKey;
    }) => {
      if (!token) throw new Error("Not authenticated");
      
      // Compute commitment hash
      const { commitmentHash } = await perpApi.computeCommitmentHash(
        intent,
        token
      );

      // Submit commitment
      await perpApi.submitCommitment(commitmentHash, poolKey, token);

      // Submit reveal
      return perpApi.submitReveal(intent, poolKey, token);
    },
    onSuccess: () => {
      // Invalidate position queries to refetch
      queryClient.invalidateQueries({ queryKey: ["position"] });
    },
  });
}
