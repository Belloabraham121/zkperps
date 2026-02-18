/**
 * Prep: Account summary / deposit panel box.
 * Assign: Trading account dropdown, Deposit, Equity, Available, Margin Health, Leverage.
 */
export function AccountSummaryBox() {
  return (
    <aside className="flex w-80 shrink-0 flex-col border border-cyan-500/50 bg-cyan-950/30 p-3">
      <span className="mb-2 text-sm font-medium text-cyan-200/90">[Account Summary]</span>
      <div className="flex flex-1 flex-col items-center justify-center rounded border border-dashed border-cyan-500/40 bg-cyan-950/20 text-center text-xs text-cyan-300/60">
        Trading Account · Deposit
        <br />
        Equity · Balance · Margin · Leverage
      </div>
    </aside>
  );
}
