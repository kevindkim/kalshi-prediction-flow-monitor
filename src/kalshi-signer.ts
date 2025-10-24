import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';

if (!process.env.KALSHI_API_KEY_ID || !process.env.KALSHI_PRIVATE_KEY_PATH) {
  throw new Error('Missing required environment variables');
}

const API_KEY_ID = process.env.KALSHI_API_KEY_ID;
const PRIVATE_KEY_PATH = process.env.KALSHI_PRIVATE_KEY_PATH;

// ✨ Define the type once
export type KalshiAuthHeaders = {
  'KALSHI-ACCESS-KEY': string;
  'KALSHI-ACCESS-SIGNATURE': string;
  'KALSHI-ACCESS-TIMESTAMP': string;
};

// ✨ Use the type (no repetition!)
export function generateKalshiAuthHeaders(method: string, path: string): KalshiAuthHeaders {
  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH);
  const timestamp = Date.now().toString();
  
  const message = `${timestamp}${method}${path}`;
  
  
  const signature = crypto.sign('sha256', Buffer.from(message), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST, // Must match Kalshi's requirement
  }).toString('base64');
  
  console.log('   Signature (first 30 chars):', signature.substring(0, 30) + '...');
  console.log('   API Key ID:', API_KEY_ID);
  
  return {
    'KALSHI-ACCESS-KEY': API_KEY_ID,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp
  };
}