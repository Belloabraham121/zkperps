"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import * as perpApi from "@/lib/api/perp";

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
