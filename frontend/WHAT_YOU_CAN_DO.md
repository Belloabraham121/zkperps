# What You Can Do on the Frontend (and How)

This document describes **what is actually implemented and working** on the trade page, and what is UI-only or not yet wired.

---

## What works end-to-end

### 1. **Market orders (open long / open short)**

- **What:** Place a **market** order to open a long or short position.
- **How:**
  1. Set **Order type** to **Market** (default).
  2. Choose **Margin mode**: Isolated or Cross (display only for now; risk text is correct).
  3. Set **Leverage** with the slider (1x–10x). This is sent to the contract and **works**.
  4. Enter **Size** (e.g. `0.1` for 0.1 ETH). This is sent and **works**.
  5. Enter **Margin** (e.g. `100` USDC). This is your collateral and **works**.
  6. Click **Open Long** or **Open Short**.

- **Under the hood:** The app builds a `PerpIntent` (user, market, size, isLong, isOpen, collateral, leverage, nonce, deadline), then:
  - Calls backend `POST /api/perp/compute-commitment-hash` → get commitment hash.
  - Calls `POST /api/perp/commit` with that hash → on-chain commit.
  - Calls `POST /api/perp/reveal` with the intent → on-chain reveal.

- **Important:** Your position is **not** open immediately. It is included in the next **batch** (after the batch interval, e.g. 5 minutes). Someone (you or another flow) must call **Execute batch** with the right commitment hashes for the batch to settle and your position to show.

---

### 2. **Leverage**

- **Works:** The leverage slider (1x–10x) is sent in the intent as 18-decimal fixed point and is used by the contract.
- **Where:** Order panel → “Leverage” slider.

---

### 3. **Size**

- **Works:** The “Size” field is your position size (e.g. in base asset like ETH). It is converted to 18-decimal and sent in the intent.
- **Where:** Order panel → “Size” input.

---

### 4. **Margin (collateral)**

- **Works:** The “Margin” field is your collateral (e.g. USDC). It is converted to 6 decimals and sent as `collateral` in the intent.
- **Where:** Order panel → “Margin” input.

---

### 5. **Viewing positions**

- **What:** See your open position for the default market (ETH).
- **How:** Positions panel → “Positions” tab. Data comes from `GET /api/perp/position`.
- **Works:** Size, entry price, collateral, leverage are read from the contract and displayed. Refreshes every 10 seconds.

---

### 6. **Closing a position**

- **What:** Close your full position via the same commit–reveal flow.
- **How:** Positions panel → “Close” on the position row.
- **Works:** The app builds a close intent (same size, `isOpen: false`, `collateral: 0`) and runs commit + reveal. Again, the position is actually closed when the batch that includes this reveal is executed.

---

### 7. **Account summary (collateral)**

- **What:** Total collateral and available margin.
- **How:** Shown in the account summary area; data from `GET /api/perp/collateral`.
- **Works:** Reads from the contract; refetches periodically.

---

### 8. **Deposit collateral (backend only)**

- **What:** Add USDC to your perp account so you can open positions.
- **How:** There is no dedicated “Deposit” button on the trade page yet. You can use the generic trade/send flow: approve USDC to the PerpPositionManager, then send `depositCollateral(user, amount)`.
- **Backend:** Use `POST /api/trade/send` with the right `to` and `data` (e.g. from backend deposit helpers). So **deposit works at the API level**; the frontend just doesn’t have a dedicated deposit UI yet.

---

## What is UI-only (not sent to the contract)

### 1. **Limit orders**

- **UI:** You can select “Limit” and enter a “Limit price”.
- **Reality:** Limit price is **not** sent to the backend or contract. The contract only has commit–reveal intents (size, side, collateral, leverage, etc.); there is no resting limit order book or “execute at limit price” in the current flow.
- **So:** Choosing “Limit” and clicking Open Long/Short still sends a **market**-style intent; the limit price is ignored.

---

### 2. **Conditional orders**

- **UI:** You can select “Conditional” and set “Trigger by” (Mark/Last) and “Trigger price”.
- **Reality:** Trigger price and trigger type are **not** sent to the backend or contract. No conditional execution is implemented.
- **So:** Same as limit: you still submit a normal intent; trigger settings are ignored.

---

### 3. **Take profit / stop loss (TP/SL)**

- **UI:** There is a “Take Profit / Stop Loss” section with TP and SL inputs.
- **Reality:** TP/SL are **not** sent or stored anywhere. No automation.
- **So:** Purely cosmetic for now.

---

### 4. **Margin mode (Isolated vs Cross)**

- **UI:** You can toggle Isolated vs Cross and see different risk text.
- **Reality:** The contract intent does not include a “margin mode” field. All behavior is effectively one mode (isolated-like) on-chain.
- **So:** Display-only; doesn’t change the intent.

---

## What is not implemented yet

- **Execute batch from the UI:** The app can commit and reveal, but there is no button to call “Execute batch” with the current batch’s commitment hashes. So you need another way (e.g. script or future UI) to run the batch so that your position actually opens or closes.
- **Deposit/Withdraw UI:** No modal or form that calls the deposit (or withdraw) flow; only backend/API support.
- **Order history / Trade history / Position history:** Tabs exist but show placeholders.
- **Real-time mark price / PnL:** No live price feed or unrealized PnL from mark price.
- **Liquidation price:** Placeholder “Est. Liq. Price” only; not calculated.
- **Value / Cost summary:** Placeholder “—” in the order panel; not computed from size and price.

---

## Quick reference: what actually hits the contract

| Feature        | In UI | Sent to backend/contract | Notes                          |
|----------------|-------|---------------------------|--------------------------------|
| Market order   | Yes   | Yes                       | Commit + reveal                |
| Limit order    | Yes   | No                        | Limit price ignored            |
| Conditional    | Yes   | No                        | Trigger ignored                |
| Leverage       | Yes   | Yes                       | 1x–10x slider                  |
| Size           | Yes   | Yes                       | Position size                  |
| Margin         | Yes   | Yes                       | Collateral                     |
| Long/Short     | Yes   | Yes                       | Side of trade                  |
| Close position | Yes   | Yes                       | Commit + reveal (close intent) |
| Positions      | Yes   | Read-only                 | From contract                  |
| Collateral     | Yes   | Read-only                 | From contract                  |
| TP/SL          | Yes   | No                        | Not implemented                |
| Execute batch  | No    | Yes (API exists)          | No UI button yet               |
| Deposit        | No    | Yes (API exists)          | No dedicated UI                |

---

## Summary

- **Actually works:** Market open (long/short) with **leverage**, **size**, and **margin**; viewing **positions** and **collateral**; **closing** a position (commit + reveal). All of that uses the real backend and contract.
- **Looks like it works but doesn’t:** Limit price, conditional trigger, TP/SL, and margin mode are UI-only and not used on-chain.
- **Missing for a full flow:** Execute-batch from the UI, and a dedicated deposit (and optionally withdraw) flow on the trade page.

So: **audacity (actually)** — market orders with leverage, size, and margin **do** work; limits, conditionals, and TP/SL do not. Closing and reading positions/collateral also work.
