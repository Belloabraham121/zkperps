"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { generateCandleData, getOhlcvSummary } from "@/lib/chart-data";

const TIMEFRAMES = ["1M", "15M", "1H", "1D", "1W"] as const;
const INTERVAL_MIN: Record<(typeof TIMEFRAMES)[number], number> = {
  "1M": 1,
  "15M": 15,
  "1H": 60,
  "1D": 24 * 60,
  "1W": 24 * 60 * 7,
};
const CANDLE_COUNT = 80;
const BASE_PRICE = 27554;

export function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("1M");
  const [activeTab, setActiveTab] = useState<"Price" | "Funding">("Price");

  const chartData = useMemo(() => {
    const { candles, volume } = generateCandleData(
      BASE_PRICE,
      CANDLE_COUNT,
      INTERVAL_MIN[timeframe]
    );
    const s = getOhlcvSummary(candles);
    return {
      candles,
      volume,
      summary: {
        ...s,
        volumePct: 0.02,
        amplitudePct: s.amplitudePct || 0.33,
      },
    };
  }, [timeframe]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0f172a" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      width: containerRef.current.clientWidth,
      height: Math.max(containerRef.current.clientHeight, 200),
      rightPriceScale: {
        borderColor: "#334155",
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: "#475569" },
        horzLine: { color: "#475569" },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#26a69a",
      priceFormat: { type: "volume" },
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      borderVisible: false,
    });

    candleSeries.setData(chartData.candles);
    volumeSeries.setData(chartData.volume);

    chart.timeScale().fitContent();
    chart.applyOptions({ attributionLogo: false } as Parameters<IChartApi["applyOptions"]>[0]);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        const w = containerRef.current.clientWidth;
        const h = Math.max(containerRef.current.clientHeight, 200);
        chartRef.current.applyOptions({ width: w, height: h });
      }
    };
    const ro = new ResizeObserver(handleResize);
    ro.observe(containerRef.current);
    window.addEventListener("resize", handleResize);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  // chartData is derived from timeframe; re-create chart only when timeframe changes
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chartData.candles/volume omitted on purpose
  }, [timeframe]);

  const formatPrice = (p: number) => p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const utcTime = new Date().toISOString().slice(11, 19) + " UTC";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Top controls */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-700/50 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
            title="Drawing tools"
            aria-label="Drawing tools"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
            title="Layout"
            aria-label="Layout"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
            </svg>
          </button>
          <div className="ml-1 flex rounded bg-slate-800/80">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 text-xs font-medium ${timeframe === tf ? "bg-slate-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("Price")}
            className={`px-2 py-1 text-xs font-medium ${activeTab === "Price" ? "text-sky-400" : "text-slate-400 hover:text-slate-200"}`}
          >
            Price
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("Funding")}
            className={`px-2 py-1 text-xs font-medium ${activeTab === "Funding" ? "text-sky-400" : "text-slate-400 hover:text-slate-200"}`}
          >
            Funding
          </button>
          <div className="flex gap-0.5">
            {["screenshot", "filter", "settings", "fullscreen", "share"].map((t) => (
              <button
                key={t}
                type="button"
                className="rounded p-1.5 text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                title={t}
                aria-label={t}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Data bar */}
      <div className="flex flex-wrap items-center gap-4 border-b border-slate-700/50 px-2 py-1.5 text-xs text-slate-400">
        <span><strong className="text-slate-300">Open:</strong> {formatPrice(chartData.summary.open)}</span>
        <span><strong className="text-slate-300">High:</strong> {formatPrice(chartData.summary.high)}</span>
        <span><strong className="text-slate-300">Low:</strong> {formatPrice(chartData.summary.low)}</span>
        <span><strong className="text-slate-300">Close:</strong> {formatPrice(chartData.summary.close)}</span>
        <span><strong className="text-slate-300">Volume:</strong> {chartData.summary.volumePct}%</span>
        <span><strong className="text-slate-300">Amplitude:</strong> {chartData.summary.amplitudePct.toFixed(2)}%</span>
      </div>

      {/* Chart - fills remaining height */}
      <div ref={containerRef} className="min-h-0 flex-1 w-full" />

      {/* Bottom bar */}
      <div className="flex items-center justify-between border-t border-slate-700/50 px-2 py-1 text-xs text-slate-500">
        <span>{utcTime}</span>
        <div className="flex items-center gap-2">
          <button type="button" className="hover:text-slate-300">%</button>
          <button type="button" className="hover:text-slate-300">Log</button>
          <button type="button" className="text-sky-400">auto</button>
          <button type="button" className="rounded p-0.5 hover:bg-slate-700/50" aria-label="Settings">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
