"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useOpenPosition } from "@/hooks/useTrading";
import { useMarketStats } from "@/hooks/useMarketStats";
import { createPerpIntent, estimateLiquidationPriceUSD } from "@/lib/utils/perp";
import { DEFAULT_MARKET_ID, DEFAULT_POOL_KEY } from "@/lib/config";
import * as perpApi from "@/lib/api/perp";

type Side = "long" | "short";

const LEVERAGE_MIN = 1;
const LEVERAGE_MAX = 10;

/**
 * Order panel aligned with the smart contract:
 * - PerpPositionManager: openPosition(user, market, size, isLong, leverage) with collateral = (size × entryPrice) / leverage
 * - No limit/conditional orders: execution is batch-based at batch execution price
 * - Single collateral pool: deposit collateral first, then open positions; margin = collateral locked per position
 */
export function OrderPanelBox() {
  const { user, token, isAuthenticated } = useAuth();
  const openPosition = useOpenPosition();
  const { data: marketStats } = useMarketStats("ethereum");

  const [side, setSide] = useState<Side>("long");
  const [leverage, setLeverage] = useState(10);
  const [size, setSize] = useState("");
  const [margin, setMargin] = useState("");
  const [errors, setErrors] = useState<{ size?: string; margin?: string }>({});
  const [clearing, setClearing] = useState(false);

  const priceUSD = marketStats?.price ?? 0;
  const sizeNum = parseFloat(size) || 0;
  const marginNum = parseFloat(margin) || 0;

  const { valueUSD, estLiqPriceUSD } = useMemo(() => {
    const value = priceUSD > 0 && sizeNum > 0 ? sizeNum * priceUSD : null;
    const liq =
      priceUSD > 0 && sizeNum > 0 && marginNum >= 0
        ? estimateLiquidationPriceUSD({
            sizeBaseAsset: sizeNum,
            collateralUSD: marginNum,
            entryPriceUSD: priceUSD,
            isLong: side === "long",
          })
        : null;
    return {
      valueUSD: value != null ? value : null,
      estLiqPriceUSD: liq,
    };
  }, [priceUSD, sizeNum, marginNum, side]);

  const validate = (): boolean => {
    const next: typeof errors = {};
    const sizeNum = parseFloat(size);
    if (size === "" || isNaN(sizeNum) || sizeNum <= 0) {
      next.size = "Enter size (positive)";
    }
    const marginNum = parseFloat(margin);
    if (margin === "" || isNaN(marginNum) || marginNum < 0) {
      next.margin = "Enter margin";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleOpenPosition = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!isAuthenticated || !user?.walletAddress) {
      toast.error("Please sign in to place orders");
      return;
    }

    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const chosenSide = submitter?.getAttribute("data-side") as Side | null;
    if (chosenSide) setSide(chosenSide);

    if (!validate()) return;

    const finalSide = chosenSide ?? side;
    const sizeNum = parseFloat(size);
    const marginNum = parseFloat(margin);

    try {
      const intent = createPerpIntent({
        userAddress: user.walletAddress,
        marketId: DEFAULT_MARKET_ID,
        size: sizeNum,
        isLong: finalSide === "long",
        isOpen: true,
        collateral: marginNum,
        leverage,
      });

      // Log what we send (matches e2e: size in 18d, collateral = (size × 2800) / leverage, leverage in 18d)
      console.log("[OrderPanel] Open position — raw form:", {
        size: sizeNum,
        margin: marginNum,
        leverage,
        side: finalSide,
      });
      console.log("[OrderPanel] Open position — intent sent to API:", {
        size: intent.size,
        collateral: intent.collateral,
        leverage: intent.leverage,
        isLong: intent.isLong,
        isOpen: intent.isOpen,
      });

      const result = await openPosition.mutateAsync({
        intent,
        poolKey: DEFAULT_POOL_KEY,
      });

      setSize("");
      setMargin("");

      toast.success("Order submitted! It will execute in the next batch.", {
        description: `Commit: ${result.commitTxHash.slice(0, 10)}... Reveal: ${result.revealTxHash.slice(0, 10)}...`,
      });
    } catch (error) {
      console.error("Failed to open position:", error);
      toast.error("Failed to open position", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-b border-[#363d4a] bg-[#21262e] p-3">
      <form onSubmit={handleOpenPosition} className="flex flex-col gap-3">
        {/* Leverage: 1x–10x */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-[#7d8590]">Leverage</span>
            <span className="font-medium text-[#c8cdd4]">{leverage}x</span>
          </div>
          <input
            type="range"
            min={LEVERAGE_MIN}
            max={LEVERAGE_MAX}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="h-2 w-full accent-[#5b6b7a]"
          />
        </div>

        {/* Size: position size in base asset (e.g. ETH for ETH/USD) */}
        <div>
          <label className="mb-1 block text-xs text-[#7d8590]">
            Size (base asset)
          </label>
          <p className="mb-1 text-[10px] text-[#7d8590]">
            How much you want to trade (e.g. 0.1 ETH for ETH/USD)
          </p>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className={`w-full border bg-[#2a303c] px-2 py-1.5 text-sm text-[#c8cdd4] placeholder:text-[#7d8590] focus:outline-none focus:ring-1 focus:ring-[#5b6b7a] ${
              errors.size ? "border-[#b54a4a]" : "border-[#363d4a]"
            }`}
            aria-label="Position size in base asset"
          />
          {errors.size && <p className="mt-0.5 text-xs text-[#b54a4a]">{errors.size}</p>}
        </div>

        {/* Margin: collateral locked for this position. Contract: required margin = (size × price) / leverage */}
        <div>
          <label className="mb-1 block text-xs text-[#7d8590]">Margin</label>
          <p className="mb-1 text-[10px] text-[#7d8590]">
            Collateral locked for this position (in USDC). Required ≈ (size × price) ÷ leverage
          </p>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            className={`w-full border bg-[#2a303c] px-2 py-1.5 text-sm text-[#c8cdd4] placeholder:text-[#7d8590] focus:outline-none focus:ring-1 focus:ring-[#5b6b7a] ${
              errors.margin ? "border-[#b54a4a]" : "border-[#363d4a]"
            }`}
            aria-label="Margin (collateral) in USDC"
          />
          {errors.margin && <p className="mt-0.5 text-xs text-[#b54a4a]">{errors.margin}</p>}
        </div>

        {/* Open Long / Open Short */}
        <div className="flex gap-2">
          <button
            type="submit"
            name="side"
            data-side="long"
            onClick={() => setSide("long")}
            disabled={openPosition.isPending || !isAuthenticated}
            className="flex-1 bg-[#2d5a4a] py-2 text-sm font-medium text-white hover:bg-[#3d6a5a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {openPosition.isPending ? "Submitting..." : "Open Long"}
          </button>
          <button
            type="submit"
            name="side"
            data-side="short"
            onClick={() => setSide("short")}
            disabled={openPosition.isPending || !isAuthenticated}
            className="flex-1 bg-[#5a3d3d] py-2 text-sm font-medium text-white hover:bg-[#6a4d4d] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {openPosition.isPending ? "Submitting..." : "Open Short"}
          </button>
        </div>

        {openPosition.isError && (
          <div className="rounded border border-red-500 bg-red-500/10 p-2 text-xs text-red-400">
            {openPosition.error instanceof Error
              ? openPosition.error.message
              : "Failed to submit order"}
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 text-xs text-[#7d8590]">
          <span>Value</span>
          <span className="text-right font-medium text-[#c8cdd4]">
            {valueUSD != null
              ? `$${valueUSD.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"}
          </span>
          <span>Est. Liq. Price</span>
          <span className="text-right font-medium text-[#c8cdd4]">
            {estLiqPriceUSD != null
              ? `$${estLiqPriceUSD.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—"}
          </span>
        </div>

        <div className="mt-3 border-t border-[#363d4a] pt-3">
          <button
            type="button"
            disabled={clearing || !isAuthenticated || !token}
            onClick={async () => {
              if (!token) {
                toast.error("Not signed in");
                return;
              }
              setClearing(true);
              try {
                const res = await perpApi.clearPendingBatch(token);
                toast.success(
                  res.deletedCount > 0
                    ? `Cleared ${res.deletedCount} pending reveal(s). You can place new orders.`
                    : "No pending reveals to clear."
                );
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Failed to clear pending batch"
                );
              } finally {
                setClearing(false);
              }
            }}
            className="w-full rounded border border-[#363d4a] bg-[#2a303c] py-1.5 text-xs text-[#7d8590] hover:border-[#5b6b7a] hover:text-[#c8cdd4] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {clearing ? "Clearing..." : "Clear pending batch"}
          </button>
          <p className="mt-1 text-[10px] text-[#7d8590]">
            Use if batch keeps failing (e.g. old bad reveals). Then place 2 new orders.
          </p>
        </div>
      </form>
    </aside>
  );
}
