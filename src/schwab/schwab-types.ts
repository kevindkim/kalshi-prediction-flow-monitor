// Minimal typings for the parts of the Schwab Trader API this project uses.

export interface OptionContract {
  putCall: 'PUT' | 'CALL';
  symbol: string; // "AAPL  251017P00230000"
  description: string;
  bid: number;
  ask: number;
  last: number;
  mark: number;
  bidSize: number;
  askSize: number;
  totalVolume: number;
  openInterest: number;
  volatility: number; // implied vol in percent (e.g. 32.5)
  delta: number | 'NaN';
  gamma: number | 'NaN';
  theta: number | 'NaN';
  vega: number | 'NaN';
  strikePrice: number;
  expirationDate: string; // ISO datetime
  daysToExpiration: number;
  inTheMoney: boolean;
  multiplier: number;
  settlementType?: string;
  nonStandard?: boolean;
}

/** putExpDateMap: { "2025-11-21:46": { "230.0": [OptionContract] } } */
export type ExpDateMap = Record<string, Record<string, OptionContract[]>>;

export interface OptionChainResponse {
  symbol: string;
  status: string;
  underlyingPrice: number;
  interestRate?: number;
  volatility?: number;
  underlying?: {
    symbol: string;
    last: number;
    mark: number;
    bid: number;
    ask: number;
    close: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
  };
  putExpDateMap: ExpDateMap;
  callExpDateMap: ExpDateMap;
}

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  datetime: number; // epoch ms
}

export interface PriceHistoryResponse {
  symbol: string;
  empty: boolean;
  candles: Candle[];
}

export interface QuoteResponse {
  [symbol: string]: {
    assetMainType: string;
    symbol: string;
    quote: {
      bidPrice: number;
      askPrice: number;
      lastPrice: number;
      mark: number;
      closePrice: number;
      totalVolume?: number;
      openInterest?: number;
      delta?: number;
      volatility?: number;
    };
  };
}

export interface AccountNumberHash {
  accountNumber: string;
  hashValue: string;
}

export interface SchwabPosition {
  shortQuantity: number;
  longQuantity: number;
  averagePrice: number;
  marketValue: number;
  currentDayProfitLoss?: number;
  instrument: {
    assetType: 'OPTION' | 'EQUITY' | 'COLLECTIVE_INVESTMENT' | string;
    symbol: string;
    description?: string;
    putCall?: 'PUT' | 'CALL';
    underlyingSymbol?: string;
  };
}

export interface SecuritiesAccount {
  securitiesAccount: {
    accountNumber: string;
    type: string;
    positions?: SchwabPosition[];
    currentBalances?: {
      liquidationValue?: number;
      buyingPower?: number;
      cashBalance?: number;
      optionBuyingPower?: number;
    };
  };
}

export type Instruction = 'BUY_TO_OPEN' | 'SELL_TO_OPEN' | 'BUY_TO_CLOSE' | 'SELL_TO_CLOSE';

export interface OrderLeg {
  instruction: Instruction;
  quantity: number;
  instrument: { symbol: string; assetType: 'OPTION' };
}

export interface SchwabOrder {
  orderType: 'NET_CREDIT' | 'NET_DEBIT' | 'LIMIT' | 'MARKET';
  session: 'NORMAL';
  price?: string;
  quantity?: number;
  duration: 'DAY' | 'GOOD_TILL_CANCEL';
  orderStrategyType: 'SINGLE' | 'TRIGGER' | 'OCO';
  complexOrderStrategyType?: 'VERTICAL' | 'NONE';
  orderLegCollection: OrderLeg[];
  childOrderStrategies?: SchwabOrder[];
}

export interface MarketHoursResponse {
  option?: Record<
    string,
    {
      date: string;
      marketType: string;
      isOpen: boolean;
      sessionHours?: { regularMarket?: Array<{ start: string; end: string }> };
    }
  >;
}

export interface PlacedOrder extends SchwabOrder {
  orderId: number;
  status: string;
  enteredTime: string;
  closeTime?: string;
  filledQuantity: number;
  remainingQuantity: number;
  orderActivityCollection?: Array<{
    executionType: string;
    quantity: number;
    executionLegs: Array<{ legId: number; price: number; quantity: number; time: string }>;
  }>;
}
