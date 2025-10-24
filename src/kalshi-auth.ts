import 'dotenv/config';
import { generateKalshiAuthHeaders } from './kalshi-signer';

const BASE_URL = 'https://trading-api.kalshi.com';

interface LoginResponse {
  token: string;
  member_id: string;
}

/**
 * Logs in to Kalshi API and returns a session token
 * This token can be used for WebSocket connections
 */
export async function getSessionToken(): Promise<string> {
  const method = 'POST';
  const path = '/trade-api/v2/login';

  console.log('🔐 Logging in to Kalshi to get session token...');

  // Generate authentication headers using existing signer
  const authHeaders = generateKalshiAuthHeaders(method, path);

  try {
    // Call login endpoint
    const response = await fetch(`${BASE_URL}${path}`, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Login failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const data: LoginResponse = await response.json();
    console.log('✅ Successfully obtained session token!');
    console.log(`👤 Member ID: ${data.member_id}`);

    return data.token;
  } catch (error) {
    console.error('❌ Failed to get session token:', error);
    throw error;
  }
}
