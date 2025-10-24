import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { KalshiTradeMessage } from './types';
import { generateKalshiAuthHeaders } from './kalshi-signer';
import { TradeFilter } from './trade-filter';
import { getMarketDetails } from './kalshi-market-lookup';


export class KalshiClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl = 'wss://api.elections.kalshi.com/trade-api/ws/v2';
  
  constructor() {
    super();
  }
  
  connect(): void {
    console.log('🔌 Connecting to Kalshi with authentication...');
    
    const authHeaders = generateKalshiAuthHeaders('GET', '/trade-api/ws/v2');
    
    this.ws = new WebSocket(this.wsUrl, {
      headers: authHeaders
    });
    
    this.ws.on('open', () => {
      console.log('✅ Connected to Kalshi!');
        this.subscribeToTrades(); 
    });
    
    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });
    
    this.ws.on('error', (error) => {
      console.error('❌ WebSocket Error:', error);
    });
    
    this.ws.on('close', () => {
      console.log('🔌 Disconnected from Kalshi');
    });
  }

  private subscribeToTrades(): void {
    if (this.ws === null) {
        console.error('❌ Cannot subscribe: WebSocket not connected!');
        return;
    }
    const subscription = {
        "id": 1,
        "cmd": "subscribe",
        "params": {
            "channels": ["trade"]
        }
    }
    this.ws.send(JSON.stringify(subscription));
    console.log('Subscription for trades established!');
  }
  
  private handleMessage(data: WebSocket.Data): void {
    try {
      const messageString = data.toString();
      const parsed = JSON.parse(messageString);

      if (parsed.type !== 'trade') {
        console.log(`📨 Received: ${parsed.type}`);
        return;
      }
      
      this.emit('trade', parsed);
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }
}

const subscriber = new KalshiClient;
const filter = new TradeFilter(5000); // Creating filter for >$5k notional

subscriber.on('trade', (tradeMessage) => {
    filter.checkTrade(tradeMessage) // Checks each trade with filter logic
});

filter.on('bigTrade', async (tradeMessage) => {

    const trade = tradeMessage.msg;
    const marketDetails = await getMarketDetails(trade.market_ticker);

    const priceStr = trade.taker_side === 'yes' 
        ? trade.yes_price_dollars 
        : trade.no_price_dollars;

    const notional = Number(priceStr) * trade.count;

    const actualPrice = trade.taker_side === 'yes' 
        ? trade.yes_price 
        : trade.no_price;

    if (!marketDetails) {
        console.log(`
            💰 BIG TRADE: $${notional.toFixed(2)}
            Ticker: ${trade.market_ticker}
            Side: ${trade.taker_side}
            Price: ${actualPrice}¢
            Size: ${trade.count} contracts
        `);
        return;
    }

    console.log(`
        💰 BIG TRADE: $${notional.toFixed(2)}
        ${marketDetails.title}
        Rules: ${marketDetails.rulesPrimary}
        Expires: ${new Date(marketDetails.expirationTime).toLocaleString()}
        
        Ticker: ${trade.market_ticker}
        Side: ${trade.taker_side}
        Price: ${actualPrice}¢
        Size: ${trade.count} contracts
    `);
});

subscriber.connect();

