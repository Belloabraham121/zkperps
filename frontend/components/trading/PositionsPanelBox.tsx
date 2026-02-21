"use client";

import { useState } from "react";
import {
  usePosition,
  useClosePosition,
  useOrders,
  useTradeHistory,
  usePositionHistory,
} from "@/hooks/usePositions";
import { useAuth } from "@/lib/auth";
import { DEFAULT_MARKET_ID, DEFAULT_POOL_KEY } from "@/lib/config";
import {
  formatPositionSize,
  priceFromBigInt,
  amountFromBigInt,
  leverageFromBigInt,
  createPerpIntent,
  estimateLiquidationPriceUSD,
} from "@/lib/utils/perp";
import { useMarketStats } from "@/hooks/useMarketStats";
import { toast } from "sonner";
import type { PerpOrderRecord, PerpTradeRecord } from "@/lib/api/perp";

type TabId =
  | "positions"
  | "open-orders"
  | "position-history"
  | "historical-pnl"
  | "order-history"
  | "trade-history";

const TABS: { id: TabId; label: string; count?: number }[] = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "position-history", label: "Position History" },
  { id: "historical-pnl", label: "Historical P&L" },
  { id: "order-history", label: "Order History" },
  { id: "trade-history", label: "Trade History" },
];

type MarginMode = "isolated" | "cross";

