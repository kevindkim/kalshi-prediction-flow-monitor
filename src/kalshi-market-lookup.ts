const BASE_URL = 'https://api.elections.kalshi.com';

// define what Kalshi API returns
interface MarketResponse {
  market: {
    ticker: string;
    title: string;
    subtitle: string;
    rules_primary: string;
    expected_expiration_time: string;
    yes_sub_title: string;
    no_sub_title: string;
  };
}

// defining what getMarketDetails returns
export interface MarketDetails {
  title: string;
  subtitle: string;
  rulesPrimary: string;
  expirationTime: string;
}

export async function getMarketDetails(ticker: string): Promise<MarketDetails | null> {
  try {
    const response = await fetch(`${BASE_URL}/trade-api/v2/markets/${ticker}`);
    
    if (!response.ok) {
      console.log(`Failed to fetch market ${ticker}: ${response.status}`);
      return null; // Return null on failure
    }
    
    const data: MarketResponse = await response.json();
    const market = data.market;
    
    // Return object of market data to enrich in feed
    return {
      title: market.title,
      subtitle: market.subtitle,
      rulesPrimary: market.rules_primary,
      expirationTime: market.expected_expiration_time,
    };
  } catch (error) {
    console.error(`Error fetching market ${ticker}:`, error);
    return null; 
  }
}