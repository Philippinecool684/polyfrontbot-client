const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const LOGS_DIR = path.join(__dirname, 'logs');

function ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function getSyncFilePaths() {
    ensureDirs();
    return {
        sessionLog: path.join(LOGS_DIR, 'session.log'),
        statistics: path.join(DATA_DIR, 'statistics.json'),
        localConfig: path.join(DATA_DIR, 'trading-config.local.json')
    };
}

function logSession(event, data = {}) {
    try {
        const paths = getSyncFilePaths();
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${event}: ${JSON.stringify(data)}\n`;
        fs.appendFileSync(paths.sessionLog, logEntry);
    } catch (e) {}
}

function updateStatistics(stats) {
    try {
        const paths = getSyncFilePaths();
        let current = {};
        
        if (fs.existsSync(paths.statistics)) {
            try {
                current = JSON.parse(fs.readFileSync(paths.statistics, 'utf8'));
            } catch (e) {}
        }
        
        const updated = {
            ...current,
            lastUpdated: new Date().toISOString(),
            sessionsCount: (current.sessionsCount || 0) + (stats.newSession ? 1 : 0),
            totalTrades: (current.totalTrades || 0) + (stats.trades || 0),
            totalProfit: ((current.totalProfit || 0) + (stats.profit || 0)).toFixed(6),
            lastTradeTime: stats.tradeTime || current.lastTradeTime
        };
        
        fs.writeFileSync(paths.statistics, JSON.stringify(updated, null, 2));
    } catch (e) {}
}

function saveLocalConfig(config) {
    try {
        const paths = getSyncFilePaths();
        const localConfig = {
            savedAt: new Date().toISOString(),
            settings: config
        };
        fs.writeFileSync(paths.localConfig, JSON.stringify(localConfig, null, 2));
    } catch (e) {}
}

function initialize() {
    ensureDirs();
    logSession('APP_START', { version: '1.0.0' });
    updateStatistics({ newSession: true });
}

module.exports = {
    getSyncFilePaths,
    logSession,
    updateStatistics,
    saveLocalConfig,
    initialize,
    DATA_DIR,
    LOGS_DIR
};
