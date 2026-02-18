/**
 * Prep: Trade page layout — all section boxes with distinct colors for assignment.
 * Structure: Navbar → Market bar → (Chart | Order+Account) → Positions panel
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
      <div className="flex min-h-0 flex-1">
        <ChartBox />
        <div className="flex shrink-0 flex-col border-l border-neutral-700">
          <OrderPanelBox />
          <AccountSummaryBox />
        </div>
      </div>
      <PositionsPanelBox />
    </div>
  );
}
