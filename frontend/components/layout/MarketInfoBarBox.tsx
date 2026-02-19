/**
 * Market information bar: trading pair, price, 24h change, Open Interest, Funding Rate, Skew.
 */
export function MarketInfoBarBox() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-4 border-b border-neutral-700 bg-neutral-900/80 px-4">
      {/* Trading pair + current price */}
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-amber-500/20">
          <span className="text-sm" aria-hidden>₿</span>
        </div>
        <span className="font-medium text-slate-200">BTCUSD</span>
        <span className="font-medium text-green-400">$27,554.00</span>
        <button
          type="button"
          className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-slate-200"
          aria-label="Market details"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
      </div>

      <div className="h-5 w-px shrink-0 bg-neutral-600" aria-hidden />

      {/* 24h Change */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">24h Change</span>
        <span className="text-sm font-medium text-green-400">$175.00 0.30%</span>
      </div>

      <div className="h-5 w-px shrink-0 bg-neutral-600" aria-hidden />

      {/* Open Interest */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">Open Interest</span>
        <span className="text-sm font-medium text-slate-200">$12.5M/$15.4M</span>
      </div>

      <div className="h-5 w-px shrink-0 bg-neutral-600" aria-hidden />

      {/* Funding Rate */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">Funding Rate</span>
        <span className="text-sm font-medium text-amber-400">0.005%</span>
      </div>

      <div className="h-5 w-px shrink-0 bg-neutral-600" aria-hidden />

      {/* Skew */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500">Skew</span>
        <span className="text-sm font-medium">
          <span className="text-green-400">50.32%</span>
          <span className="text-neutral-500">/</span>
          <span className="text-red-400">49.68%</span>
        </span>
      </div>
    </div>
  );
}
