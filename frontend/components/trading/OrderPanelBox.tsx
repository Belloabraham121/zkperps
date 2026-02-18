/**
 * Prep: Order placement panel box.
 * Assign: Limit/Market/Conditional, Isolated/Cross, Leverage, Amount, TP/SL, Buy/Sell.
 */
export function OrderPanelBox() {
  return (
    <aside className="flex w-80 shrink-0 flex-col border border-violet-500/50 bg-violet-950/30 p-3">
      <span className="mb-2 text-sm font-medium text-violet-200/90">[Order Panel]</span>
      <div className="flex flex-1 flex-col items-center justify-center rounded border border-dashed border-violet-500/40 bg-violet-950/20 text-center text-xs text-violet-300/60">
        Limit · Market · Conditional
        <br />
        Leverage · Amount · Buy / Sell
      </div>
    </aside>
  );
}
