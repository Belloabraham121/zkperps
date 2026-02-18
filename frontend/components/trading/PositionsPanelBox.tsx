/**
 * Prep: Positions and order history panel box.
 * Assign: Positions, Open Orders, Position History, P&L, Order/Trade history tables.
 */
export function PositionsPanelBox() {
  return (
    <section className="flex h-56 shrink-0 flex-col border-t border-rose-500/50 bg-rose-950/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-rose-200/90">[Positions / Order History]</span>
        <span className="text-xs text-rose-400/70">Positions · Open Orders · History · P&L · Trades</span>
      </div>
      <div className="flex flex-1 items-center justify-center rounded border border-dashed border-rose-500/40 bg-rose-950/20 text-rose-300/60 text-sm">
        Positions table · Order history · Trade history
      </div>
    </section>
  );
}
