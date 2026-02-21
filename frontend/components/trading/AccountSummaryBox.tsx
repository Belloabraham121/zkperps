"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useCollateral, useBalances } from "@/hooks/useAccount";
import { amountFromBigInt } from "@/lib/utils/perp";
import * as perpApi from "@/lib/api/perp";

/**
 * Account summary aligned with PerpPositionManager:
 * - Total collateral = USDC you deposited (depositCollateral)
 * - Available margin = amount free to open new positions or withdraw
 * - Used margin = collateral locked in open positions
 * - Deposit = add USDC to your perp account (collateral)
 * - Withdraw = take USDC out, up to available margin
 */
export function AccountSummaryBox() {
  const [accountLabel] = useState("Trading Account");
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositPending, setDepositPending] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");

  const { token, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const { data: collateral, isLoading: collateralLoading } = useCollateral();
  const { data: balances, isLoading: balancesLoading } = useBalances();

  // PerpPositionManager stores/returns totalCollateral and availableMargin in 18 decimals (_to18)
  const totalCollateral = collateral
    ? amountFromBigInt(collateral.totalCollateral, 18)
    : 0;
  const availableMargin = collateral
    ? amountFromBigInt(collateral.availableMargin, 18)
    : 0;
  const usedMargin = totalCollateral - availableMargin;

  const isLoading = collateralLoading || balancesLoading;

  const handleDepositClick = () => {
    if (!isAuthenticated || !token) {
      toast.error("Please sign in to deposit");
      return;
    }
    setDepositModalOpen(true);
  };

  // Clear amount when modal opens
  useEffect(() => {
    if (depositModalOpen) setDepositAmount("");
  }, [depositModalOpen]);

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const raw = depositAmount.trim();
    const num = parseFloat(raw);
    if (raw === "" || Number.isNaN(num) || num <= 0) {
      toast.error("Enter a valid amount (e.g. 100 for 100 USDC)");
      return;
    }
    setDepositPending(true);
    try {
      const result = await perpApi.depositCollateral(num, token);
      setDepositModalOpen(false);
      setDepositAmount("");
      queryClient.invalidateQueries({ queryKey: ["collateral"] });
      queryClient.invalidateQueries({ queryKey: ["balances"] });
      toast.success("Deposit successful", {
        description: `Approved and deposited ${num} USDC. Tx: ${result.depositHash.slice(0, 10)}...`,
      });
    } catch (error) {
      toast.error("Deposit failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setDepositPending(false);
    }
  };

  const handleWithdraw = () => {
    // TODO: open withdraw modal – withdrawCollateral(amount) up to available margin
    toast.info("Withdraw flow coming soon");
  };

  const formatUsd = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <aside className="flex w-80 shrink-0 flex-col bg-[#111111] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-white/50">{accountLabel}</span>
        <button
          type="button"
          onClick={handleDepositClick}
          className="bg-[#1a1a1a] px-2 py-1 text-xs font-medium text-white hover:bg-[#262626]"
        >
          Deposit collateral
        </button>
      </div>

      {/* Deposit modal */}
      {depositModalOpen && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => !depositPending && setDepositModalOpen(false)}
          >
            <div
              className="relative z-[101] w-full max-w-sm rounded-lg border border-[#262626] bg-[#111111] p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-white">
                  Deposit USDC
                </h3>
                <button
                  type="button"
                  onClick={() => setDepositModalOpen(false)}
                  className="text-white/50 hover:text-white text-lg leading-none"
                  disabled={depositPending}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <p className="mb-3 text-xs text-white/50">
                Amount to add to your perp account (collateral). You must have at least this much USDC in your wallet.
              </p>
              <form onSubmit={handleDepositSubmit} className="flex flex-col gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full border border-[#262626] bg-[#1a1a1a] px-3 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/30"
                  disabled={depositPending}
                  aria-label="Deposit amount in USDC"
                />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDepositModalOpen(false)}
                  className="flex-1 py-2 text-sm font-medium text-white/50 hover:bg-[#262626]"
                  disabled={depositPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={depositPending}
                  className="flex-1 bg-[#333333] py-2 text-sm font-medium text-white hover:bg-[#4a5a6d] disabled:opacity-50"
                >
                  {depositPending ? "Depositing..." : "Deposit"}
                </button>
              </div>
            </form>
            </div>
          </div>,
          document.body
        )}

      <div className="flex flex-col gap-2 text-xs">
        <div className="flex justify-between">
          <span className="text-white/50">Available balance</span>
          <span className="text-white">
            {isLoading ? "..." : formatUsd(availableMargin)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">Used margin</span>
          <span className="text-white">
            {isLoading ? "..." : formatUsd(usedMargin)}
          </span>
        </div>
      </div>

      <div className="mt-3 border-t border-[#262626] pt-3">
        <div className="mb-2 text-xs font-medium text-white/50">
          Collateral
        </div>
        <p className="mb-2 text-[10px] text-white/50">
          USDC deposited to trade. Available = free to use or withdraw; used = locked in positions.
        </p>
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-white/50">Total deposited</span>
            <span className="text-white">
              {isLoading ? "..." : formatUsd(totalCollateral)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Available</span>
            <span className="text-white">
              {isLoading ? "..." : formatUsd(availableMargin)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">Used in positions</span>
            <span className="text-white">
              {isLoading ? "..." : formatUsd(usedMargin)}
            </span>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleDepositClick}
            className="flex-1 bg-[#333333] py-1.5 text-xs font-medium text-white hover:bg-[#4a5a6d]"
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={handleWithdraw}
            className="flex-1 bg-[#1a1a1a] py-1.5 text-xs font-medium text-white hover:bg-[#262626]"
          >
            Withdraw
          </button>
        </div>
      </div>
    </aside>
  );
}
