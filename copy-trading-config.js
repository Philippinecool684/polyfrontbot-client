/**
 * ========================================
 * POLYMARKET COPY TRADING CONFIGURATION
 * ========================================
 *
 * This file contains all settings for the copy-trading module.
 * Adjust the parameters to your needs before running.
 *
 * 🔒 SECURITY:
 * - Never commit this file with real keys to git
 * - Keep PRIVATE_KEY in .env file (COPY_TRADING_PRIVATE_KEY)
 */

module.exports = {

  // ============================================================
  // OPERATION MODE
  // ============================================================

  /**
   * Module operation mode:
   *
   * 'once'   - One-time check
   *            Starts → checks trades → copies → finishes
   *            Suitable for periodic manual runs
   *
   * 'daemon' - Daemon (continuous operation)
   *            Starts → runs forever → checks every N seconds
   *            Suitable for continuous copy trading
   */
  mode: 'once',

  /**
   * Check interval (only used in 'daemon' mode)
   * How many seconds to wait between checks for new trades
   *
   * Recommended: 1–5 seconds for fast reaction
   * Minimum: 1 second (Polymarket API limitation)
   */
  checkIntervalSeconds: 5,

  // ============================================================
  // TRADERS TO COPY
  // ============================================================

  /**
   * List of wallet addresses of traders you want to copy
   *
   * How to find trader addresses:
   * 1. Go to https://polymarket.com/leaderboard
   * 2. Select a successful trader
   * 3. Click on their profile
   * 4. Copy the wallet address from URL or profile
   *
   * Format: Array of strings with addresses (0x...)
   * Example: ['0xABC...', '0xDEF...']
   */
  traders: [
    // Example addresses (replace with real ones):
    // '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
    // '0x1234567890123456789012345678901234567890',

    // Add addresses separated by commas, each in quotes, with trailing comma
  ],

  // ============================================================
  // COPY STRATEGY
  // ============================================================

  /**
   * Position size calculation strategy
   *
   * 'PERCENTAGE' - Percentage of the trader's order size
   *                Example: Trader bought $100, copySize=10% → you buy $10
   *
   * 'FIXED'      - Fixed amount per trade
   *                Example: copySize=$5 → always buy $5 regardless of order size
   *
   * 'ADAPTIVE'   - Adaptive percentage (changes depending on order size)
   *                Small orders → higher percentage
   *                Large orders → lower percentage
   */
  strategy: 'FIXED',

  /**
   * Copy size (value depends on the selected strategy)
   *
   * For PERCENTAGE: Percentage of order (1–100)
   *   Example: 10 means 10% of trader's order size
   *   Trader bought $100 → you buy $10
   *
   * For FIXED: Fixed amount in USD
   *   Example: 1.0 means $1 per trade
   *
   * For ADAPTIVE: Base percentage
   *   Used as starting point for adaptation
   */
  copySize: 1.0,

  // ============================================================
  // LIMITS
  // ============================================================

  /**
   * Maximum size of a single order in USD
   *
   * Protects from accidentally large purchases
   * Even if trader bought $10,000, you won't buy more than this amount
   *
   * Recommended: start with small value for testing
   */
  maxOrderSizeUSD: 10,

  /**
   * Minimum size of a single order in USD
   *
   * Orders smaller than this value WILL NOT be executed
   * Helpful to avoid tiny useless trades
   *
   * Polymarket minimum: $1
   */
  minOrderSizeUSD: 1,

  /**
   * Maximum position size in USD
   *
   * Total limit per one position (one market)
   * Protects from accumulating too large position in single market
   *
   * Example: if you already have $40 position and limit is $50,
   *          next buy can be max $10
   *
   * Set to null or 0 to disable the limit
   */
  maxPositionSizeUSD: 50,

  /**
   * Maximum daily volume in USD
   *
   * Total limit for all purchases during one day
   * Protects from over-trading in a single day
   *
   * After reaching this limit new orders WILL NOT be executed
   * Limit resets at 00:00 UTC
   *
   * Set to null or 0 to disable
   */
  maxDailyVolumeUSD: 100,

  // ============================================================
  // TIERED MULTIPLIERS
  // ============================================================

  /**
   * Multipliers for different order sizes (optional)
   *
   * Allows applying different coefficients depending on trader's order size
   *
   * Format: "min-max:multiplier, min-max:multiplier, min+:multiplier"
   *
   * Example:
   * "1-10:2.0,10-100:1.0,100-500:0.5,500+:0.2"
   *   Orders $1–$10    → 2.0× (double)
   *   Orders $10–$100  → 1.0× (same size)
   *   Orders $100–$500 → 0.5× (half)
   *   Orders $500+     → 0.2× (one fifth)
   *
   * Set to null to disable
   */
  tieredMultipliers: null,

  // Example with multipliers (uncomment to use):
  // tieredMultipliers: "1-10:2.0,10-100:1.0,100-500:0.5,500+:0.2",

  // ============================================================
  // ADAPTIVE STRATEGY SETTINGS
  // ============================================================

  /**
   * Settings for ADAPTIVE strategy (used only when strategy='ADAPTIVE')
   */

  /**
   * Minimum percentage for large orders
   *
   * When trader makes large purchase (above threshold),
   * this percentage is used to protect from over-exposure
   */
  adaptiveMinPercent: 5,

  /**
   * Maximum percentage for small orders
   *
   * When trader makes small purchase (below threshold),
   * this percentage is used for more aggressive copying
   */
  adaptiveMaxPercent: 15,

  /**
   * Order size threshold in USD for percentage switching
   *
   * Orders below this value  → adaptiveMaxPercent
   * Orders above this value  → adaptiveMinPercent
   */
  adaptiveThresholdUSD: 500,

  // ============================================================
  // NETWORK & API
  // ============================================================

  /**
   * Polygon RPC node URL (read from .env: RPC_URL)
   *
   * Free options:
   * - Infura: https://polygon-mainnet.infura.io/v3/YOUR_PROJECT_ID
   * - Alchemy: https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   * - Public:  https://polygon-rpc.com (slower)
   */
  // rpcUrl: process.env.RPC_URL,  // read from .env

  /**
   * Polymarket CLOB API URL (usually no need to change)
   */
  polymarketClobHttpUrl: 'https://clob.polymarket.com',
  polymarketClobWsUrl: 'wss://ws-subscriptions-clob.polymarket.com/ws',

  /**
   * USDC contract address on Polygon (usually no need to change)
   */
  usdcContractAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',

  // ============================================================
  // HISTORY STORAGE
  // ============================================================

  /**
   * File for storing trade history
   *
   * Used for:
   * - Tracking already copied trades
   * - Calculating P&L statistics
   * - Preventing duplicates
   */
  historyFile: './copy-trading-history.json',

  /**
   * File for storing daily statistics
   *
   * Used for:
   * - Tracking daily volume (maxDailyVolumeUSD)
   * - Resetting limits at the start of new day
   */
  dailyStatsFile: './copy-trading-daily-stats.json',

  // ============================================================
  // LOGGING & OUTPUT
  // ============================================================

  /**
   * Logging verbosity level
   *
   * 'minimal' - Only important events (new trades, executions)
   * 'normal'  - Standard level (recommended)
   * 'verbose' - Detailed logs (all operations)
   * 'debug'   - Debug logs (development only)
   */
  logLevel: 'normal',

  /**
   * Show detailed calculation information
   *
   * When true: shows position size calculation formula
   * Example: "10% of trader's $100.00 = $10.00"
   */
  showCalculationDetails: true,

  /**
   * Colored console output
   *
   * When false: plain text output (black & white)
   * Useful when logging to file
   */
  coloredOutput: true,

  // ============================================================
  // RISK MANAGEMENT
  // ============================================================

  /**
   * Check balance before executing trades
   *
   * When true: verifies sufficient USDC and POL for gas
   */
  checkBalanceBeforeTrade: true,

  /**
   * Minimum POL balance for gas (in USD equivalent)
   *
   * If POL balance falls below this value, orders WILL NOT be executed
   * Protects from situation when you have USDC but no gas to send tx
   */
  minGasBalanceUSD: 1,

  /**
   * Percentage of balance reserved for gas
   *
   * When calculating order size, this % of balance is left untouched
   * Example: 1 means 1% of balance is reserved
   */
  balanceReservePercent: 1,

  // ============================================================
  // MISC SETTINGS
  // ============================================================

  /**
   * API request timeout in milliseconds
   *
   * If API doesn't respond within this time, request will be retried
   */
  requestTimeoutMs: 10000,

  /**
   * Number of retry attempts on network errors
   *
   * How many times to retry request on temporary network issues
   */
  networkRetryLimit: 3,

  /**
   * Number of attempts to execute an order
   *
   * How many times to try placing order if it fails
   * (price changed, insufficient liquidity, etc.)
   */
  orderRetryLimit: 3,

  /**
   * Skip very old trades
   *
   * Trades older than this number of hours WILL NOT be copied
   * Protects from copying ancient orders on first run
   *
   * Recommended: 24 hours (1 day)
   * Set to 0 to copy all trades regardless of age
   */
  maxTradeAgeHours: 24,

  /**
   * Aggregate small trades
   *
   * When true: combines several small trades into one larger order
   * Helpful to reduce number of transactions and gas costs
   *
   * Works only in 'daemon' mode
   */
  enableTradeAggregation: false,

  /**
   * Aggregation window in seconds (if aggregation is enabled)
   *
   * How long to wait before executing aggregated order
   */
  tradeAggregationWindowSeconds: 300,  // 5 minutes

};

