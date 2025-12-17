// src/types/portfolio.ts
// Shared types for portfolio/account data from Interactive Brokers

export type IbPosition = {
  account: string;
  symbol: string;
  secType: string;
  currency: string;
  quantity: number;
  avgCost: number;
  lastUpdated: string;
  // Option fields (optional)
  strike?: number;
  expiry?: string;  // YYYYMMDD format
  right?: string;   // "Call" or "Put"
};

export type IbCash = {
  account: string;
  currency: string;
  amount: number;
  lastUpdated: string;
};

export type IbExecution = {
  account: string;
  symbol: string;
  secType: string;
  currency: string;
  side: string;
  quantity: number;
  price: number;
  execId: string;
  orderId: number;
  permId: number;
  ts: string;
  // Option fields (optional)
  strike?: number;
  expiry?: string;  // YYYYMMDD format
  right?: string;   // "Call" or "Put"
};

export type IbOpenOrder = {
  orderId: number;
  symbol: string;
  secType: string;
  side: string;
  quantity: string;
  orderType: string;
  lmtPrice?: number;
  auxPrice?: number;
  status: string;
  ts: string;
  // Option fields
  strike?: number;
  expiry?: string;
  right?: string;
};

export type IbOrderHistory = {
  orderId: number;
  symbol: string;
  secType: string;
  side: string;
  quantity: string;
  orderType?: string;
  lmtPrice?: number;
  price?: number;     // Fill price for executions
  status: string;     // "Cancelled", "Filled", etc.
  ts: string;
  // Option fields
  strike?: number;
  expiry?: string;
  right?: string;
};

export type IbAccountState = {
  positions: IbPosition[];
  cash: IbCash[];
  executions: IbExecution[];
  openOrders: IbOpenOrder[];
};

// Market data passed to trade tickets
export type MarketData = {
  last?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
};

// Option details for trade tickets
export type OptionDetails = {
  strike: number;
  expiry: string;
  right: string;
};
