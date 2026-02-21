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
  const [bottomSectionHeight, setBottomSectionHeight] = useState(BOTTOM_SECTION_DEFAULT_H);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartRef.current = {
      y: e.clientY,
      height: bottomSectionHeight,
    };
  }, [bottomSectionHeight]);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const { y: startY, height: startHeight } = dragStartRef.current;
      const deltaY = startY - e.clientY; // Moving cursor up increases height

      const newHeight = Math.round(
        Math.max(BOTTOM_SECTION_MIN_H, Math.min(BOTTOM_SECTION_MAX_H, startHeight + deltaY))
      );
      setBottomSectionHeight(newHeight);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

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
    <div className="flex h-screen flex-col bg-[#0a0a0a] text-white">
      <NavbarBox />
      <MarketInfoBarBox />
      {/* Chart row: chart + order panel (leverage, size, margin) beside it */}
      <div className="flex min-h-70 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChartBox />

          {/* Resize handle: drag up/down to change height of positions & open orders */}
          <div
            role="separator"
            aria-label="Resize positions and open orders height"
            onMouseDown={handleMouseDown}
            className={`flex h-3 shrink-0 cursor-ns-resize items-center justify-center border-y border-[#262626] bg-[#111111] hover:bg-[#262626] active:bg-[#262626] select-none ${isDragging ? "bg-[#333333]" : ""}`}
          >
            <span className="h-1 w-10 rounded-full bg-white/30" />
          </div>

          {/* Positions + open orders section (resizable height by dragging the bar above) */}
          <div
            className="flex min-h-0 shrink-0 overflow-hidden"
            style={{ height: bottomSectionHeight }}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <PositionsPanelBox />
            </div>
          </div>
        </div>
        <div className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-[#262626]">
          <OrderPanelBox />
          <AccountSummaryBox />
        </div>
      </div>
    </div>
  );
}
