/**
 * Main chart area: candlestick chart + depth / trade book.
 */
import { PriceChart } from "./PriceChart";
import { DepthChart } from "./DepthChart";

export function ChartBox() {
  return (
    <section className="flex min-h-0 flex-1 flex-col border border-blue-500/30 bg-slate-900/50">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <PriceChart />
        </div>
        <div className="w-56 shrink-0">
          <DepthChart />
        </div>
      </div>
    </section>
  );
}
