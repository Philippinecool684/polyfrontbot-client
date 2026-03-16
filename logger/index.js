const ProdLogger = require('./ProdLogger.js');

let DebugLogger = null;
try {
    DebugLogger = require('./DebugLogger.js');
} catch (e) {
    
}

function createLogger() {
    const mode = process.env.LOG_MODE || 'prod';

    if (mode === 'debug' && DebugLogger) {
        return new DebugLogger();
    }

    return new ProdLogger();
}

const logger = createLogger();

module.exports = logger;
