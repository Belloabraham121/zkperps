"use client";

import { useState } from "react";

type TabId = "positions" | "open-orders" | "position-history" | "historical-pnl" | "order-history" | "trade-history";

const TABS: { id: TabId; label: string; count?: number }[] = [
  { id: "positions", label: "Positions", count: 0 },
  { id: "open-orders", label: "Open Orders", count: 0 },
  { id: "position-history", label: "Position History" },
  { id: "historical-pnl", label: "Historical P&L" },
  { id: "order-history", label: "Order History" },
  { id: "trade-history", label: "Trade History" },
];

type MarginMode = "isolated" | "cross";

interface MockPosition {
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
  realisedPnl: string;
  realisedPnlPct: string;
  hasTpSl: boolean;
  tpSlLabel?: string;
  tpSlValue?: string;
}

// Mock data matching reference: 4 rows, 2 with 12x Isolated, 2 with 28x Cross
const MOCK_POSITIONS: MockPosition[] = [
  {
    symbol: "BTCUSD",
    quantity: "-123.00",
    quantityLabel: "BTC",
    leverage: 12,
    marginMode: "isolated",
    entryPrice: "14,456.45 USD",
    markPrice: "25,463.45",
    liqPrice: "0.000000000123",
    margin: "2,445.34 USD",
    unrealisedPnl: "+467.00 USD",
    unrealisedPnlPct: "+42%",
    realisedPnl: "+467.00 USD",
    realisedPnlPct: "+42%",
    hasTpSl: false,
  },
  {
    symbol: "BTCUSD",
    quantity: "-123.00",
    quantityLabel: "BTC",
    leverage: 28,
    marginMode: "cross",
    entryPrice: "14,456.45 USD",
    markPrice: "25,463.45",
    liqPrice: "25,124.56",
    margin: "2,445.34 USD",
    unrealisedPnl: "+467.00 USD",
    unrealisedPnlPct: "+42%",
    realisedPnl: "+467.00 USD",
    realisedPnlPct: "+42%",
    hasTpSl: true,
    tpSlLabel: "TP 0.45",
    tpSlValue: "$15,600.00",
  },
  {
    symbol: "BTCUSD",
    quantity: "-123.00",
    quantityLabel: "BTC",
    leverage: 12,
    marginMode: "isolated",
    entryPrice: "14,456.45 USD",
    markPrice: "25,463.45",
    liqPrice: "0.000000000123",
    margin: "2,445.34 USD",
    unrealisedPnl: "+467.00 USD",
    unrealisedPnlPct: "+42%",
    realisedPnl: "+467.00 USD",
    realisedPnlPct: "+42%",
    hasTpSl: false,
  },
  {
    symbol: "BTCUSD",
    quantity: "-123.00",
    quantityLabel: "BTC",
    leverage: 28,
    marginMode: "cross",
    entryPrice: "14,456.45 USD",
    markPrice: "25,463.45",
    liqPrice: "25,124.56",
    margin: "2,445.34 USD",
    unrealisedPnl: "+467.00 USD",
    unrealisedPnlPct: "+42%",
    realisedPnl: "+467.00 USD",
    realisedPnlPct: "+42%",
    hasTpSl: true,
    tpSlLabel: "TP 0.45",
    tpSlValue: "$15,600.00",
  },
];

