/**
 * Prep: Market information bar section box.
 * Assign: Trading pair, price, 24h change, Open Interest, Funding Rate, Skew.
 */
export function MarketInfoBarBox() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-6 border-b border-emerald-500/50 bg-emerald-950/40 px-4">
      <span className="text-sm font-medium text-emerald-200/90">[Market Info Bar]</span>
      <span className="text-xs text-emerald-400/70">Pair · Price · 24h Change · OI · Funding · Skew</span>
    </div>
  );
}
