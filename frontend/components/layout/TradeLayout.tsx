/**
 * Trade page layout.
 * Structure: Navbar → Market bar → [ (Chart + Depth) then Positions | Order + Account ]
 */
import { NavbarBox } from "./NavbarBox";
import { MarketInfoBarBox } from "./MarketInfoBarBox";
import { ChartBox } from "../trading/ChartBox";
import { OrderPanelBox } from "../trading/OrderPanelBox";
import { AccountSummaryBox } from "../trading/AccountSummaryBox";
import { PositionsPanelBox } from "../trading/PositionsPanelBox";

export function TradeLayout() {
  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <NavbarBox />
      <MarketInfoBarBox />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left section: chart + depth flush above positions, no gap */}
        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
          <ChartBox />
          <PositionsPanelBox />
        </div>
        {/* Right section: order panel + account summary */}
        <div className="flex shrink-0 flex-col border-l border-neutral-700 overflow-y-auto">
          <OrderPanelBox />
          <AccountSummaryBox />
        </div>
      </div>
    </div>
  );
}
