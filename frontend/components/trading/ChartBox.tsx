/**
 * Main chart area: candlestick chart + depth / trade book.
 */
import { PriceChart } from "./PriceChart";
import { DepthChart } from "./DepthChart";

export function ChartBox() {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-blue-500/30 bg-slate-900/50">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1">
          <PriceChart />
        </div>
        <div className="flex min-h-0 w-56 shrink-0 flex-col overflow-hidden">
          <DepthChart />
        </div>
      </div>
    </section>
  );
}
