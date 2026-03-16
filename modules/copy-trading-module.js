const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ClobClient } = require('@polymarket/clob-client');
const ethers = require('ethers');
const config = require('../copy-trading-config');


const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const POLYMARKET_API_URL = 'https://data-api.polymarket.com';

class Logger {
  constructor(logLevel = 'normal', colored = true) {
    this.logLevel = logLevel;
    this.colored = colored;
    this.levels = { minimal: 0, normal: 1, verbose: 2, debug: 3 };
  }

  color(color, text) {
    if (!this.colored) return text;
    return `${COLORS[color]}${text}${COLORS.reset}`;
  }

  log(level, color, prefix, ...args) {
    if (this.levels[level] > this.levels[this.logLevel]) return;
    const timestamp = new Date().toLocaleTimeString();
    console.log(`${this.color(color, `[${timestamp}] ${prefix}`)}`, ...args);
  }

  error(...args) { this.log('minimal', 'red', '❌ ERROR:', ...args); }
  warn(...args) { this.log('normal', 'yellow', '⚠️  WARN:', ...args); }
  info(...args) { this.log('normal', 'cyan', 'ℹ️  INFO:', ...args); }
  success(...args) { this.log('minimal', 'green', '✅ SUCCESS:', ...args); }
  verbose(...args) { this.log('verbose', 'white', '📝 VERBOSE:', ...args); }
  debug(...args) { this.log('debug', 'white', '🔧 DEBUG:', ...args); }

  header(text) {
    if (this.logLevel === 'minimal') return;
    console.log(`\n${this.color('cyan', '═'.repeat(60))}`);
    console.log(`${this.color('bright', text)}`);
    console.log(`${this.color('cyan', '═'.repeat(60))}\n`);
  }

  separator() {
    if (this.logLevel === 'minimal') return;
    console.log(this.color('cyan', '─'.repeat(60)));
  }
}

class Storage {
  constructor(historyFile, dailyStatsFile, logger) {
    this.historyFile = historyFile;
    this.dailyStatsFile = dailyStatsFile;
    this.logger = logger;
    this.history = this.loadHistory();
    this.dailyStats = this.loadDailyStats();
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger.warn('Error loading history:', error.message);
    }
    return { trades: [], lastCheckTime: 0 };
  }

  saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2));
    } catch (error) {
      this.logger.error('Error saving history:', error.message);
    }
  }

  loadDailyStats() {
    try {
      if (fs.existsSync(this.dailyStatsFile)) {
        const data = fs.readFileSync(this.dailyStatsFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger.warn('Error loading daily stats:', error.message);
    }
    return this.createNewDayStats();
  }

  saveDailyStats() {
    try {
      fs.writeFileSync(this.dailyStatsFile, JSON.stringify(this.dailyStats, null, 2));
    } catch (error) {
      this.logger.error('Error saving stats:', error.message);
    }
  }

  createNewDayStats() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    return {
      date: today,
      totalVolumeUSD: 0,
      tradesCount: 0,
      tradesByTrader: {},
      tradesByMarket: {},
    };
  }

  checkAndResetDaily() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (this.dailyStats.date !== today) {
      this.logger.info(`New day: ${today}, resetting daily limits`);
      this.dailyStats = this.createNewDayStats();
      this.saveDailyStats();
      return true;
    }
    return false;
  }

  isTradeProcessed(txHash) {
    return this.history.trades.some(t => t.transactionHash === txHash);
  }

  addTrade(trade) {
    this.history.trades.push({
      ...trade,
      processedAt: Date.now(),
    });
    this.saveHistory();

    this.dailyStats.tradesCount++;
    this.dailyStats.totalVolumeUSD += trade.executedSizeUSD || 0;

    if (!this.dailyStats.tradesByTrader[trade.traderAddress]) {
      this.dailyStats.tradesByTrader[trade.traderAddress] = { count: 0, volume: 0 };
    }
    this.dailyStats.tradesByTrader[trade.traderAddress].count++;
    this.dailyStats.tradesByTrader[trade.traderAddress].volume += trade.executedSizeUSD || 0;

    if (!this.dailyStats.tradesByMarket[trade.conditionId]) {
      this.dailyStats.tradesByMarket[trade.conditionId] = { count: 0, volume: 0 };
    }
    this.dailyStats.tradesByMarket[trade.conditionId].count++;
    this.dailyStats.tradesByMarket[trade.conditionId].volume += trade.executedSizeUSD || 0;

    this.saveDailyStats();
  }

  getPositionSize(conditionId) {
    const positionTrades = this.history.trades.filter(
      t => t.conditionId === conditionId && t.side === 'BUY' && t.status === 'success'
    );

    let totalBought = 0;
    let totalSold = 0;

    for (const trade of positionTrades) {
      if (trade.side === 'BUY') {
        totalBought += trade.executedSizeUSD || 0;
      } else if (trade.side === 'SELL') {
        totalSold += trade.executedSizeUSD || 0;
      }
    }

    return { totalBought, totalSold, current: totalBought - totalSold };
  }

  getLastCheckTime() {
    return this.history.lastCheckTime || 0;
  }

  setLastCheckTime(timestamp) {
    this.history.lastCheckTime = timestamp;
    this.saveHistory();
  }
}

