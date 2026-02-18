"use client";

import { useState } from "react";

/**
 * Account summary / collateral overview per PERPS_IMPLEMENTATION_PLAN:
 * Total collateral deposited, Available margin, Used margin, Deposit/Withdraw buttons.
 */
export function AccountSummaryBox() {
  const [accountLabel] = useState("Trading Account");

  // TODO: replace with useCollateral() or API when Web3 is wired
  const equity = 18234.34;
  const availableBalance = 18234.34;
  const usedMargin = 0;
  const maintenanceMargin = 0;
  const totalCollateral = equity;
  const crossLeverage = "10x";
  const totalLeverage = "14x";

  const handleDeposit = () => {
    // TODO: open deposit modal / navigate to deposit flow
    console.log("Deposit");
  };

  const handleWithdraw = () => {
    // TODO: open withdraw modal
    console.log("Withdraw");
  };

  const formatUsd = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <aside className="flex w-80 shrink-0 flex-col bg-neutral-900/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-400">{accountLabel}</span>
        <button
          type="button"
          onClick={handleDeposit}
          className="rounded border border-neutral-600 bg-neutral-800/80 px-2 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
        >
          Deposit
        </button>
      </div>

      <div className="flex flex-col gap-2 text-xs">
        <div className="flex justify-between">
          <span className="text-neutral-500">Equity</span>
          <span className="text-neutral-200">{formatUsd(equity)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Available Balance</span>
          <span className="text-neutral-200">{formatUsd(availableBalance)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Margin Health</span>
          <span className="text-neutral-200">{formatUsd(usedMargin)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Maintenance Margin</span>
          <span className="text-neutral-200">{formatUsd(maintenanceMargin)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Cross Account Leverage</span>
          <span className="text-neutral-200">{crossLeverage}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Total Account Leverage</span>
          <span className="text-neutral-200">{totalLeverage}</span>
        </div>
      </div>

      {/* Plan: Total collateral, Available margin, Used margin */}
      <div className="mt-3 border-t border-neutral-700 pt-3">
        <div className="mb-2 text-xs font-medium text-neutral-400">Collateral Overview</div>
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-neutral-500">Total collateral deposited</span>
            <span className="text-neutral-200">{formatUsd(totalCollateral)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Available margin</span>
            <span className="text-neutral-200">{formatUsd(availableBalance)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">Used margin</span>
            <span className="text-neutral-200">{formatUsd(usedMargin)}</span>
          </div>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleDeposit}
            className="flex-1 rounded bg-sky-600 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          >
            Deposit
          </button>
          <button
            type="button"
            onClick={handleWithdraw}
            className="flex-1 rounded border border-neutral-600 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
          >
            Withdraw
          </button>
        </div>
      </div>
    </aside>
  );
}
