// src/types.ts

//Represents a conformed trade from any prediction market
 
export interface Trade {
  platform: 'Kalshi' | 'Polymarket';
  ticker: string;
  marketTitle: string;
  side: 'yes' | 'no';
  price: number;        // 0-1 range (0.60 = 60%)
  size: number;         // Number of contracts
  notionalUsd: number;  // Total dollar value
  timestamp: string;    // ISO format
}

// Raw message from Kalshi WebSocket 
export interface KalshiTradeMessage {
  type: 'trade';
  sid: number;
  seq: number;
  msg: {
    trade_id: string;
    market_ticker: string;      // ← Note: market_ticker, not ticker
    yes_price: number;
    no_price: number;
    yes_price_dollars: string;
    no_price_dollars: string;
    count: number;
    taker_side: 'yes' | 'no';
    ts: number;                 // ← Unix timestamp, not created_time
  };
}