class CopyStrategy {
  static PERCENTAGE = 'PERCENTAGE';
  static FIXED = 'FIXED';
  static ADAPTIVE = 'ADAPTIVE';

  static parseTieredMultipliers(tiersStr) {
    if (!tiersStr) return null;

    const tiers = [];
    const tierDefs = tiersStr.split(',').map(t => t.trim()).filter(t => t);

    for (const tierDef of tierDefs) {
      const parts = tierDef.split(':');
      if (parts.length !== 2) continue;

      const [range, multiplierStr] = parts;
      const multiplier = parseFloat(multiplierStr);

      if (isNaN(multiplier) || multiplier < 0) continue;

      if (range.endsWith('+')) {
        const min = parseFloat(range.slice(0, -1));
        if (!isNaN(min) && min >= 0) {
          tiers.push({ min, max: null, multiplier });
        }
      } else if (range.includes('-')) {
        const [minStr, maxStr] = range.split('-');
        const min = parseFloat(minStr);
        const max = parseFloat(maxStr);

        if (!isNaN(min) && min >= 0 && !isNaN(max) && max > min) {
          tiers.push({ min, max, multiplier });
        }
      }
    }

    return tiers.sort((a, b) => a.min - b.min);
  }

  static getTradeMultiplier(tiers, orderSize) {
    if (!tiers || tiers.length === 0) return 1.0;

    for (const tier of tiers) {
      if (orderSize >= tier.min) {
        if (tier.max === null || orderSize < tier.max) {
          return tier.multiplier;
        }
      }
    }
    return 1.0;
  }

  static calculateAdaptivePercent(config, orderSize) {
    const minPercent = config.adaptiveMinPercent || config.copySize;
    const maxPercent = config.adaptiveMaxPercent || config.copySize;
    const threshold = config.adaptiveThresholdUSD || 500;

    if (orderSize >= threshold) {
      const factor = Math.min(1, (orderSize / threshold) - 1);
      return this.lerp(config.copySize, minPercent, factor);
    } else {
      const factor = orderSize / threshold;
      return this.lerp(maxPercent, config.copySize, factor);
    }
  }

  static lerp(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    return a + (b - a) * t;
  }

