# Trading Guide

How to deposit collateral, open positions, and use the perp trading UI.

---

## 1. Sign in

- Use **email (Privy)** to sign in.
- The app will create or link an embedded wallet and add the backend as a signer so orders can be sent without a popup.
- If you see an error about adding a signer, try refreshing the page or logging out and back in.

---

## 2. Deposit collateral

Before you can open a position, you need **collateral** (USDC) in your perp account.

- In the **Trading Account** / **Collateral** section (right panel), click **Deposit** or **Deposit collateral**.
- **Note:** The deposit flow (approve USDC → deposit into the PerpPositionManager) may still be a placeholder. If the button doesn’t do anything yet, collateral has to be deposited another way (e.g. script or backend) until the deposit modal is implemented.
- Once you have a balance, **Total deposited** shows your USDC in the perp account. **Available** is what you can use for new positions or withdraw.

---

## 3. Get gas (ETH)

- Your **embedded wallet** needs a small amount of **ETH on Arbitrum Sepolia** to pay gas for commit and reveal transactions.
- Use an [Arbitrum Sepolia faucet](https://faucet.quicknode.com/arbitrum/sepolia) (or similar) and send ETH to your wallet address.
- You can get your wallet address from the app when signed in, or from your backend (e.g. `GET /api/auth/me` or the `get-wallet-address.mjs` script).

---

## 4. Open a position

In the **order panel** (left):

1. **Leverage**  
   Choose 1x–10x. Higher leverage means less margin per unit of size and higher risk.

2. **Size (base asset)**  
   Enter how much of the base asset you want to trade (e.g. **0.1** for 0.1 ETH on ETH/USD).  
   This is the notional size of the position in base units.

3. **Margin**  
   Enter the **collateral in USDC** you want to lock for this position.  
   It should be at least the required margin: **required margin ≈ (size × price) ÷ leverage**.  
   Example: 0.1 ETH at $3,000 with 10x → notional $300 → margin ≈ $30 USDC.

4. **Open Long** or **Open Short**  
   - **Long** = you profit if the price goes up.  
   - **Short** = you profit if the price goes down.

5. Submit  
   Your order is submitted as a **commit** then a **reveal**. It is **executed in the next batch** (after the batch interval, or when the keeper runs), not instantly. You’ll see a success message with commit and reveal tx hashes.

---

## 5. After you open a position

- **Positions** panel shows your open position(s) (size, entry, margin, leverage).
- **Collateral** section updates: **Used in positions** increases, **Available** decreases.
- To **close** a position, use the Close action in the Positions panel (also commit/reveal, then settled in the next batch).

---

## 6. Withdraw collateral

- Click **Withdraw** in the Collateral section.
- You can only withdraw up to **Available** margin (total deposited minus used in positions).
- **Note:** The withdraw flow may still be a placeholder; if so, it will be implemented to call `withdrawCollateral(amount)` on the contract.

---

## Quick reference

| Term            | Meaning |
|-----------------|--------|
| **Deposit**     | Add USDC to your perp account so you can open positions (and meet margin). |
| **Withdraw**    | Send USDC from your perp account back to your wallet (up to available). |
| **Size**        | Position size in base asset (e.g. 0.1 ETH for ETH/USD). |
| **Margin**      | USDC collateral locked for that position; required ≈ (size × price) ÷ leverage. |
| **Available**   | USDC in your account that is not locked in positions (can open more or withdraw). |
| **Used in positions** | USDC locked as margin in open positions. |
| **Batch**       | Orders are executed together in batches; your order fills when the next batch runs (e.g. after the batch interval or when the keeper executes). |

---

## Troubleshooting

- **“Please sign in to place orders”** — Sign in with Privy (email).
- **“Authorization failed” / “addSigners”** — Refresh or log out and back in so the app can add the backend signer. Ensure the backend key quorum matches the app (see `backend/PRIVY_KEY_SETUP.md`).
- **“Insufficient funds” / “exceeds the balance”** — Your embedded wallet needs more ETH on Arbitrum Sepolia for gas. Use a faucet and send ETH to your wallet address.
- **“Enter size” / “Enter margin”** — Fill in both **Size** and **Margin** with positive numbers before submitting.
- **Order submitted but no position yet** — Positions open when the **batch** runs. Wait for the batch interval (or keeper); then the Positions panel and collateral numbers should update.
