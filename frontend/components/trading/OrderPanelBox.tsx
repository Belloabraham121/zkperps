"use client";

import { useState } from "react";

type OrderType = "limit" | "market" | "conditional";
type MarginMode = "isolated" | "cross";
type Side = "long" | "short";

const LEVERAGE_MIN = 1;
const LEVERAGE_MAX = 10;

export function OrderPanelBox() {
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [marginMode, setMarginMode] = useState<MarginMode>("isolated");
  const [side, setSide] = useState<Side>("long");
  const [leverage, setLeverage] = useState(10);
  const [size, setSize] = useState("");
  const [margin, setMargin] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [triggerBy, setTriggerBy] = useState<"mark" | "last">("mark");
  const [showTpSl, setShowTpSl] = useState(false);
  const [errors, setErrors] = useState<{ size?: string; margin?: string; limitPrice?: string; triggerPrice?: string }>({});

  const validate = (): boolean => {
    const next: typeof errors = {};
    const sizeNum = parseFloat(size);
    if (size === "" || isNaN(sizeNum) || sizeNum <= 0) {
      next.size = "Enter size";
    }
    const marginNum = parseFloat(margin);
    if (margin === "" || isNaN(marginNum) || marginNum < 0) {
      next.margin = "Enter margin";
    }
    if (orderType === "limit") {
      const lp = parseFloat(limitPrice);
      if (limitPrice === "" || isNaN(lp) || lp <= 0) next.limitPrice = "Enter limit price";
    }
    if (orderType === "conditional") {
      const tp = parseFloat(triggerPrice);
      if (triggerPrice === "" || isNaN(tp) || tp <= 0) next.triggerPrice = "Enter trigger price";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleOpenPosition = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const chosenSide = submitter?.getAttribute("data-side") as Side | null;
    if (chosenSide) setSide(chosenSide);
    if (!validate()) return;
    // TODO: wire to API / contract (submitCommitment, etc.)
    console.log("Open position", {
      side: chosenSide ?? side,
      orderType,
      marginMode,
      leverage,
      size,
      margin,
      ...(orderType === "limit" && { limitPrice }),
      ...(orderType === "conditional" && { triggerBy, triggerPrice }),
    });
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col border-b border-[#363d4a] bg-[#21262e] p-3">
      <form onSubmit={handleOpenPosition} className="flex flex-col gap-3">
        {/* Order type: Limit | Market | Conditional - square tabs, no border */}
        <div className="flex bg-[#2a303c] p-0.5">
          {(["limit", "market", "conditional"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOrderType(t)}
              className={`flex-1 px-2 py-1.5 text-xs font-medium capitalize ${
                orderType === t ? "bg-[#3d4a5c] text-white" : "text-[#7d8590] hover:text-[#c8cdd4]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Margin mode: Isolated | Cross - square tabs, no border */}
        <div className="flex bg-[#2a303c] p-0.5">
          {(["isolated", "cross"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMarginMode(m)}
              className={`flex-1 px-2 py-1.5 text-xs font-medium capitalize ${
                marginMode === m ? "bg-[#3d4a5c] text-white" : "text-[#7d8590] hover:text-[#c8cdd4]"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Limit: show limit price */}
        {orderType === "limit" && (
          <div>
            <label className="mb-1 block text-xs text-[#7d8590]">Limit price</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className={`w-full border bg-[#2a303c] px-2 py-1.5 text-sm text-[#c8cdd4] placeholder:text-[#7d8590] ${
                errors.limitPrice ? "border-[#b54a4a]" : "border-[#363d4a]"
              }`}
            />
            {errors.limitPrice && <p className="mt-0.5 text-xs text-[#b54a4a]">{errors.limitPrice}</p>}
          </div>
        )}

        {/* Conditional: trigger by + trigger price - square tabs */}
        {orderType === "conditional" && (
          <div className="space-y-2 border border-[#363d4a] bg-[#2a303c] p-2">
            <div className="text-xs font-medium text-[#7d8590]">Trigger</div>
            <div className="flex bg-[#21262e] p-0.5">
              <button
                type="button"
                onClick={() => setTriggerBy("mark")}
                className={`flex-1 px-2 py-1 text-xs capitalize ${
                  triggerBy === "mark" ? "bg-[#3d4a5c] text-white" : "text-[#7d8590] hover:text-[#c8cdd4]"
                }`}
              >
                Mark price
              </button>
              <button
                type="button"
                onClick={() => setTriggerBy("last")}
                className={`flex-1 px-2 py-1 text-xs capitalize ${
                  triggerBy === "last" ? "bg-[#3d4a5c] text-white" : "text-[#7d8590] hover:text-[#c8cdd4]"
                }`}
              >
                Last price
              </button>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#7d8590]">Trigger price</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
                className={`w-full border bg-[#2a303c] px-2 py-1.5 text-sm text-[#c8cdd4] placeholder:text-[#7d8590] ${
                  errors.triggerPrice ? "border-[#b54a4a]" : "border-[#363d4a]"
                }`}
              />
              {errors.triggerPrice && <p className="mt-0.5 text-xs text-[#b54a4a]">{errors.triggerPrice}</p>}
            </div>
          </div>
        )}

        {/* Leverage: 1x–10x */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-[#7d8590]">Leverage</span>
            <span className="font-medium text-[#c8cdd4]">{leverage}x</span>
          </div>
          <input
            type="range"
            min={LEVERAGE_MIN}
            max={LEVERAGE_MAX}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="h-2 w-full accent-[#5b6b7a]"
          />
        </div>

        {/* Size */}
        <div>
          <label className="mb-1 block text-xs text-[#7d8590]">Size</label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className={`w-full border bg-[#2a303c] px-2 py-1.5 text-sm text-[#c8cdd4] placeholder:text-[#7d8590] ${
              errors.size ? "border-[#b54a4a]" : "border-[#363d4a]"
            }`}
          />
          {errors.size && <p className="mt-0.5 text-xs text-[#b54a4a]">{errors.size}</p>}
          <div className="mt-1 flex gap-1">
            {[10, 25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setSize("")}
                className="px-1.5 py-0.5 text-xs text-[#7d8590] hover:bg-[#363d4a] hover:text-[#c8cdd4]"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Margin (label changes by Isolated / Cross) */}
        <div>
          <label className="mb-1 block text-xs text-[#7d8590]">
            Margin {marginMode === "isolated" ? "(Isolated)" : "(Cross)"}
          </label>
          {marginMode === "isolated" && (
            <p className="mb-1 text-[10px] text-[#7d8590]">Risk limited to this position’s margin</p>
          )}
          {marginMode === "cross" && (
            <p className="mb-1 text-[10px] text-[#7d8590]">Uses shared account margin</p>
          )}
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            className={`w-full border bg-[#2a303c] px-2 py-1.5 text-sm text-[#c8cdd4] placeholder:text-[#7d8590] ${
              errors.margin ? "border-[#b54a4a]" : "border-[#363d4a]"
            }`}
          />
          {errors.margin && <p className="mt-0.5 text-xs text-[#b54a4a]">{errors.margin}</p>}
        </div>

        {/* Take Profit / Stop Loss (optional) */}
        <div>
          <button
            type="button"
            onClick={() => setShowTpSl(!showTpSl)}
            className="text-xs text-[#7d8590] hover:text-[#c8cdd4]"
          >
            {showTpSl ? "−" : "+"} Take Profit / Stop Loss
          </button>
          {showTpSl && (
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                placeholder="TP"
                className="w-full border border-[#363d4a] bg-[#2a303c] px-2 py-1 text-xs text-[#c8cdd4] placeholder:text-[#7d8590]"
              />
              <input
                type="text"
                placeholder="SL"
                className="w-full border border-[#363d4a] bg-[#2a303c] px-2 py-1 text-xs text-[#c8cdd4] placeholder:text-[#7d8590]"
              />
            </div>
          )}
        </div>

        {/* Open Long / Open Short - square, no border */}
        <div className="flex gap-2">
          <button
            type="submit"
            name="side"
            data-side="long"
            className="flex-1 bg-[#2d5a4a] py-2 text-sm font-medium text-white hover:bg-[#3d6a5a]"
          >
            Open Long
          </button>
          <button
            type="submit"
            name="side"
            data-side="short"
            className="flex-1 bg-[#5a3d3d] py-2 text-sm font-medium text-white hover:bg-[#6a4d4d]"
          >
            Open Short
          </button>
        </div>

        {/* Placeholder summary */}
        <div className="grid grid-cols-2 gap-1 text-xs text-[#7d8590]">
          <span>Value</span>
          <span className="text-right">—</span>
          <span>Cost</span>
          <span className="text-right">—</span>
          <span>Est. Liq. Price</span>
          <span className="text-right">—</span>
        </div>
      </form>
    </aside>
  );
}