  static calculateOrderSize(strategyConfig, traderOrderSize, availableBalance, currentPositionSize = 0) {
    let baseAmount;
    let reasoning;

    switch (strategyConfig.strategy) {
      case this.PERCENTAGE:
        baseAmount = traderOrderSize * (strategyConfig.copySize / 100);
        reasoning = `${strategyConfig.copySize}% of trader order $${traderOrderSize.toFixed(2)} = $${baseAmount.toFixed(2)}`;
        break;

      case this.FIXED:
        baseAmount = strategyConfig.copySize;
        reasoning = `Fixed amount: $${baseAmount.toFixed(2)}`;
        break;

      case this.ADAPTIVE:
        const adaptivePercent = this.calculateAdaptivePercent(strategyConfig, traderOrderSize);
        baseAmount = traderOrderSize * (adaptivePercent / 100);
        reasoning = `Adaptive ${adaptivePercent.toFixed(1)}% of $${traderOrderSize.toFixed(2)} = $${baseAmount.toFixed(2)}`;
        break;

      default:
        throw new Error(`Unknown strategy: ${strategyConfig.strategy}`);
    }

    const tiers = this.parseTieredMultipliers(strategyConfig.tieredMultipliers);
    const multiplier = this.getTradeMultiplier(tiers, traderOrderSize);
    let finalAmount = baseAmount * multiplier;

    if (multiplier !== 1.0) {
      reasoning += ` → ${multiplier}x multiplier: $${baseAmount.toFixed(2)} → $${finalAmount.toFixed(2)}`;
    }

    let cappedByMax = false;
    let reducedByBalance = false;
    let reducedByPosition = false;
    let belowMinimum = false;

    if (finalAmount > strategyConfig.maxOrderSizeUSD) {
      finalAmount = strategyConfig.maxOrderSizeUSD;
      cappedByMax = true;
      reasoning += ` → capped at maximum $${strategyConfig.maxOrderSizeUSD}`;
    }

    if (strategyConfig.maxPositionSizeUSD > 0) {
      const newPosition = currentPositionSize + finalAmount;
      if (newPosition > strategyConfig.maxPositionSizeUSD) {
        const allowed = Math.max(0, strategyConfig.maxPositionSizeUSD - currentPositionSize);
        if (allowed < strategyConfig.minOrderSizeUSD) {
          finalAmount = 0;
          reducedByPosition = true;
          reasoning += ` → position limit reached`;
        } else {
          finalAmount = allowed;
          reducedByPosition = true;
          reasoning += ` → reduced to position limit`;
        }
      }
    }

    const maxAffordable = availableBalance * (1 - strategyConfig.balanceReservePercent / 100);
    if (finalAmount > maxAffordable) {
      finalAmount = maxAffordable;
      reducedByBalance = true;
      reasoning += ` → reduced to available balance $${maxAffordable.toFixed(2)}`;
    }

    if (finalAmount < strategyConfig.minOrderSizeUSD) {
      belowMinimum = true;
      reasoning += ` → below minimum $${strategyConfig.minOrderSizeUSD}`;
      finalAmount = 0;
    }

    return {
      traderOrderSize,
      baseAmount,
      finalAmount,
      strategy: strategyConfig.strategy,
      cappedByMax,
      reducedByBalance,
      reducedByPosition,
      belowMinimum,
      reasoning,
    };
  }
}

class PolymarketClient {
  constructor(privateKey, config, logger) {
    this.privateKey = privateKey;
    this.config = config;
    this.logger = logger;
    this.clobClient = null;
    this.provider = null;
    this.walletAddress = null;
  }

  async init() {
    try {
      this.logger.info('Initializing Polymarket client...');

      this.provider = new ethers.providers.JsonRpcProvider(this.config.rpcUrl || process.env.RPC_URL);

      const wallet = new ethers.Wallet(this.privateKey, this.provider);
      this.walletAddress = wallet.address;
      this.logger.info(`Wallet: ${this.walletAddress.slice(0, 8)}...${this.walletAddress.slice(-6)}`);

      this.clobClient = new ClobClient(
        this.config.polymarketClobHttpUrl,
        this.config.polymarketClobWsUrl,
        wallet.address,
        async () => {
          const signature = await wallet.signMessage('Verify wallet address');
          return {
            signature: signature.slice(2),
            timestamp: Math.floor(Date.now() / 1000),
          };
        }
      );

      await this.clobClient.setClobApiKeys();
      this.logger.success('Polymarket client initialized');

      return true;
    } catch (error) {
      this.logger.error('Client initialization error:', error.message);
      throw error;
    }
  }

