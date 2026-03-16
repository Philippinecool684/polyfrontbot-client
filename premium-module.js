#!/usr/bin/env node

const { EnterpriseLicenseManager } = require('./lib/enterprise-license-manager');
const crypto = require('crypto');
const logger = require('./logger');

class PremiumModule {
  constructor() {
    this.licenseManager = new EnterpriseLicenseManager();
    this.sessionKey = null;
    this.isActivated = false;

    logger.info('[PREMIUM] Module initialized');
  }

  async getChallenge(hwid, systemData) {
    try {
      const SERVER_URL = process.env.SERVER_URL || 'https://api.polyfront.live';
      const axios = require('axios');

      const response = await axios.post(`${SERVER_URL}/api/request-challenge`, {
        hwid: hwid,
        systemData: systemData
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (response.data.success && response.data.challenge) {
        logger.info('[PREMIUM] 🎯 Challenge received:', response.data.challenge.challengeId?.substring(0, 8) + '...');
        return response.data.challenge;
      } else {
        logger.info('[PREMIUM] ⚠️ Challenge-Response disabled, using direct auth');
        return null;
      }

    } catch (error) {
      logger.info('[PREMIUM] ⚠️ Challenge request failed, falling back to direct auth:', error.message);
      return null;
    }
  }

  generateResponse(challenge, hwid) {
    const crypto = require('crypto');
    const clientSecret = 'cliW5nR4tY6uI3oP0aS8bV2xQ1jF7zCm';

    const hwidHash = crypto.createHash('sha256')
      .update(hwid + challenge.nonce + challenge.timestamp.toString())
      .digest('hex');

    const solution = crypto.createHmac('sha256', clientSecret)
      .update(hwid + challenge.nonce + challenge.timestamp)
      .digest('hex');

    const responseData = {
      hwidHash: hwidHash,
      solution: solution,
      challengeId: challenge.challengeId
    };

    const signature = crypto.createHmac('sha256', clientSecret)
      .update(JSON.stringify(responseData))
      .digest('hex');

    return {
      hwidHash: hwidHash,
      solution: solution,
      signature: signature
    };
  }

  async activate(licenseKey, systemData) {
    logger.info('[PREMIUM] 🔑 Checking module authorization...');

    try {
      const SERVER_URL = process.env.SERVER_URL || 'https://api.polyfront.live';
      const axios = require('axios');

      const crypto = require('crypto');
      const hwidString = JSON.stringify({
        platform: systemData.platform,
        arch: systemData.arch,
        hostname: systemData.hostname,
        cpuModel: systemData.cpus?.[0]?.model,
        totalmem: Math.round(systemData.totalmem / (1024 * 1024))
      });

      const hwid = crypto.createHash('sha256').update(hwidString).digest('hex').substring(0, 32);

      const challenge = await this.getChallenge(hwid, systemData);

      if (!licenseKey) {
        if (challenge) {
          try {
            logger.info('[PREMIUM] 🎯 Using Challenge-Response authentication...');
            const response = this.generateResponse(challenge, hwid);

            const authResponse = await axios.post(`${SERVER_URL}/api/authenticate-device`, {
              hwid: hwid,
              systemData: systemData,
              challengeId: challenge.challengeId,
              response: response
            }, { timeout: 15000 });

            if (authResponse.data.success) {
              this.isActivated = true;
              this.sessionKey = authResponse.data.sessionKey?.keyId || authResponse.data.challenge?.id;

              logger.info('[PREMIUM] ✅ Challenge-Response authentication successful!');
              logger.info(`   👤 User: ${authResponse.data.user}`);
              logger.info(`   🏆 Tier: ${authResponse.data.tier}`);
              logger.info(`   🔗 HWID: ${hwid.substring(0, 16)}...`);

              await this.loadEnterpriseFeatures([]);

              return true;
            } else {
              return false;
            }
          } catch (authError) {
            if (authError.response && authError.response.status === 403) {
              logger.info('[PREMIUM] ❌ Device not authorized');
              return false;
            } else {
              throw authError;
            }
          }
        } else {
          try {
            logger.info('[PREMIUM] 🔄 Using fallback direct authentication...');
            const authResponse = await axios.post(`${SERVER_URL}/api/authenticate-device`, {
              hwid: hwid,
              systemData: systemData
            }, { timeout: 15000 });

            if (authResponse.data.success) {
              this.isActivated = true;
              this.sessionKey = authResponse.data.sessionKey?.keyId || authResponse.data.challenge?.id;

              logger.info('[PREMIUM] ✅ HWID authentication successful!');
              logger.info(`   👤 User: ${authResponse.data.user}`);
              logger.info(`   🏆 Tier: ${authResponse.data.tier}`);
              logger.info(`   🔗 HWID: ${hwid.substring(0, 16)}...`);

              await this.loadEnterpriseFeatures([]);

              return true;
            } else {
              return false;
            }
          } catch (authError) {
            if (authError.response && authError.response.status === 403) {
              logger.info('[PREMIUM] ❌ Device not authorized');
              return false;
            } else {
              throw authError;
            }
          }
        }
      } else {
        logger.info('[PREMIUM] 🔑 Activating license key (new activation or upgrade)...');
        logger.info(`   🔗 HWID: ${hwid.substring(0, 16)}...`);

        const response = await axios.post(`${SERVER_URL}/api/activate-license`, {
          licenseKey: licenseKey,
          systemData: systemData
        }, {
          timeout: 30000
        });

        const result = response.data;

        if (result.success) {
          this.isActivated = true;
          this.sessionKey = result.challenge?.id || 'session-key';

          logger.info('[PREMIUM] ✅ License activation successful!');
          logger.info(`   👤 User: ${result.license.user}`);
          logger.info(`   🏆 Tier: ${result.license.tier}`);
          logger.info(`   🔗 HWID: ${result.license.hardwareId?.substring(0, 16)}...`);

          await this.loadEnterpriseFeatures([]);

          return true;
        } else {
          logger.info('[PREMIUM] ❌ License activation failed');
          logger.info(`   Error: ${result.error || 'Unknown error'}`);
          if (result.debug) {
            logger.info(`   Debug: ${JSON.stringify(result.debug)}`);
          }
          return false;
        }
      }

    } catch (error) {
      logger.info('[PREMIUM] ❌ Activation error');
      if (error.response) {
        logger.info(`   Status: ${error.response.status}`);
        logger.info(`   Error: ${error.response.data?.error || error.message}`);
        if (error.response.data?.debug) {
          logger.info(`   Debug: ${JSON.stringify(error.response.data.debug)}`);
        }
      } else {
        logger.info(`   Error: ${error.message}`);
      }
      return false;
    }
  }

  async loadEnterpriseFeatures(features) {
    logger.info('[PREMIUM] 📦 Loading enterprise features...');

    if (features.desktopIntegration) {
      logger.info('   🖥️ Desktop integration enabled');
    }

    if (features.activationFiles) {
      logger.info(`   📁 Activation files: ${features.activationFiles.length}`);
    }

    if (features.configFiles) {
      logger.info(`   ⚙️ Config files: ${features.configFiles.length}`);
    }
  }

  getStatus() {
    return {
      activated: this.isActivated,
      version: '2.0.0',
      tier: 'premium'
    };
  }
}

module.exports = PremiumModule;