export function PositionsPanelBox() {
  const [activeTab, setActiveTab] = useState<TabId>("positions");
  const [allMarkets, setAllMarkets] = useState(true);
  const [positions] = useState<MockPosition[]>(MOCK_POSITIONS);

  const handleCloseAll = () => {
    // TODO: close all positions via API
    console.log("Close all");
  };

  const handleClose = (index: number) => {
    // TODO: close single position
    console.log("Close", index);
  };

  return (
    <section className="flex min-h-[180px] shrink-0 flex-col overflow-hidden border-t border-[#363d4a] bg-[#21262e]">
      {/* Tabs + All Markets filter - square tabs, no curve */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#363d4a] px-2 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap px-2 py-1.5 text-xs font-medium ${
                activeTab === tab.id
                  ? "border-b-2 border-[#5b6b7a] text-[#c8cdd4]"
                  : "text-[#7d8590] hover:text-[#c8cdd4]"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={`border px-1.5 py-0.5 text-[10px] ${
                    activeTab === tab.id ? "border-[#363d4a] bg-[#2a303c] text-[#c8cdd4]" : "border-[#363d4a] text-[#7d8590]"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-[#7d8590]">
          <input
            type="checkbox"
            checked={allMarkets}
            onChange={(e) => setAllMarkets(e.target.checked)}
            className="h-3.5 w-3.5 border-[#363d4a] bg-[#2a303c] accent-[#4a9b6e]"
          />
          All Markets
        </label>
      </div>

      {/* Table: Positions view */}
      {activeTab === "positions" && (
        <div className="min-h-0 flex-1 overflow-auto overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-[#21262e]">
              <tr className="border-b border-[#363d4a] text-[#7d8590]">
                <th className="py-2 pl-2 text-left font-medium uppercase tracking-wide">Symbol</th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">Quantity</th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">Entry Price</th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">Mark Price</th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">Liq. Price</th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">Margin</th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">Unrealised P&L</th>
                <th className="py-2 text-right font-medium uppercase tracking-wide">Realised P&L</th>
                <th className="py-2 text-center font-medium uppercase tracking-wide">TP/SL</th>
                <th className="py-2 pr-2 text-right font-medium uppercase tracking-wide">
                  <button
                    type="button"
                    onClick={handleCloseAll}
                    className="bg-[#2a303c] px-2 py-1 text-[#c8cdd4] hover:bg-[#363d4a]"
                  >
                    Close All
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {positions.map((row, i) => (
                <tr key={i} className="border-b border-[#363d4a] hover:bg-[#2a303c]">
                  <td className="py-2 pl-2">
                    <div className="font-medium text-[#c8cdd4]">{row.symbol}</div>
                    <span
                      className={`mt-0.5 inline-block px-1.5 py-0.5 text-[10px] font-medium text-white ${
                        row.marginMode === "isolated" ? "bg-[#5a3d3d]" : "bg-[#2d5a4a]"
                      }`}
                    >
                      {row.leverage}x {row.marginMode === "isolated" ? "Isolated" : "Cross"}
                    </span>
                  </td>
                  <td className="py-2 text-right text-[#c8cdd4]">
                    {row.quantity} {row.quantityLabel}
                  </td>
                  <td className="py-2 text-right text-[#c8cdd4]">{row.entryPrice}</td>
                  <td className="py-2 text-right text-[#c8cdd4]">{row.markPrice}</td>
                  <td className="py-2 text-right text-[#c8cdd4]">{row.liqPrice}</td>
                  <td className="py-2 text-right text-[#c8cdd4]">
                    {row.margin}
                    <button type="button" className="ml-1 inline-block text-[#7d8590] hover:text-[#c8cdd4]" aria-label="Edit margin">
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                  </td>
                  <td className="py-2 text-right">
                    <div className="text-[#4a9b6e]">{row.unrealisedPnl}</div>
                    <div className="text-[#4a9b6e]">{row.unrealisedPnlPct}</div>
                  </td>
                  <td className="py-2 text-right">
                    <div className="text-[#4a9b6e]">{row.realisedPnl}</div>
                    <div className="text-[#4a9b6e]">{row.realisedPnlPct}</div>
                  </td>
                  <td className="py-2">
                    <div className="flex justify-center">
                      {row.hasTpSl ? (
                        <div className="text-center text-[#c8cdd4]">
                          <div>{row.tpSlLabel}</div>
                          <div>{row.tpSlValue}</div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="flex h-6 w-6 items-center justify-center bg-[#2a303c] text-[#7d8590] hover:bg-[#363d4a] hover:text-[#c8cdd4]"
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
                      className="bg-[#2a303c] px-2 py-1 text-[#c8cdd4] hover:bg-[#363d4a]"
                    >
                      Close
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Placeholder for other tabs */}
      {activeTab !== "positions" && (
        <div className="flex flex-1 items-center justify-center p-4 text-xs text-[#7d8590]">
          {activeTab === "open-orders" && "Open orders will appear here."}
          {activeTab === "position-history" && "Position history will appear here."}
          {activeTab === "historical-pnl" && "Historical P&L will appear here."}
          {activeTab === "order-history" && "Order history will appear here."}
          {activeTab === "trade-history" && "Trade history will appear here."}
        </div>
      )}
    </section>
  );
}