  async getBalances() {
    try {
      const usdcContract = new ethers.Contract(
        this.config.usdcContractAddress,
        ['function balanceOf(address) view returns (uint256)'],
        this.provider
      );
      const usdcBalanceBig = await usdcContract.balanceOf(this.walletAddress);
      const usdcBalance = parseFloat(ethers.utils.formatUnits(usdcBalanceBig, 6));

      const polBalanceBig = await this.provider.getBalance(this.walletAddress);
      const polBalance = parseFloat(ethers.utils.formatEther(polBalanceBig));

      return {
        usdc: usdcBalance,
        pol: polBalance,
      };
    } catch (error) {
      this.logger.error('Error getting balance:', error.message);
      return { usdc: 0, pol: 0 };
    }
  }

  async getTraderActivity(traderAddress, limit = 100) {
    try {
      const url = `${POLYMARKET_API_URL}/activity?user=${traderAddress}&type=TRADE&limit=${limit}`;
      const response = await axios.get(url, {
        timeout: this.config.requestTimeoutMs,
      });
      return response.data || [];
    } catch (error) {
      this.logger.warn(`Error getting activity for ${traderAddress.slice(0, 8)}...:`, error.message);
      return [];
    }
  }

  async getPositions(walletAddress) {
    try {
      const url = `${POLYMARKET_API_URL}/positions?user=${walletAddress}`;
      const response = await axios.get(url, {
        timeout: this.config.requestTimeoutMs,
      });
      return response.data || [];
    } catch (error) {
      this.logger.warn('Error getting positions:', error.message);
      return [];
    }
  }

