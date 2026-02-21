"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import * as perpApi from "@/lib/api/perp";

/**
 * Hook to open a new perp position
 * Handles the complete flow: compute hash → commit → reveal
 */
export function useOpenPosition() {
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

      // Step 1: Compute commitment hash
      const { commitmentHash } = await perpApi.computeCommitmentHash(
        intent,
        token
      );

      // Step 2: Submit commitment
      const commitResult = await perpApi.submitCommitment(
        commitmentHash,
        poolKey,
        token
      );

      // Step 3: Submit reveal
      const revealResult = await perpApi.submitReveal(intent, poolKey, token);

      return {
        commitmentHash,
        commitTxHash: commitResult.hash,
        revealTxHash: revealResult.hash,
      };
    },
    onSuccess: () => {
      // Invalidate queries to refetch updated data
      queryClient.invalidateQueries({ queryKey: ["position"] });
      queryClient.invalidateQueries({ queryKey: ["collateral"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      queryClient.invalidateQueries({ queryKey: ["perp-orders"] });
    },
  });
}

/**
 * Hook to execute a batch of perp reveals (with explicit commitment hashes).
 */
export function useExecuteBatch() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      commitmentHashes,
      poolKey,
      baseIsCurrency0,
    }: {
      commitmentHashes: string[];
      poolKey?: perpApi.PoolKey;
      baseIsCurrency0?: boolean;
    }) => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.executeBatch(
        commitmentHashes,
        poolKey,
        baseIsCurrency0,
        token
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["position"] });
      queryClient.invalidateQueries({ queryKey: ["collateral"] });
      queryClient.invalidateQueries({ queryKey: ["batch-state"] });
      queryClient.invalidateQueries({ queryKey: ["perp-orders"] });
      queryClient.invalidateQueries({ queryKey: ["perp-trade-history"] });
      queryClient.invalidateQueries({ queryKey: ["perp-position-history"] });
    },
  });
}

/**
 * Hook to execute the current pending batch (one-click, no body).
 * Uses pending reveals from DB. Fails if fewer than 2 pending or batch interval not met.
 */
export function useExecuteBatchNow() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.executeBatchNow(token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["position"] });
      queryClient.invalidateQueries({ queryKey: ["collateral"] });
      queryClient.invalidateQueries({ queryKey: ["batch-state"] });
      queryClient.invalidateQueries({ queryKey: ["pending-batch"] });
      queryClient.invalidateQueries({ queryKey: ["perp-orders"] });
      queryClient.invalidateQueries({ queryKey: ["perp-trade-history"] });
      queryClient.invalidateQueries({ queryKey: ["perp-position-history"] });
    },
  });
}

/**
 * Hook to get batch state
 */
export function useBatchState(poolId: string) {
  const { token, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["batch-state", poolId],
    queryFn: () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.getBatchState(poolId, token);
    },
    enabled: isAuthenticated && !!token && !!poolId,
    refetchInterval: 5000, // Refetch every 5 seconds
  });
}

/**
 * Hook to get batch interval
 */
export function useBatchInterval() {
  const { token, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["batch-interval"],
    queryFn: () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.getBatchInterval(token);
    },
    enabled: isAuthenticated && !!token,
  });
}

/**
 * Hook to get pending batch (for execute page).
 */
export function usePendingBatch() {
  const { token, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["pending-batch"],
    queryFn: () => {
      if (!token) throw new Error("Not authenticated");
      return perpApi.getPendingBatch(token);
    },
    enabled: isAuthenticated && !!token,
    refetchInterval: 5000,
  });
}