/**
 * ============================================================
 * EXAMPLE CONFIGURATIONS
 * ============================================================
 *
 *
 * 📊 CONSERVATIVE (beginner friendly):
 *
 * module.exports = {
 *   mode: 'once',
 *   traders: ['0x...'],
 *   strategy: 'FIXED',
 *   copySize: 1.0,
 *   maxOrderSizeUSD: 5,
 *   minOrderSizeUSD: 1,
 *   maxPositionSizeUSD: 20,
 *   maxDailyVolumeUSD: 50,
 * };
 *
 *
 * ⚡ AGGRESSIVE (experienced users):
 *
 * module.exports = {
 *   mode: 'daemon',
 *   checkIntervalSeconds: 2,
 *   traders: ['0x...', '0x...'],
 *   strategy: 'PERCENTAGE',
 *   copySize: 15,
 *   tieredMultipliers: "1-50:2.0,50-200:1.0,200-500:0.5,500+:0.2",
 *   maxOrderSizeUSD: 100,
 *   minOrderSizeUSD: 1,
 *   maxPositionSizeUSD: 500,
 *   maxDailyVolumeUSD: 1000,
 * };
 *
 *
 * 🎯 ADAPTIVE (smart scaling):
 *
 * module.exports = {
 *   mode: 'daemon',
 *   checkIntervalSeconds: 3,
 *   traders: ['0x...'],
 *   strategy: 'ADAPTIVE',
 *   copySize: 10,
 *   adaptiveMinPercent: 5,
 *   adaptiveMaxPercent: 20,
 *   adaptiveThresholdUSD: 300,
 *   maxOrderSizeUSD: 50,
 *   minOrderSizeUSD: 1,
 *   maxPositionSizeUSD: 200,
 *   maxDailyVolumeUSD: 500,
 * };
 *
 */