"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  LineController,
  BarController,
  TimeScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { Chart } from "react-chartjs-2";
import { generateCandleData, getOhlcvSummary } from "@/lib/chart-data";
import type { OHLCPoint, VolumePoint } from "@/lib/chart-data";
import {
  fetchEthUsdOhlc,
  coingeckoOhlcToChart,
  TIMEFRAME_TO_DAYS,
  hasCoingeckoApiKey,
} from "@/lib/coingecko";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  LineController,
  BarController,
  TimeScale,
  Tooltip,
  Legend,
  Filler
);

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

type ChartDataState = {
  points: OHLCPoint[];
  volume: VolumePoint[];
  summary: { open: number; high: number; low: number; close: number; volumePct: number; amplitudePct: number };
};

function getMockChartData(timeframe: (typeof TIMEFRAMES)[number]): ChartDataState {
  const { points, volume } = generateCandleData(
    BASE_PRICE,
    CANDLE_COUNT,
    INTERVAL_MIN[timeframe]
  );
  const s = getOhlcvSummary(points);
  return {
    points,
    volume,
    summary: { ...s, volumePct: 0.02, amplitudePct: s.amplitudePct || 0.33 },
  };
}

export function PriceChart() {
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>("1M");
  const [activeTab, setActiveTab] = useState<"Price" | "Funding">("Price");
  const [chartData, setChartData] = useState<ChartDataState>(() => getMockChartData("1M"));
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
      const { points, volume } = coingeckoOhlcToChart(raw);
      const summary = getOhlcvSummary(points);
      setChartData({
        points,
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

  const chartDataConfig = useMemo(() => {
    const { points, volume } = chartData;
    const priceData = points.map((p) => ({ x: p.time * 1000, y: p.close }));
    const volumeData = volume.map((v) => ({ x: v.time * 1000, y: v.value }));
    return {
      datasets: [
        {
          type: "line" as const,
          label: "Price",
          data: priceData,
          borderColor: "#22c55e",
          backgroundColor: "rgba(34, 197, 94, 0.1)",
          fill: true,
          yAxisID: "y",
          tension: 0.1,
          pointRadius: 0,
          pointHoverRadius: 4,
        },
        {
          type: "bar" as const,
          label: "Volume",
          data: volumeData,
          backgroundColor: "rgba(38, 166, 154, 0.5)",
          yAxisID: "y1",
          order: 0,
        },
      ],
    };
  }, [chartData.points, chartData.volume]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1e293b",
          titleColor: "#94a3b8",
          bodyColor: "#c8cdd4",
          callbacks: {
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
              ctx.dataset.label === "Price"
                ? `$${ctx.parsed.y.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `Vol: ${ctx.parsed.y.toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          type: "time" as const,
          time: { unit: "minute" as const },
          grid: { color: "#1e293b" },
          ticks: { color: "#94a3b8", maxTicksLimit: 8 },
        },
        y: {
          type: "linear" as const,
          position: "left" as const,
          grid: { color: "#1e293b" },
          ticks: { color: "#94a3b8" },
        },
        y1: {
          type: "linear" as const,
          position: "right" as const,
          grid: { drawOnChartArea: false },
          ticks: { color: "#64748b", maxTicksLimit: 4 },
        },
      },
    }),
    []
  );

  const formatPrice = (p: number) =>
    p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const utcTime = new Date().toISOString().slice(11, 19) + " UTC";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Top controls */}
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

      {/* Chart - Chart.js */}
      <div className="min-h-50 h-full w-full flex-1 self-stretch bg-[#0f172a]">
        <Chart type="line" data={chartDataConfig} options={chartOptions} />
      </div>

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
