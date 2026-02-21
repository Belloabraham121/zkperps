/**
 * Main chart area: price chart only.
 */
import { PriceChart } from "./PriceChart";

export function ChartBox() {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border border-b-0 border-r-0 border-[#262626] bg-[#111111]">
      <PriceChart />
    </section>
  );
}
