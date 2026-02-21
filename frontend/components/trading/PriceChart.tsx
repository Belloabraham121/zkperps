"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { generateCandleData, getOhlcvSummary } from "@/lib/chart-data";
import {
  fetchEthUsdOhlc,
  coingeckoOhlcToChart,
  TIMEFRAME_TO_DAYS,
  hasCoingeckoApiKey,
} from "@/lib/coingecko";
import type { CandlestickData, HistogramData, UTCTimestamp } from "lightweight-charts";

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

type ChartData = {
  candles: CandlestickData<UTCTimestamp>[];
  volume: HistogramData<UTCTimestamp>[];
  summary: { open: number; high: number; low: number; close: number; volumePct: number; amplitudePct: number };
};

function getMockChartData(timeframe: (typeof TIMEFRAMES)[number]): ChartData {
  const { candles, volume } = generateCandleData(
    BASE_PRICE,
    CANDLE_COUNT,
    INTERVAL_MIN[timeframe]
  );
  const s = getOhlcvSummary(candles);
  return {
    candles,
    volume,
    summary: { ...s, volumePct: 0.02, amplitudePct: s.amplitudePct || 0.33 },
  };
}

export function PriceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("1M");
  const [activeTab, setActiveTab] = useState<"Price" | "Funding">("Price");
  const [chartData, setChartData] = useState<ChartData>(() => getMockChartData("1M"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (tf: (typeof TIMEFRAMES)[number]) => {
    if (!hasCoingeckoApiKey()) {
      setChartData(getMockChartData(tf));
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const days = TIMEFRAME_TO_DAYS[tf] ?? 7;
    try {
      const raw = await fetchEthUsdOhlc(days);
      const { candles, volume } = coingeckoOhlcToChart(raw);
      const summary = getOhlcvSummary(candles);
      setChartData({
        candles,
        volume,
        summary: { ...summary, volumePct: 0.02, amplitudePct: summary.amplitudePct || 0 },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load chart data");
      setChartData(getMockChartData(tf));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(timeframe);
  }, [timeframe, loadData]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0f172a" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
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

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
    // Chart is created per timeframe; data updates are applied in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chartData applied in separate effect
  }, [timeframe]);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || !chartData.candles.length) return;
    candleSeries.setData(chartData.candles);
    volumeSeries.setData(chartData.volume);
    chart.timeScale().fitContent();
  }, [chartData.candles, chartData.volume]);

  const formatPrice = (p: number) => p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const utcTime = new Date().toISOString().slice(11, 19) + " UTC";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Top controls - square buttons, no borders */}
      <div className="flex items-center justify-between gap-2 border-b border-[#363d4a] py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1.5 text-[#7d8590] hover:bg-[#363d4a] hover:text-[#c8cdd4]"
            title="Drawing tools"
            aria-label="Drawing tools"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            type="button"
            className="p-1.5 text-[#7d8590] hover:bg-[#363d4a] hover:text-[#c8cdd4]"
            title="Layout"
            aria-label="Layout"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
            </svg>
          </button>
          <div className="ml-1 flex bg-[#2a303c] p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-2 py-1 text-xs font-medium ${timeframe === tf ? "bg-[#3d4a5c] text-white" : "text-[#7d8590] hover:text-[#c8cdd4]"}`}
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
            className={`px-2 py-1 text-xs font-medium ${activeTab === "Price" ? "text-[#5b6b7a]" : "text-[#7d8590] hover:text-[#c8cdd4]"}`}
          >
            Price
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("Funding")}
            className={`px-2 py-1 text-xs font-medium ${activeTab === "Funding" ? "text-[#5b6b7a]" : "text-[#7d8590] hover:text-[#c8cdd4]"}`}
          >
            Funding
          </button>
          <div className="flex gap-0.5">
            {["screenshot", "filter", "settings", "fullscreen", "share"].map((t) => (
              <button
                key={t}
                type="button"
                className="p-1.5 text-[#7d8590] hover:bg-[#363d4a] hover:text-[#c8cdd4]"
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
      <div className="flex flex-wrap items-center gap-4 border-b border-[#363d4a] px-2 py-1.5 text-xs text-[#7d8590]">
        {loading && <span className="text-amber-400">Loading…</span>}
        {error && <span className="text-red-400" title={error}>Error (showing mock)</span>}
        {!loading && hasCoingeckoApiKey() && !error && <span className="text-emerald-500/90">ETH/USD · CoinGecko</span>}
        <span><strong className="text-[#c8cdd4]">Open:</strong> {formatPrice(chartData.summary.open)}</span>
        <span><strong className="text-[#c8cdd4]">High:</strong> {formatPrice(chartData.summary.high)}</span>
        <span><strong className="text-[#c8cdd4]">Low:</strong> {formatPrice(chartData.summary.low)}</span>
        <span><strong className="text-[#c8cdd4]">Close:</strong> {formatPrice(chartData.summary.close)}</span>
        <span><strong className="text-[#c8cdd4]">Volume:</strong> {chartData.summary.volumePct}%</span>
        <span><strong className="text-[#c8cdd4]">Amplitude:</strong> {chartData.summary.amplitudePct.toFixed(2)}%</span>
      </div>

      {/* Chart - fills remaining height, no gap below */}
      <div ref={containerRef} className="min-h-0 h-full w-full flex-1 self-stretch" />

      {/* Bottom bar */}
      <div className="flex items-center justify-between border-t border-[#363d4a] px-2 py-1 text-xs text-[#7d8590]">
        <span>{utcTime}</span>
        <div className="flex items-center gap-2">
          <button type="button" className="hover:text-[#c8cdd4]">%</button>
          <button type="button" className="hover:text-[#c8cdd4]">Log</button>
          <button type="button" className="text-[#5b6b7a]">auto</button>
          <button type="button" className="p-0.5 hover:bg-[#363d4a]" aria-label="Settings">
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
