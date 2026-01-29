# Refactor: Server-Computed Positions Report as Single Source of Truth

## Goal
Replace client-side data fetching and calculations with server-computed positions reports. The `usePositionsReport` hook becomes the single source of truth for positions, orders, cash, Greeks, P&L, and connection state.

## Completed

### usePositionsReport.ts
- [x] Extended to include `openOrders`, `completedOrders` from report
- [x] Added `ibConnected` state from report
- [x] Added `reportStatus` and `reportError` for health reporting
- [x] Added order parsing functions (`parseRawOpenOrders`, `parseRawCompletedOrders`)

### useIbErrors.ts (new)
- [x] Created separate hook for IB error event accumulation
- [x] Listens to `ib.error` topic via WebSocket
- [x] Maintains error list with max 50 entries

### CashBalances.tsx
- [x] Updated to use `ReportCash` type from report
- [x] Simplified grid (removed account column, time column)

## In Progress

### IBPanel.tsx
- [x] Replace `usePortfolioData()` with `usePositionsReport("ib")`
- [x] Use `useIbErrors()` for error handling
- [x] Use report data for positions table (currentPrice, currentValue, changes)
- [x] Use report data for open orders and completed orders
- [x] Use report data for cash balances
- [x] Use report summary for portfolio totals
- [x] Sync IB connection state with global app state
- [ ] **Verify build compiles** - untested
- [ ] **Test runtime behavior** - untested

### FidelityPanel.tsx
- [x] Use `usePositionsReport("fidelity")` for Fidelity positions
- [x] Build Greeks map from report positions
- [x] Combine with streaming Greeks for fallback
- [x] **Fixed: Add timeframe validation** - matches IBPanel behavior
- [ ] **Verify build compiles** - untested
- [ ] **Test runtime behavior** - untested

## Recently Fixed

### "0d" Timeframe Broken in Pre-Market (Jan 28, 2026)
**Root cause**: Backend `calculateReferenceDate()` in `MarketDataControlService.scala` returned TODAY for "0d" timeframe, but during pre-market today hasn't closed yet, so no close data exists.

**Correct semantics**: "0d" means "most recent close" - which is yesterday during pre-market, and today during after-hours.

**Fix**:
1. Added `mostRecentCloseDate` method to `USMarketCalendar` (calendar package where session logic belongs)
2. `MarketDataControlService.calculateReferenceDate("0d")` now delegates to `calendar.mostRecentCloseDate`
3. Also added timeframe validation to FidelityPanel to match IBPanel (resets invalid cached timeframes to "1d")

### Excessive Option Subscription Logging (Jan 28, 2026)
**Problem**: `OptionStreamClient.scala` was dumping full lists of 300+ option symbols to console on every subscription confirmation, making logs unreadable.

**Fix**: Changed subscription confirmation handler to log only counts via `logger.debug()` instead of full symbol lists. Added `Logging` trait to class.

### Flashing Order History (9 vs 12 rows) (Jan 28, 2026)
**Problem**: Order history table was flashing between 9 and 12 rows on each refresh, causing unstable UI.

**Root cause**: IB's `reqCompletedOrders()` API returns inconsistent results on each call - this is a known IB API quirk where the same query can return different numbers of completed orders depending on timing.

**Fix**: Added cumulative caching for completed orders in `IBControlService`:
1. Added `completedOrderCache: ConcurrentHashMap[Long, CompletedOrderView]` keyed by `permId`
2. Each `account_state` request merges fresh results into the cache
3. Returns all cached orders (sorted by timestamp), preventing orders from disappearing once seen
4. This stabilizes the order count across refreshes

### Repeated Option Subscription Polling Loop (Jan 28, 2026)
**Problem**: On every position registry change (including order events), the system was:
1. Calling `subscribePortfolioContracts` with the same 8 options
2. Re-subscribing them to streaming (redundantly)
3. Running `OptionSnapshotPoller` to fetch Greeks (redundantly)

This caused a flood of repeated log messages and unnecessary API calls.

**Root cause**:
- `PositionRegistry.notifyListeners()` fires on every order event
- `SubscriptionCoordinator.reconcile()` called on every listener notification
- `SubscriptionManager.subscribeContracts()` wasn't idempotent - it subscribed even if already subscribed
- `MarketDataControlService.subscribeOptionsWithGreeks()` always called snapshot poller

**Fix**:
1. Made `SubscriptionManager.subscribeContracts()` idempotent - tracks what's already subscribed, only subscribes new contracts
2. Added `subscribedOptionContracts()` method to SubscriptionManager trait for deduplication queries
3. Changed `subscribeOptionsWithGreeks()` to check for new contracts first, skip entirely if all already subscribed
4. Converted verbose `println` statements to structured `logger.info/debug` calls throughout SubscriptionManager and OptionSnapshotPoller

## Not Started / To Verify

- [ ] Remove `usePortfolioData` hook if no longer used
- [ ] Clean up unused imports in both panels
- [ ] Verify all downstream components work with new data flow:
  - ExpiryScenarioAnalysis
  - SimulatorPanel
  - PnLSummary
  - OptionsAnalysisTable
  - OpenOrdersTable
  - OrderHistoryTable

## Architecture Notes

- **Single source of truth**: All position data, pricing, Greeks, orders come from server report
- **Streaming still used for**: Trade tickets (bid/ask), some downstream components
- **Error handling**: IB errors accumulated separately via `useIbErrors` hook (event-based, not report-based)
