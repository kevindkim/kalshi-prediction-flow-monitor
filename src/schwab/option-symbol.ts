// Helpers for Schwab/OCC option symbols.
//
// Schwab uses the OCC 21-character format:
//   underlying padded to 6 chars + YYMMDD + C|P + strike * 1000 padded to 8 digits
// e.g. "AAPL  251017P00230000" = AAPL, 2025-10-17, PUT, 230.00

export interface ParsedOptionSymbol {
  underlying: string;
  expiration: string; // YYYY-MM-DD
  putCall: 'PUT' | 'CALL';
  strike: number;
}

export function formatOptionSymbol(
  underlying: string,
  expiration: string, // YYYY-MM-DD
  putCall: 'PUT' | 'CALL',
  strike: number
): string {
  const [yyyy, mm, dd] = expiration.split('-');
  if (!yyyy || !mm || !dd) {
    throw new Error(`Bad expiration "${expiration}", expected YYYY-MM-DD`);
  }
  const root = underlying.toUpperCase().padEnd(6, ' ');
  const date = `${yyyy.slice(2)}${mm}${dd}`;
  const cp = putCall === 'PUT' ? 'P' : 'C';
  const strikeStr = Math.round(strike * 1000).toString().padStart(8, '0');
  return `${root}${date}${cp}${strikeStr}`;
}

export function parseOptionSymbol(symbol: string): ParsedOptionSymbol | null {
  if (symbol.length !== 21) return null;
  const underlying = symbol.slice(0, 6).trim();
  const yy = symbol.slice(6, 8);
  const mm = symbol.slice(8, 10);
  const dd = symbol.slice(10, 12);
  const cp = symbol.charAt(12);
  const strikeRaw = symbol.slice(13);
  if (!/^\d{6}$/.test(symbol.slice(6, 12)) || !/^\d{8}$/.test(strikeRaw)) return null;
  if (cp !== 'P' && cp !== 'C') return null;
  return {
    underlying,
    expiration: `20${yy}-${mm}-${dd}`,
    putCall: cp === 'P' ? 'PUT' : 'CALL',
    strike: Number(strikeRaw) / 1000,
  };
}
