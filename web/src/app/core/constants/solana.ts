/** JupUSD mint on Solana (6 decimals — 5_000_000 = $5). */
export const JUPUSD_MINT = 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD';

/** USDC mint on Solana mainnet. */
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Minimum deposit in USD for Jupiter prediction orders. */
export const MIN_ORDER_USD = 5;

/** Default Solana RPC for transaction submission. */
export const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

export const DEPOSIT_MINT_OPTIONS = [
  { label: 'JupUSD', mint: JUPUSD_MINT },
  { label: 'USDC', mint: USDC_MINT },
] as const;

/** Convert a dollar amount to native token units (6 decimals). */
export function usdToDepositAmount(usd: number): string {
  return String(Math.round(usd * 1_000_000));
}
