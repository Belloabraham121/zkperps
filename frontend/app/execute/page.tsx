"use client";

import Link from "next/link";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { usePendingBatch, useExecuteBatchNow } from "@/hooks/useTrading";

const EXPLORER_TX_URL = "https://sepolia.arbiscan.io/tx";

export default function ExecutePage() {
  return (
    <AuthGuard>
      <ExecuteContent />
    </AuthGuard>
  );
}

function ExecuteContent() {
  const { data: pending, isLoading: pendingLoading } = usePendingBatch();
  const executeBatch = useExecuteBatchNow();

  const canExecute = pending?.canExecute ?? false;
  const count = pending?.count ?? 0;
  const nextAt = pending?.nextExecutionAt ?? null;
  const minCommitments = pending?.minCommitments ?? 2;

  return (
    <div className="min-h-screen bg-[#161b22] text-[#c8cdd4] font-sans">
      <header className="border-b border-[#363d4a] px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link
            href="/trade"
            className="text-sm text-[#7d8590] hover:text-[#c8cdd4]"
          >
            ← Back to Trade
          </Link>
          <h1 className="text-lg font-semibold text-white">Execute Batch</h1>
          <span className="w-20" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-lg border border-[#363d4a] bg-[#21262e] p-6">
          <p className="mb-6 text-sm text-[#7d8590]">
            Run the batch execution to settle all pending perp reveals on-chain.
            You need at least {minCommitments} pending commitments, and the batch
            interval (e.g. 5 minutes) must have passed since the last execution.
          </p>

          {pendingLoading ? (
            <p className="text-sm text-[#7d8590]">Loading pending batch…</p>
          ) : (
            <>
              <div className="mb-6 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#7d8590]">Pending commitments</span>
                  <span className="font-medium text-[#c8cdd4]">{count}</span>
                </div>
                {nextAt && !canExecute && (
                  <div className="flex justify-between">
                    <span className="text-[#7d8590]">Next execution at</span>
                    <span className="text-[#c8cdd4]">
                      {new Date(nextAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {canExecute && (
                  <div className="text-[#4a9b6e]">
                    Ready to execute
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => executeBatch.mutate()}
                disabled={!canExecute || executeBatch.isPending}
                className="w-full rounded-lg bg-[#4a9b6e] px-4 py-3 font-medium text-white transition-colors hover:bg-[#3d8a5f] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#4a9b6e]"
              >
                {executeBatch.isPending
                  ? "Executing…"
                  : canExecute
                    ? "Execute batch"
                    : count < minCommitments
                      ? `Add ${minCommitments - count} more commitment(s)`
                      : "Wait for next execution time"}
              </button>
            </>
          )}

          {executeBatch.isError && (
            <div className="mt-4 rounded border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-200 whitespace-pre-line">
              {executeBatch.error instanceof Error
                ? executeBatch.error.message
                : "Execution failed"}
            </div>
          )}

          {executeBatch.isSuccess && executeBatch.data && (
            <div className="mt-4 rounded border border-[#363d4a] bg-[#2a303c] p-3 text-sm">
              <p className="mb-2 font-medium text-[#4a9b6e]">
                Batch executed successfully
              </p>
              <p className="mb-1 text-[#7d8590]">
                {executeBatch.data.batchSize} commitment(s) settled
              </p>
              <a
                href={`${EXPLORER_TX_URL}/${executeBatch.data.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#5b6b7a] hover:text-[#c8cdd4] break-all"
              >
                {executeBatch.data.hash}
              </a>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
