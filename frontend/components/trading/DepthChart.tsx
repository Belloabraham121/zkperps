"use client";

import { useMemo } from "react";
import { generateDepthData } from "@/lib/chart-data";

const MID_PRICE = 27554;
const MAX_DEPTH = 12;

export function DepthChart() {
  const { bids, asks } = useMemo(
    () => generateDepthData(MID_PRICE, MAX_DEPTH),
    []
  );

  const maxSize = Math.max(
    ...bids.map((b) => b.size),
    ...asks.map((a) => a.size),
    1
  );

  const formatPrice = (p: number) =>
    p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatSize = (s: number) => s.toFixed(3);

  return (
    <div className="flex h-full flex-col border-l border-slate-700/50 bg-slate-900/50">
      <div className="flex border-b border-slate-700/50">
        <button
          type="button"
          className="flex-1 px-3 py-2 text-xs font-medium text-sky-400"
        >
          Depth Chart
        </button>
        <button
          type="button"
          className="flex-1 px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
        >
          Trade Book
        </button>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-2 px-2 py-2 text-xs">
        <div className="font-medium text-slate-400">FILL PRICE</div>
        <div className="font-medium text-slate-400">VOLUME</div>
      </div>
      {/* Asks (sell side) - top, red */}
      <div className="flex flex-1 flex-col overflow-auto px-2">
        <div className="flex flex-col-reverse">
          {asks.map((a, i) => (
            <div
              key={`ask-${i}`}
              className="grid grid-cols-[1fr_1fr] gap-2 py-0.5"
            >
              <span className="text-red-400">{formatPrice(a.price)}</span>
              <div className="flex items-center gap-1">
                <div
                  className="h-4 min-w-0 flex-1 rounded bg-red-500/30"
                  style={{ width: `${(a.size / maxSize) * 100}%`, minWidth: 2 }}
                />
                <span className="w-10 shrink-0 text-right text-slate-400">{formatSize(a.size)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="my-1 text-center text-base font-semibold text-slate-100">
          ${formatPrice(MID_PRICE)}
        </div>
        {/* Bids (buy side) - bottom, green */}
        <div className="flex flex-col">
          {bids.map((b, i) => (
            <div
              key={`bid-${i}`}
              className="grid grid-cols-[1fr_1fr] gap-2 py-0.5"
            >
              <span className="text-green-400">{formatPrice(b.price)}</span>
              <div className="flex items-center gap-1">
                <div
                  className="h-4 min-w-0 flex-1 rounded bg-green-500/30"
                  style={{ width: `${(b.size / maxSize) * 100}%`, minWidth: 2 }}
                />
                <span className="w-10 shrink-0 text-right text-slate-400">{formatSize(b.size)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
