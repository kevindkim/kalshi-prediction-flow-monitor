import { EventEmitter } from 'events';
import { KalshiTradeMessage } from './types';

export class TradeFilter extends EventEmitter {
  private thresholdUsd: number;
  
  constructor(thresholdUsd: number = 5000) {
        super();
        this.thresholdUsd = thresholdUsd;
  }
  
  checkTrade(tradeMessage: KalshiTradeMessage): void {
    const trade = tradeMessage.msg;
    const contractPrice: number = Number(trade.taker_side === 'yes' ? trade.yes_price_dollars : trade.no_price_dollars);
    const contractCount: number = trade.count;

    const notionalTradeUsd: number = contractCount * contractPrice;
    
    if (notionalTradeUsd >= this.thresholdUsd) {
        this.emit('bigTrade', tradeMessage);
    }
  }
}