function OrdersTable({
  orders,
  isLoading,
  showStatus = false,
}: {
  orders: PerpOrderRecord[];
  isLoading: boolean;
  showStatus?: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto overflow-x-auto">
      <table className="w-full min-w-[600px] border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-[#111111]">
          <tr className="border-b border-[#262626] text-white/50">
            <th className="py-2 pl-2 text-left font-medium uppercase tracking-wide">
              Time
            </th>
            <th className="py-2 text-left font-medium uppercase tracking-wide">
              Symbol
            </th>
            <th className="py-2 text-right font-medium uppercase tracking-wide">
              Side
            </th>
            <th className="py-2 text-right font-medium uppercase tracking-wide">
              Size
            </th>
            <th className="py-2 text-right font-medium uppercase tracking-wide">
              Leverage
            </th>
            <th className="py-2 text-right font-medium uppercase tracking-wide">
              Margin
            </th>
            {showStatus && (
              <th className="py-2 pr-2 text-right font-medium uppercase tracking-wide">
                Status
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td
                colSpan={showStatus ? 7 : 6}
                className="py-8 text-center text-white/50"
              >
                Loading...
              </td>
            </tr>
          ) : orders.length === 0 ? (
            <tr>
              <td
                colSpan={showStatus ? 7 : 6}
                className="py-8 text-center text-white/50"
              >
                No orders
              </td>
            </tr>
          ) : (
            orders.map((o) => (
              <tr
                key={o.commitmentHash}
                className="border-b border-[#262626] hover:bg-[#1a1a1a]"
              >
                <td className="py-2 pl-2 text-white">
                  {formatOrderDate(o.createdAt)}
                </td>
                <td className="py-2 text-white">ETHUSD</td>
                <td className="py-2 text-right">
                  <span
                    className={o.isLong ? "text-[#4a9b6e]" : "text-[#c75a5a]"}
                  >
                    {o.isLong ? "Long" : "Short"} {o.isOpen ? "Open" : "Close"}
                  </span>
                </td>
                <td className="py-2 text-right text-white">
                  {formatPositionSize(o.size)}
                </td>
                <td className="py-2 text-right text-white">
                  {leverageFromBigInt(o.leverage)}x
                </td>
                <td className="py-2 text-right text-white">
                  $
                  {amountFromBigInt(o.collateral, 18).toLocaleString(
                    undefined,
                    { minimumFractionDigits: 2 },
                  )}
                </td>
                {showStatus && (
                  <td className="py-2 pr-2 text-right">
                    <span
                      className={
                        o.status === "pending"
                          ? "text-amber-400"
                          : o.status === "executed"
                            ? "text-[#4a9b6e]"
                            : "text-white/50"
                      }
                    >
                      {o.status}
                    </span>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function TradesTable({
  trades,
  isLoading,
  showRealisedPnl = false,
}: {
  trades: PerpTradeRecord[];
  isLoading: boolean;
  showRealisedPnl?: boolean;
}) {
  const colSpan = showRealisedPnl ? 7 : 6;
  return (
    <div className="min-h-0 flex-1 overflow-auto overflow-x-auto">
      <table className="w-full min-w-[600px] border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-[#111111]">
          <tr className="border-b border-[#262626] text-white/50">
            <th className="py-2 pl-2 text-left font-medium uppercase tracking-wide">
              Time
            </th>
            <th className="py-2 text-left font-medium uppercase tracking-wide">
              Symbol
            </th>
            <th className="py-2 text-right font-medium uppercase tracking-wide">
              Side
            </th>
            <th className="py-2 text-right font-medium uppercase tracking-wide">
              Size
            </th>
            <th className="py-2 text-right font-medium uppercase tracking-wide">
              Entry
            </th>
            {showRealisedPnl && (
              <th className="py-2 text-right font-medium uppercase tracking-wide">
                Realised P&L
              </th>
            )}
            <th className="py-2 text-right font-medium uppercase tracking-wide">
              Tx
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={colSpan} className="py-8 text-center text-white/50">
                Loading...
              </td>
            </tr>
          ) : trades.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="py-8 text-center text-white/50">
                No trades
              </td>
            </tr>
          ) : (
            trades.map((t) => (
              <tr
                key={t.commitmentHash + t.executedAt}
                className="border-b border-[#262626] hover:bg-[#1a1a1a]"
              >
                <td className="py-2 pl-2 text-white">
                  {formatOrderDate(t.executedAt)}
                </td>
                <td className="py-2 text-white">ETHUSD</td>
                <td className="py-2 text-right">
                  <span
                    className={t.isLong ? "text-[#4a9b6e]" : "text-[#c75a5a]"}
                  >
                    {t.isLong ? "Long" : "Short"} {t.isOpen ? "Open" : "Close"}
                  </span>
                </td>
                <td className="py-2 text-right text-white">
                  {formatPositionSize(t.size)}
                </td>
                <td className="py-2 text-right text-white">
                  {t.entryPrice
                    ? `$${priceFromBigInt(t.entryPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                    : "—"}
                </td>
                {showRealisedPnl && (
                  <td className="py-2 text-right">
                    {t.realisedPnl != null ? (
                      <span
                        className={
                          t.realisedPnl >= 0
                            ? "text-[#4a9b6e]"
                            : "text-[#c75a5a]"
                        }
                      >
                        {t.realisedPnl >= 0 ? "" : "-"}$
                        {Math.abs(t.realisedPnl).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        {t.realisedPnlPct != null
                          ? ` (${t.realisedPnlPct >= 0 ? "" : "-"}${Math.abs(t.realisedPnlPct).toFixed(2)}%)`
                          : ""}
                      </span>
                    ) : (
                      <span className="text-white/50">—</span>
                    )}
                  </td>
                )}
                <td className="py-2 pr-2 text-right">
                  <a
                    href={`https://sepolia.arbiscan.io/tx/${t.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/40 hover:text-white truncate max-w-[80px] inline-block"
                    title={t.txHash}
                  >
                    {t.txHash.slice(0, 10)}…
                  </a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

interface DisplayPosition {
  symbol: string;
  quantity: string;
  quantityLabel: string;
  leverage: number;
  marginMode: MarginMode;
  entryPrice: string;
  markPrice: string;
  liqPrice: string;
  margin: string;
  unrealisedPnl: string;
  unrealisedPnlPct: string;
  unrealisedColor?: string;
  realisedPnl: string;
  realisedPnlPct: string;
  hasTpSl: boolean;
  tpSlLabel?: string;
  tpSlValue?: string;
}

function formatOrderDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function PositionsPanelBox() {
  const { user, isAuthenticated } = useAuth();
  const { data: positionData, isLoading } = usePosition(DEFAULT_MARKET_ID);
  const { data: marketStats } = useMarketStats("ethereum");
  const closePosition = useClosePosition();
  const { data: ordersData, isLoading: ordersLoading } = useOrders("pending");
  const { data: orderHistoryData, isLoading: orderHistoryLoading } =
    useOrders("all");
  const { data: tradeHistoryData, isLoading: tradeHistoryLoading } =
    useTradeHistory(50);
  const { data: positionHistoryData, isLoading: positionHistoryLoading } =
    usePositionHistory({ limit: 50 });

  const openOrders = ordersData?.orders ?? [];
  const orderHistory = orderHistoryData?.orders ?? [];
  const tradeHistory = tradeHistoryData?.trades ?? [];
  const positionHistoryTrades = positionHistoryData?.trades ?? [];

  const [activeTab, setActiveTab] = useState<TabId>("positions");
  const [allMarkets, setAllMarkets] = useState(true);

  const currentPrice = marketStats?.price ?? 0;

  // Convert API position to display format (unrealized PnL from contract when available)
  const positions: DisplayPosition[] = [];
  if (positionData?.position && positionData.position.size !== "0") {
    const pos = positionData.position;
    const size = formatPositionSize(pos.size);
    const isLong = !pos.size.startsWith("-");
    const entryPriceNum = priceFromBigInt(pos.entryPrice);
    const margin = amountFromBigInt(pos.collateral, 18);
    const leverage = leverageFromBigInt(pos.leverage);
    const sizeNum = amountFromBigInt(pos.size.replace("-", ""), 18);
    const markPriceNum = currentPrice > 0 ? currentPrice : entryPriceNum;

    const unrealizedPnlRaw =
      pos.unrealizedPnl != null ? pos.unrealizedPnl : null;
    const unrealisedPnlNum =
      unrealizedPnlRaw != null ? Number(unrealizedPnlRaw) / 1e18 : 0;
    const notional = sizeNum * entryPriceNum;
    const unrealisedPnlPctNum =
      notional > 0 && unrealizedPnlRaw != null
        ? (Number(unrealizedPnlRaw) / 1e18 / notional) * 100
        : 0;

    console.log("[Positions] Unrealized PnL (contract)", {
      unrealizedPnlRaw: pos.unrealizedPnl ?? "(not in API)",
      unrealisedPnlUSD: unrealisedPnlNum,
      notional,
      unrealisedPnlPct: unrealisedPnlPctNum,
    });

    const liqPriceNum = estimateLiquidationPriceUSD({
      sizeBaseAsset: sizeNum,
      collateralUSD: margin,
      entryPriceUSD: entryPriceNum,
      isLong,
    });
    const liqPriceStr =
      liqPriceNum != null
        ? `$${(liqPriceNum >= 1e12 ? liqPriceNum / 1e18 : liqPriceNum).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
        : "—";

    const unrealisedColor =
      unrealisedPnlNum >= 0 ? "text-[#4a9b6e]" : "text-[#c75a5a]";
    positions.push({
      symbol: "ETHUSD",
      quantity: size,
      quantityLabel: "ETH",
      leverage: Math.round(leverage),
      marginMode: "isolated",
      entryPrice: entryPriceNum.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }),
      markPrice: markPriceNum.toLocaleString("en-US", {
        minimumFractionDigits: 2,
      }),
      liqPrice: liqPriceStr,
      margin: margin.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }),
      unrealisedPnl: `${unrealisedPnlNum >= 0 ? "" : "-"}$${Math.abs(unrealisedPnlNum).toFixed(2)}`,
      unrealisedPnlPct: `${unrealisedPnlPctNum >= 0 ? "" : "-"}${Math.abs(unrealisedPnlPctNum).toFixed(2)}%`,
      unrealisedColor,
      realisedPnl: "0.00 USD",
      realisedPnlPct: "0%",
      hasTpSl: false,
    });
  }

  const handleCloseAll = async () => {
    if (!isAuthenticated || !user?.walletAddress || !positionData?.position) {
      return;
    }

    try {
      // Close entire position: use raw size (18 decimals) so we never round to 0 and hit InvalidSize()
      const rawSize = positionData.position.size.startsWith("-")
        ? positionData.position.size.slice(1)
        : positionData.position.size;
      if (!rawSize || rawSize === "0" || BigInt(rawSize) === BigInt(0)) {
        toast.error("Cannot close position", { description: "Position size is zero." });
        return;
      }
      const intent = createPerpIntent({
        userAddress: user.walletAddress,
        marketId: DEFAULT_MARKET_ID,
        size: rawSize,
        isLong: !positionData.position.size.startsWith("-"),
        isOpen: false, // Close position
        leverage: leverageFromBigInt(positionData.position.leverage),
      });

      await closePosition.mutateAsync({
        intent,
        poolKey: DEFAULT_POOL_KEY,
      });

      toast.success("Position closed", {
        description: "Position closed successfully!",
      });
    } catch (error) {
      console.error("Failed to close position:", error);
      toast.error("Failed to close position", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  const handleClose = async (index: number) => {
    // For now, same as close all since we only support one position
    await handleCloseAll();
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-[#262626] bg-[#111111]">
      {/* Tabs + All Markets filter - square tabs, no curve */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#262626] px-2 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap px-2 py-1.5 text-xs font-medium ${
                activeTab === tab.id
                  ? "border-b-2 border-white/30 text-white"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {tab.label}
              {tab.id === "positions" && (
                <span
                  className={`border px-1.5 py-0.5 text-[10px] ${
                    activeTab === tab.id
                      ? "border-[#262626] bg-[#1a1a1a] text-white"
                      : "border-[#262626] text-white/50"
                  }`}
                >
                  {positions.length}
                </span>
              )}
              {tab.id === "open-orders" && (
                <span
                  className={`border px-1.5 py-0.5 text-[10px] ${
                    activeTab === tab.id
                      ? "border-[#262626] bg-[#1a1a1a] text-white"
                      : "border-[#262626] text-white/50"
                  }`}
                >
                  {openOrders.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-white/50">
          <input
            type="checkbox"
            checked={allMarkets}
            onChange={(e) => setAllMarkets(e.target.checked)}
            className="h-3.5 w-3.5 border-[#262626] bg-[#1a1a1a] accent-[#4a9b6e]"
          />
          All Markets
        </label>
      </div>

      {/* Table: Positions view */}
      {activeTab === "positions" && (
        <div className="min-h-0 flex-1 overflow-auto overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-[#111111]">
              <tr className="border-b border-[#262626] text-white/50">
                <th className="py-2 pl-2 text-left font-medium uppercase tracking-wide">
                  Symbol
                </th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">
                  Quantity
                </th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">
                  Entry Price
                </th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">
                  Mark Price
                </th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">
                  Liq. Price
                </th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">
                  Margin
                </th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">
                  Unrealised P&L
                </th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">
                  Realised P&L
                </th>
                <th className="py-2 text-center font-medium uppercase tracking-wide">
                  TP/SL
                </th>
                <th className="py-2 pr-2 text-right font-medium uppercase tracking-wide">
                  <button
                    type="button"
                    onClick={handleCloseAll}
                    disabled={closePosition.isPending || positions.length === 0}
                    className="bg-[#1a1a1a] px-2 py-1 text-white hover:bg-[#262626] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {closePosition.isPending ? "Closing..." : "Close All"}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-white/50">
                    Loading positions...
                  </td>
                </tr>
              ) : positions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-white/50">
                    No open positions
                  </td>
                </tr>
              ) : (
                positions.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-[#262626] hover:bg-[#1a1a1a]"
                  >
                    <td className="py-2 pl-2">
                      <div className="font-medium text-white">{row.symbol}</div>
                      <span
                        className={`mt-0.5 inline-block px-1.5 py-0.5 text-[10px] font-medium text-white ${
                          row.marginMode === "isolated"
                            ? "bg-[#5a3d3d]"
                            : "bg-[#2d5a4a]"
                        }`}
                      >
                        {row.leverage}x{" "}
                        {row.marginMode === "isolated" ? "Isolated" : "Cross"}
                      </span>
                    </td>
                    <td className="py-2 text-right text-white">
                      {row.quantity} {row.quantityLabel}
                    </td>
                    <td className="py-2 text-right text-white">
                      {row.entryPrice}
                    </td>
                    <td className="py-2 text-right text-white">
                      {row.markPrice}
                    </td>
                    <td className="py-2 text-right text-white">
                      {row.liqPrice}
                    </td>
                    <td className="py-2 text-right text-white">
                      {row.margin}
                      <button
                        type="button"
                        className="ml-1 inline-block text-white/50 hover:text-white"
                        aria-label="Edit margin"
                      >
                        <svg
                          className="h-3 w-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                          />
                        </svg>
                      </button>
                    </td>
                    <td className="py-2 text-right">
                      <div className={row.unrealisedColor ?? "text-[#4a9b6e]"}>
                        {row.unrealisedPnl}
                      </div>
                      <div className={row.unrealisedColor ?? "text-[#4a9b6e]"}>
                        {row.unrealisedPnlPct}
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      <div className="text-white/70">{row.realisedPnl}</div>
                      <div className="text-white/70">{row.realisedPnlPct}</div>
                    </td>
                    <td className="py-2">
                      <div className="flex justify-center">
                        {row.hasTpSl ? (
                          <div className="text-center text-white">
                            <div>{row.tpSlLabel}</div>
                            <div>{row.tpSlValue}</div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center bg-[#1a1a1a] text-white/50 hover:bg-[#262626] hover:text-white"
                            aria-label="Add TP/SL"
                          >
                            +
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleClose(i)}
                        disabled={closePosition.isPending}
                        className="bg-[#1a1a1a] px-2 py-1 text-white hover:bg-[#262626] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {closePosition.isPending ? "Closing..." : "Close"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Open Orders */}
      {activeTab === "open-orders" && (
        <OrdersTable orders={openOrders} isLoading={ordersLoading} />
      )}

      {/* Order History */}
      {activeTab === "order-history" && (
        <OrdersTable
          orders={orderHistory}
          isLoading={orderHistoryLoading}
          showStatus
        />
      )}

      {/* Trade History */}
      {activeTab === "trade-history" && (
        <TradesTable trades={tradeHistory} isLoading={tradeHistoryLoading} />
      )}

      {/* Position History */}
      {activeTab === "position-history" && (
        <TradesTable
          trades={positionHistoryTrades}
          isLoading={positionHistoryLoading}
          showRealisedPnl
        />
      )}

      {/* Historical P&L */}
      {activeTab === "historical-pnl" && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-2">
          <div className="flex shrink-0 flex-wrap items-center gap-6 border-b border-[#262626] pb-4">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/50">
                Total Realised P&L
              </div>
              <div
                className={`text-xl font-semibold ${(() => {
                  const total = (positionHistoryTrades ?? [])
                    .filter((t) => t.realisedPnl != null)
                    .reduce((sum, t) => sum + (t.realisedPnl ?? 0), 0);
                  return total >= 0 ? "text-[#4a9b6e]" : "text-[#c75a5a]";
                })()}`}
              >
                {(() => {
                  const total = (positionHistoryTrades ?? [])
                    .filter((t) => t.realisedPnl != null)
                    .reduce((sum, t) => sum + (t.realisedPnl ?? 0), 0);
                  const sign = total >= 0 ? "" : "-";
                  return `${sign}$${Math.abs(total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                })()}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/50">
                Closed Trades
              </div>
              <div className="text-lg font-medium text-white">
                {(positionHistoryTrades ?? []).filter((t) => !t.isOpen).length}
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <TradesTable
              trades={positionHistoryTrades}
              isLoading={positionHistoryLoading}
              showRealisedPnl
            />
          </div>
        </div>
      )}
    </section>
  );
}
