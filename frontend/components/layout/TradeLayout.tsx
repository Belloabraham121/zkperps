"use client";

/**
 * Trade page layout.
 * Structure: Navbar → Market bar → [ Chart | Leverage/Size/Margin order panel ] → [resize handle] → Positions (resizable height)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { NavbarBox } from "./NavbarBox";
import { MarketInfoBarBox } from "./MarketInfoBarBox";
import { ChartBox } from "../trading/ChartBox";
import { OrderPanelBox } from "../trading/OrderPanelBox";
import { AccountSummaryBox } from "../trading/AccountSummaryBox";
import { PositionsPanelBox } from "../trading/PositionsPanelBox";

const BOTTOM_SECTION_MIN_H = 160;
const BOTTOM_SECTION_MAX_H = 600;
const BOTTOM_SECTION_DEFAULT_H = 320;

export function TradeLayout() {
  const bottomSectionRef = useRef<HTMLDivElement>(null);
  const [bottomSectionHeight, setBottomSectionHeight] = useState(BOTTOM_SECTION_DEFAULT_H);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const el = bottomSectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Distance from top of bottom section to cursor = desired height
      const y = e.clientY - rect.top;
      const h = Math.round(Math.max(BOTTOM_SECTION_MIN_H, Math.min(BOTTOM_SECTION_MAX_H, y)));
      setBottomSectionHeight(h);
    };

    const onMouseUp = () => setIsDragging(false);

    document.addEventListener("mousemove", onMouseMove, { capture: true });
    document.addEventListener("mouseup", onMouseUp, { capture: true });
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMouseMove, { capture: true });
      document.removeEventListener("mouseup", onMouseUp, { capture: true });
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  return (
    <div className="flex h-screen flex-col bg-[#1a1e26] text-[#c8cdd4]">
      <NavbarBox />
      <MarketInfoBarBox />
      {/* Chart row: chart + order panel (leverage, size, margin) beside it */}
      <div className="flex min-h-70 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChartBox />
        </div>
        <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-[#363d4a]">
          <OrderPanelBox />
          <AccountSummaryBox />
        </div>
      </div>
      {/* Resize handle: drag up/down to change height of positions & open orders */}
      <div
        role="separator"
        aria-label="Resize positions and open orders height"
        onMouseDown={handleMouseDown}
        className={`flex h-3 shrink-0 cursor-ns-resize items-center justify-center border-y border-[#363d4a] bg-[#21262e] hover:bg-[#363d4a] active:bg-[#363d4a] select-none ${isDragging ? "bg-[#475569]" : ""}`}
      >
        <span className="h-1 w-10 rounded-full bg-[#64748b]" />
      </div>
      {/* Positions + open orders section (resizable height by dragging the bar above) */}
      <div
        ref={bottomSectionRef}
        className="flex min-h-0 shrink-0 overflow-hidden border-t border-[#363d4a]"
        style={{ height: bottomSectionHeight }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PositionsPanelBox />
        </div>
      </div>
    </div>
  );
}