  async executeOrder(tokenId, side, amountUSD, maxRetries = 3) {
    try {
      this.logger.info(`Executing order: ${side} $${amountUSD.toFixed(2)} token ${tokenId.slice(0, 10)}...`);

      const orderBook = await this.clobClient.getOrderBook(tokenId);

      if (!orderBook) {
        throw new Error('Failed to get orderbook');
      }

      const levels = side === 'BUY' ? orderBook.asks : orderBook.bids;

      if (!levels || levels.length === 0) {
        throw new Error(`No ${side === 'BUY' ? 'asks' : 'bids'} in orderbook`);
      }

      const bestLevel = levels[0];
      const price = parseFloat(bestLevel.price);
      const size = parseFloat(bestLevel.size);

      this.logger.verbose(`Best level: ${size} @ $${price}`);

      const maxOrderValue = size * price;
      const orderValue = Math.min(amountUSD, maxOrderValue);
      const tokenAmount = orderValue / price;

      if (tokenAmount < 1) {
        throw new Error(`Token amount too small: ${tokenAmount.toFixed(4)}`);
      }

      const sideEnum = side === 'BUY' ? 0 : 1;
      const signedOrder = await this.clobClient.createMarketOrder({
        side: sideEnum,
        tokenID: tokenId,
        amount: tokenAmount,
        price: price,
      });

      const result = await this.clobClient.postOrder(signedOrder, 2);

      if (result.success) {
        this.logger.success(`Order executed: ${side} ${tokenAmount.toFixed(4)} tokens @ $${price}`);
        return {
          success: true,
          executedSizeUSD: orderValue,
          tokenAmount,
          price,
        };
      } else {
        const errorMsg = result?.data || 'Unknown error';
        throw new Error(`Order rejected: ${errorMsg}`);
      }
    } catch (error) {
      this.logger.error(`Order execution error: ${error.message}`);

      if (maxRetries > 0) {
        this.logger.info(`Retrying... (${maxRetries} attempts left)`);
        await this.sleep(1000);
        return this.executeOrder(tokenId, side, amountUSD, maxRetries - 1);
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class CopyTradingModule {
  constructor() {
    this.logger = new Logger(config.logLevel, config.coloredOutput);
    this.storage = new Storage(config.historyFile, config.dailyStatsFile, this.logger);
    this.client = null;
    this.running = false;
  }

  async init() {
    this.logger.header('🚀 POLYMARKET COPY TRADING MODULE');

    if (!config.traders || config.traders.length === 0) {
      this.logger.error('No traders specified for copying in copy-trading-config.js');
      this.logger.info('Add trader addresses to config.traders field');
      return false;
    }

    const privateKey = process.env.COPY_TRADING_PRIVATE_KEY || process.env.PRIVATE_KEY;

    if (!privateKey) {
      this.logger.error('PRIVATE_KEY not found in .env');
      this.logger.info('Add COPY_TRADING_PRIVATE_KEY to .env file');
      return false;
    }

    this.client = new PolymarketClient(privateKey, config, this.logger);

    const initialized = await this.client.init();

    if (!initialized) {
      return false;
    }

    const balances = await this.client.getBalances();
    this.logger.info(`USDC Balance: $${balances.usdc.toFixed(2)}`);
    this.logger.info(`POL Balance: ${balances.pol.toFixed(4)} POL`);

    this.storage.checkAndResetDaily();

    if (config.maxDailyVolumeUSD > 0) {
      const remaining = config.maxDailyVolumeUSD - this.storage.dailyStats.totalVolumeUSD;
      this.logger.info(`Daily limit: $${this.storage.dailyStats.totalVolumeUSD.toFixed(2)} / $${config.maxDailyVolumeUSD.toFixed(2)} (remaining $${remaining.toFixed(2)})`);
    }

    return true;
  }

  async checkAndCopyTrades() {
    const results = {
      newTrades: 0,
      copiedTrades: 0,
      skippedTrades: 0,
      failedTrades: 0,
    };

    const maxAge = config.maxTradeAgeHours * 60 * 60 * 1000;
    const now = Date.now();
    const lastCheck = this.storage.getLastCheckTime();

    this.logger.info(`Checking trades from ${new Date(lastCheck).toLocaleString()} to ${new Date().toLocaleString()}`);

    for (const traderAddress of config.traders) {
      try {
        const activities = await this.client.getTraderActivity(traderAddress);

        this.logger.verbose(`Found ${activities.length} activities for ${traderAddress.slice(0, 8)}...`);

        for (const activity of activities) {
          const activityTime = activity.timestamp || activity.createdAt || 0;
          if (now - activityTime > maxAge) {
            continue;
          }

          if (activity.type !== 'TRADE' && activity.activityType !== 'TRADE') {
            continue;
          }

          if (this.storage.isTradeProcessed(activity.transactionHash)) {
            continue;
          }

          results.newTrades++;

          this.logger.header(`📊 NEW TRADE`);
          this.logger.info(`Trader: ${traderAddress.slice(0, 8)}...${traderAddress.slice(-6)}`);
          this.logger.info(`Market: ${activity.title || activity.slug || activity.asset}`);
          this.logger.info(`Type: ${activity.side}`);
          this.logger.info(`Size: $${(activity.usdcSize || activity.size || 0).toFixed(2)}`);
          this.logger.info(`Price: $${(activity.price || 0).toFixed(4)}`);

          const result = await this.copyTrade(activity, traderAddress);

          if (result.success) {
            results.copiedTrades++;
          } else if (result.skipped) {
            results.skippedTrades++;
          } else {
            results.failedTrades++;
          }
        }

      } catch (error) {
        this.logger.error(`Error processing trader ${traderAddress.slice(0, 8)}...:`, error.message);
      }
    }

    this.storage.setLastCheckTime(now);

    return results;
  }

  async copyTrade(activity, traderAddress) {
    try {
      const side = activity.side;
      const tokenId = activity.asset;
      const conditionId = activity.conditionId;
      const traderOrderSize = activity.usdcSize || activity.size || 0;

      if (config.maxDailyVolumeUSD > 0) {
        const remaining = config.maxDailyVolumeUSD - this.storage.dailyStats.totalVolumeUSD;
        if (remaining <= 0) {
          this.logger.warn('Daily limit exceeded, trade skipped');
          return { success: false, skipped: true };
        }
      }

      const positionSize = this.storage.getPositionSize(conditionId)?.current || 0;

      const balances = await this.client.getBalances();
      const availableBalance = balances.usdc;

      const minGasPOL = 0.1;
      if (balances.pol < minGasPOL) {
        this.logger.warn(`Insufficient POL for gas: ${balances.pol.toFixed(4)} POL < ${minGasPOL} POL`);
        return { success: false, skipped: true, error: 'Insufficient gas' };
      }

      const orderCalc = CopyStrategy.calculateOrderSize(
        config,
        traderOrderSize,
        availableBalance,
        positionSize
      );

      this.logger.info(`Calculation: ${orderCalc.reasoning}`);

      if (orderCalc.finalAmount === 0) {
        this.logger.warn('Order not executed (size below minimum or limit exceeded)');
        return { success: false, skipped: true };
      }

      const result = await this.client.executeOrder(
        tokenId,
        side,
        orderCalc.finalAmount,
        config.orderRetryLimit
      );

      const tradeRecord = {
        transactionHash: activity.transactionHash,
        traderAddress,
        conditionId,
        tokenId,
        side,
        traderOrderSize,
        calculatedSize: orderCalc.finalAmount,
        executedSizeUSD: result.success ? result.executedSizeUSD : 0,
        price: result.price || activity.price,
        status: result.success ? 'success' : 'failed',
        error: result.error,
        timestamp: Date.now(),
      };

      this.storage.addTrade(tradeRecord);

      return {
        success: result.success,
        executedSizeUSD: result.executedSizeUSD || 0,
        tradeRecord,
      };

    } catch (error) {
      this.logger.error('Error copying trade:', error.message);
      return { success: false, error: error.message };
    }
  }

  async runOnce() {
    this.logger.info('Running in single-check mode...');

    const results = await this.checkAndCopyTrades();

    this.logger.separator();
    this.logger.header('📊 RESULTS');
    this.logger.info(`New trades detected: ${results.newTrades}`);
    this.logger.info(`Successfully copied: ${results.copiedTrades}`);
    this.logger.info(`Skipped: ${results.skippedTrades}`);
    this.logger.info(`Failed: ${results.failedTrades}`);

    return results;
  }

  async runDaemon() {
    this.logger.info(`Running in daemon mode (checking every ${config.checkIntervalSeconds} seconds)`);
    this.running = true;

    process.on('SIGINT', () => {
      this.logger.info('\nReceived SIGINT, stopping...');
      this.running = false;
    });

    while (this.running) {
      try {
        await this.checkAndCopyTrades();

        let waited = 0;
        while (waited < config.checkIntervalSeconds * 1000 && this.running) {
          await this.sleep(1000);
          waited += 1000;

          if (waited % 5000 === 0 && this.running) {
            const remaining = Math.ceil((config.checkIntervalSeconds * 1000 - waited) / 1000);
            process.stdout.write(`\r${this.logger.color('cyan', `⏳ Next check in ${remaining} sec...   `)}`);
          }
        }

        if (this.running) {
          console.log();
        }

      } catch (error) {
        this.logger.error('Error in daemon loop:', error.message);
        await this.sleep(5000);
      }
    }

    this.logger.info('Daemon stopped');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async run() {
    try {
      const initialized = await this.init();

      if (!initialized) {
        this.logger.error('Module initialization error');
        return false;
      }

      if (config.mode === 'daemon') {
        await this.runDaemon();
      } else {
        await this.runOnce();
      }

      return true;

    } catch (error) {
      this.logger.error('Critical error:', error.message);
      return false;
    }
  }
}

module.exports = CopyTradingModule;
