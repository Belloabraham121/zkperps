# Perp API Frontend Integration

This document describes the frontend integration with the backend Perp API.

## Overview

The frontend now fully integrates with the backend Perp API endpoints, allowing users to:
- Open perpetual futures positions (long/short)
- View their positions in real-time
- Close positions
- View account collateral and balances
- Submit orders via commit-reveal flow

## Files Created

### API Client
- **`frontend/lib/api/perp.ts`** - Complete API client for all perp endpoints
  - `computeCommitmentHash()` - Compute commitment hash for an intent
  - `submitCommitment()` - Submit commitment to Hook contract
  - `submitReveal()` - Submit reveal to Hook contract
  - `executeBatch()` - Execute batch of reveals
  - `getPosition()` - Get user's position for a market
  - `getCollateral()` - Get collateral info (total, available margin)
  - `getBalances()` - Get token balances (USDC, USDT)
  - `getBatchState()` - Get batch state for a pool
  - `getBatchInterval()` - Get batch interval

### React Hooks
- **`frontend/hooks/usePositions.ts`** - Position management hooks
  - `usePosition(marketId)` - Fetch position for a market
  - `useClosePosition()` - Close position mutation

- **`frontend/hooks/useAccount.ts`** - Account data hooks
  - `useCollateral()` - Fetch collateral info
  - `useBalances()` - Fetch token balances

- **`frontend/hooks/useTrading.ts`** - Trading operations hooks
  - `useOpenPosition()` - Open new position (commit + reveal)
  - `useExecuteBatch()` - Execute batch of reveals
  - `useBatchState()` - Get batch state
  - `useBatchInterval()` - Get batch interval

### Utilities
- **`frontend/lib/utils/perp.ts`** - Perp utility functions
  - `leverageToBigInt()` / `leverageFromBigInt()` - Leverage conversion
  - `amountToBigInt()` / `amountFromBigInt()` - Amount conversion
  - `priceToBigInt()` / `priceFromBigInt()` - Price conversion
  - `createPerpIntent()` - Create PerpIntent from form inputs
  - `formatPositionSize()` - Format position size for display
  - `calculateUnrealizedPnL()` - Calculate PnL

- **`frontend/lib/config.ts`** - Frontend configuration
  - `DEFAULT_MARKET_ID` - Default market ID (ETH/USD)
  - `DEFAULT_POOL_KEY` - Default pool key configuration

## Components Updated

### OrderPanelBox
- ✅ Wired up to submit orders via `useOpenPosition()` hook
- ✅ Creates `PerpIntent` from form inputs
- ✅ Handles commit + reveal flow automatically
- ✅ Shows loading states and error messages
- ✅ Resets form on success

### PositionsPanelBox
- ✅ Fetches real positions via `usePosition()` hook
- ✅ Displays position data (size, entry price, margin, leverage)
- ✅ Close position functionality via `useClosePosition()` hook
- ✅ Shows loading and empty states
- ✅ Updates position count in tab badge

### AccountSummaryBox
- ✅ Fetches real collateral data via `useCollateral()` hook
- ✅ Shows total collateral, available margin, used margin
- ✅ Displays loading states
- ✅ Real-time updates (refetches every 10 seconds)

## Flow

### Opening a Position

1. User fills out order form (size, margin, leverage, side)
2. Clicks "Open Long" or "Open Short"
3. Frontend creates `PerpIntent` from form inputs
4. Calls `useOpenPosition()` hook which:
   - Computes commitment hash
   - Submits commitment transaction
   - Submits reveal transaction
5. Position appears in PositionsPanelBox after batch execution

### Closing a Position

1. User clicks "Close" button in PositionsPanelBox
2. Frontend creates close `PerpIntent` (same size, `isOpen: false`)
3. Calls `useClosePosition()` hook
4. Position is removed after batch execution

### Viewing Positions

1. PositionsPanelBox uses `usePosition()` hook
2. Automatically refetches every 10 seconds
3. Converts BigInt values to display format
4. Shows empty state if no positions

## Configuration

Default values are set in `frontend/lib/config.ts`:
- Market ID: `0x0000000000000000000000000000000000000001` (ETH/USD)
- Pool Key: USDT/USDC pool with PrivBatchHook

These can be made configurable via environment variables if needed.

## Error Handling

- All API calls have retry logic (5 attempts)
- Network errors show user-friendly messages
- Form validation prevents invalid submissions
- Loading states prevent double-submission
- Error messages displayed in UI

## Next Steps

1. **Market Data Integration** - Connect PriceChart to real market prices
2. **Batch Execution UI** - Show batch status and allow manual execution
3. **Deposit/Withdraw Modals** - Implement collateral deposit/withdraw flows
4. **Order History** - Display commit/reveal history
5. **Real-time Price Updates** - WebSocket or polling for mark prices
6. **PnL Calculation** - Calculate unrealized PnL from current market price
7. **Liquidation Price** - Calculate and display liquidation prices

## Testing

To test the integration:

1. **Start backend**: `cd backend && npm run dev`
2. **Start frontend**: `cd frontend && npm run dev`
3. **Sign in** with Privy (email OTP)
4. **Open a position** via OrderPanelBox
5. **View position** in PositionsPanelBox
6. **Check account** in AccountSummaryBox
7. **Close position** via PositionsPanelBox

## Notes

- All transactions are signed server-side (no wallet popups)
- Positions update after batch execution (not immediately)
- Batch interval is typically 5 minutes (check with `getBatchInterval()`)
- All amounts are in BigInt format (strings) for precision
- Leverage is stored as 18-decimal fixed point (5x = "5000000000000000000")
