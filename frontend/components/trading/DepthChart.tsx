"use client";

import { useMemo, useState } from "react";
import { generateDepthData } from "@/lib/chart-data";

const MID_PRICE = 27594.09;
const MAX_DEPTH = 8;

export function DepthChart() {
  const [activeTab, setActiveTab] = useState<"depth" | "book">("depth");
  const [volumeScale, setVolumeScale] = useState(1);

  const { bids, asks } = useMemo(
    () => generateDepthData(MID_PRICE, MAX_DEPTH),
    [],
  );

  const maxSize = Math.max(
    ...bids.map((b) => b.size),
    ...asks.map((a) => a.size),
    1,
  );

  const formatPrice = (p: number) =>
    p.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const formatVolume = (s: number) =>
    s.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-l border-[#363d4a] bg-[#21262e]">
      {/* Tabs: Depth Chart | Trade Book - square, no curve */}
      <div className="flex shrink-0 border-b border-[#363d4a]">
        <button
          type="button"
          onClick={() => setActiveTab("depth")}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            activeTab === "depth"
              ? "border-b-2 border-[#5b6b7a] text-[#c8cdd4]"
              : "text-[#7d8590] hover:text-[#c8cdd4]"
          }`}
        >
          Depth Chart
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("book")}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            activeTab === "book"
              ? "border-b-2 border-[#5b6b7a] text-[#c8cdd4]"
              : "text-[#7d8590] hover:text-[#c8cdd4]"
          }`}
        >
          Trade Book
        </button>
      </div>

      {/* Column headers: FILL PRICE | VOLUME with +/- - square buttons, no border */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#363d4a] px-2 py-1.5 text-xs">
        <div className="font-medium text-[#7d8590]">FILL PRICE</div>
        <div className="flex items-center gap-1">
          <span className="font-medium text-[#7d8590]">VOLUME</span>
          <div className="flex bg-[#2a303c]">
            <button
              type="button"
              onClick={() => setVolumeScale((s) => Math.max(0.5, s - 0.25))}
              className="px-1.5 py-0.5 text-[#c8cdd4] hover:bg-[#363d4a]"
              aria-label="Decrease volume scale"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setVolumeScale((s) => Math.min(2, s + 0.25))}
              className="px-1.5 py-0.5 text-[#c8cdd4] hover:bg-[#363d4a]"
              aria-label="Increase volume scale"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable depth content */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1">
        {/* Asks (sell) - reddish-pink, prices decrease toward center */}
        <div className="flex flex-col-reverse">
          {asks.map((a, i) => (
            <div
              key={`ask-${i}`}
              className="grid grid-cols-[1fr_1fr] items-center gap-2 py-0.5"
            >
              <span className="text-rose-400/90">{formatPrice(a.price)}</span>
              <div className="flex items-center gap-2">
                <div className="min-h-0 min-w-0 flex-1">
                  <div
                    className="h-4 bg-rose-500/50"
                    style={{
                      width: `${Math.min(100, (a.size / maxSize) * 100 * volumeScale)}%`,
                      minWidth: 2,
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-[#c8cdd4]">
                  {formatVolume(a.size)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Current market price - prominent green */}
        <div className="my-1.5 shrink-0 text-center">
          <span className="text-lg font-semibold text-[#4a9b6e]">
            ${formatPrice(MID_PRICE)}
          </span>
        </div>

        {/* Bids (buy) - green */}
        <div className="flex flex-col">
          {bids.map((b, i) => (
            <div
              key={`bid-${i}`}
              className="grid grid-cols-[1fr_1fr] items-center gap-2 py-0.5"
            >
              <span className="text-[#4a9b6e]">{formatPrice(b.price)}</span>
              <div className="flex items-center gap-2">
                <div className="min-h-0 min-w-0 flex-1">
                  <div
                    className="h-4 bg-green-500/50"
                    style={{
                      width: `${Math.min(100, (b.size / maxSize) * 100 * volumeScale)}%`,
                      minWidth: 2,
                    }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-[#c8cdd4]">
                  {formatVolume(b.size)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
