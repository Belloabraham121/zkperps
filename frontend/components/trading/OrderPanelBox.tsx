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
    <aside className="flex w-80 shrink-0 flex-col border-b border-neutral-700 bg-neutral-900/50 p-3">
      <form onSubmit={handleOpenPosition} className="flex flex-col gap-3">
        {/* Order type: Limit | Market | Conditional */}
        <div className="flex rounded border border-neutral-600 bg-neutral-800/80 p-0.5">
          {(["limit", "market", "conditional"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOrderType(t)}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium capitalize ${
                orderType === t ? "bg-neutral-600 text-white" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Margin mode: Isolated | Cross */}
        <div className="flex rounded border border-neutral-600 bg-neutral-800/80 p-0.5">
          {(["isolated", "cross"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMarginMode(m)}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium capitalize ${
                marginMode === m ? "bg-neutral-600 text-white" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Limit: show limit price */}
        {orderType === "limit" && (
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Limit price</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              className={`w-full rounded border bg-neutral-800/80 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 ${
                errors.limitPrice ? "border-red-500" : "border-neutral-600"
              }`}
            />
            {errors.limitPrice && <p className="mt-0.5 text-xs text-red-400">{errors.limitPrice}</p>}
          </div>
        )}

        {/* Conditional: trigger by + trigger price */}
        {orderType === "conditional" && (
          <div className="space-y-2 rounded border border-neutral-600 bg-neutral-800/50 p-2">
            <div className="text-xs font-medium text-neutral-400">Trigger</div>
            <div className="flex rounded border border-neutral-600 bg-neutral-800/80 p-0.5">
              <button
                type="button"
                onClick={() => setTriggerBy("mark")}
                className={`flex-1 rounded px-2 py-1 text-xs capitalize ${
                  triggerBy === "mark" ? "bg-neutral-600 text-white" : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Mark price
              </button>
              <button
                type="button"
                onClick={() => setTriggerBy("last")}
                className={`flex-1 rounded px-2 py-1 text-xs capitalize ${
                  triggerBy === "last" ? "bg-neutral-600 text-white" : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Last price
              </button>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-400">Trigger price</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
                className={`w-full rounded border bg-neutral-800/80 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 ${
                  errors.triggerPrice ? "border-red-500" : "border-neutral-600"
                }`}
              />
              {errors.triggerPrice && <p className="mt-0.5 text-xs text-red-400">{errors.triggerPrice}</p>}
            </div>
          </div>
        )}

        {/* Leverage: 1x–10x */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-neutral-400">Leverage</span>
            <span className="font-medium text-neutral-200">{leverage}x</span>
          </div>
          <input
            type="range"
            min={LEVERAGE_MIN}
            max={LEVERAGE_MAX}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="h-2 w-full accent-sky-500"
          />
        </div>

        {/* Size */}
        <div>
          <label className="mb-1 block text-xs text-neutral-400">Size</label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className={`w-full rounded border bg-neutral-800/80 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 ${
              errors.size ? "border-red-500" : "border-neutral-600"
            }`}
          />
          {errors.size && <p className="mt-0.5 text-xs text-red-400">{errors.size}</p>}
          <div className="mt-1 flex gap-1">
            {[10, 25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setSize("")}
                className="rounded border border-neutral-600 px-1.5 py-0.5 text-xs text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>

        {/* Margin (label changes by Isolated / Cross) */}
        <div>
          <label className="mb-1 block text-xs text-neutral-400">
            Margin {marginMode === "isolated" ? "(Isolated)" : "(Cross)"}
          </label>
          {marginMode === "isolated" && (
            <p className="mb-1 text-[10px] text-neutral-500">Risk limited to this position’s margin</p>
          )}
          {marginMode === "cross" && (
            <p className="mb-1 text-[10px] text-neutral-500">Uses shared account margin</p>
          )}
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            className={`w-full rounded border bg-neutral-800/80 px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 ${
              errors.margin ? "border-red-500" : "border-neutral-600"
            }`}
          />
          {errors.margin && <p className="mt-0.5 text-xs text-red-400">{errors.margin}</p>}
        </div>

        {/* Take Profit / Stop Loss (optional) */}
        <div>
          <button
            type="button"
            onClick={() => setShowTpSl(!showTpSl)}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            {showTpSl ? "−" : "+"} Take Profit / Stop Loss
          </button>
          {showTpSl && (
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                placeholder="TP"
                className="w-full rounded border border-neutral-600 bg-neutral-800/80 px-2 py-1 text-xs placeholder:text-neutral-500"
              />
              <input
                type="text"
                placeholder="SL"
                className="w-full rounded border border-neutral-600 bg-neutral-800/80 px-2 py-1 text-xs placeholder:text-neutral-500"
              />
            </div>
          )}
        </div>

        {/* Open Long / Open Short */}
        <div className="flex gap-2">
          <button
            type="submit"
            name="side"
            data-side="long"
            className="flex-1 rounded bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-500"
          >
            Open Long
          </button>
          <button
            type="submit"
            name="side"
            data-side="short"
            className="flex-1 rounded bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Open Short
          </button>
        </div>

        {/* Placeholder summary */}
        <div className="grid grid-cols-2 gap-1 text-xs text-neutral-500">
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
