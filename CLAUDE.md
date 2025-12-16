# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run dev      # Start Vite dev server with HMR
npm run build    # Production build
npm run lint     # Run ESLint
npm run preview  # Preview production build
```

## Architecture Overview

This is a React 19 + Vite trading UI that displays real-time market data for equities and options via WebSocket connections to a backend service.

### Core Components

- **App.tsx** - Root component, initializes WebSocket connection via `socketHub.connect()`
- **TwoPane.tsx** - Main layout with tabbed navigation between "Watchlist & Options" and "Portfolio" views
- **EquityPanel.tsx** - Watchlist management with real-time equity quotes; selects ticker for option chain
- **OptionPanel.tsx** - Option chain display with calls/puts grid, Greeks, and trade buttons
- **PortfolioPanel.tsx** - IB account state: positions, cash, executions, open orders with BUY/SELL actions

### WebSocket Layer (`src/ws/`)

- **SocketHub.ts** - Singleton WebSocket manager with:
  - Auto-reconnect with exponential backoff
  - Message queuing when disconnected
  - Control message correlation via `sendControl()` returning promises matched by `id`
  - Tick handlers (`onTick`/`offTick`) for streaming market data
  - Generic message handlers (`onMessage`/`offMessage`) for control acks
- **ws-types.ts** - TypeScript interfaces for wire protocol: `ControlAck`, `TickEnvelope`, etc.

### Data Flow

1. Components subscribe via `socketHub.send({ type: "subscribe", channels, symbols })`
2. Market data arrives as `TickEnvelope` with `topic` like `md.equity.quote.AAPL` or `md.option.trade.NVDA251212C00180000`
3. Control operations (find expiries, get chain, place orders) use `sendControl()` for request/response correlation

### Key Patterns

- **Option symbols** use OSI format: `SYMBOL + YYMMDD + C/P + 8-digit strike` (e.g., `NVDA251212C00180000` = NVDA Dec 12, 2025 $180 Call)
- **Topic format**: `md.{equity|option}.{quote|trade|greeks}.SYMBOL`
- **Control ops**: `find_expiries`, `get_chain`, `account_state`, `subscribe_portfolio_contracts`
- **Price caching**: Components maintain local caches (Map or ref) updated from ticks, with throttled re-renders via requestAnimationFrame

### Backend Integration

Vite proxies `/ws` and `/api` to backend (configured via `VITE_BACKEND_HOST`, `VITE_BACKEND_PORT` env vars, defaults to `localhost:8088`). The backend handles IB gateway connections and Alpaca market data.

### Trade Components (`src/components/`)

- **TradeTicket.tsx** - Equity order entry
- **OptionTradeTicket.tsx** - Option order entry with contract details
