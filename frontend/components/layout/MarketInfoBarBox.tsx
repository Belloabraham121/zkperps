/**
 * Market information bar: trading pair, price, 24h change, Open Interest, Funding Rate, Skew.
 */
export function MarketInfoBarBox() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-4 border-b border-[#363d4a] bg-[#21262e] px-4">
      {/* Trading pair + current price */}
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center bg-[#4a3d2a]">
          <span className="text-sm text-[#c8a855]" aria-hidden>₿</span>
        </div>
        <span className="font-medium text-[#c8cdd4]">BTCUSD</span>
        <span className="font-medium text-[#4a9b6e]">$27,554.00</span>
        <button
          type="button"
          className="p-0.5 text-[#7d8590] hover:bg-[#363d4a] hover:text-[#c8cdd4]"
          aria-label="Market details"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>
      </div>

      <div className="h-5 w-px shrink-0 bg-[#363d4a]" aria-hidden />

      {/* 24h Change */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-[#7d8590]">24h Change</span>
        <span className="text-sm font-medium text-[#4a9b6e]">$175.00 0.30%</span>
      </div>

      <div className="h-5 w-px shrink-0 bg-[#363d4a]" aria-hidden />

      {/* Open Interest */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-[#7d8590]">Open Interest</span>
        <span className="text-sm font-medium text-[#c8cdd4]">$12.5M/$15.4M</span>
      </div>

      <div className="h-5 w-px shrink-0 bg-[#363d4a]" aria-hidden />

      {/* Funding Rate */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-[#7d8590]">Funding Rate</span>
        <span className="text-sm font-medium text-[#c8a855]">0.005%</span>
      </div>

      <div className="h-5 w-px shrink-0 bg-[#363d4a]" aria-hidden />

      {/* Skew */}
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-[#7d8590]">Skew</span>
        <span className="text-sm font-medium">
          <span className="text-[#4a9b6e]">50.32%</span>
          <span className="text-[#7d8590]">/</span>
          <span className="text-[#b54a4a]">49.68%</span>
        </span>
      </div>
    </div>
  );
}
