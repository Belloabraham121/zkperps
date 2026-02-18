/**
 * Prep: Main chart area box (candlestick chart + depth / trade book).
 * Assign: Timeframes, Price/Funding tabs, chart tools, candlestick chart, depth chart.
 */
export function ChartBox() {
  return (
    <section className="flex min-h-0 flex-1 flex-col border border-blue-500/50 bg-blue-950/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-blue-200/90">[Chart / Graph]</span>
        <span className="text-xs text-blue-400/70">1M · 15M · 1H · 1D · 1W · Price · Funding · Tools</span>
      </div>
      <div className="flex flex-1 items-center justify-center rounded border border-dashed border-blue-500/40 bg-blue-950/20 text-blue-300/60">
        Candlestick chart + Depth chart area
      </div>
    </section>
  );
}
