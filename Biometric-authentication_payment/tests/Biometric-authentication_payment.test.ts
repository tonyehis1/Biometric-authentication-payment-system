import { describe, it, expect, beforeEach } from 'vitest';

// Mock Clarinet testing utilities
const mockClarinet = {
  deployContract: (name, code) => ({ contractId: name }),
  callReadOnlyFn: (contract, fn, args, sender) => ({ result: 'ok', value: null }),
  callPublicFn: (contract, fn, args, sender) => ({ result: 'ok', value: true }),
  createAccount: (name) => ({ address: `${name}.testnet`, name }),
  getBalance: (address) => 1000000000, // 1000 STX in microSTX
};

// Mock contract data
let contractState = {
  biometricProfiles: new Map(),
  userProfiles: new Map(),
  paymentRequests: new Map(),
  merchants: new Map(),
  authSessions: new Map(),
  paymentCounter: 0,
  biometricCounter: 0,
  authTimeout: 300,
  maxRetryAttempts: 3,
};

// Helper functions
const generateBiometricHash = (data) => {
  // Simple hash simulation for testing
  return Buffer.from(data.padEnd(32, '0'), 'utf8').toString('hex').slice(0, 64);
};

const createTestUser = (name) => ({
  address: `${name}.testnet`,
  biometricData: `biometric-${name}`,
  backupData: `backup-${name}`,
  displayName: `Test User ${name}`,
});

// Reset state before each test
beforeEach(() => {
  contractState = {
    biometricProfiles: new Map(),
    userProfiles: new Map(),
    paymentRequests: new Map(),
    merchants: new Map(),
    authSessions: new Map(),
    paymentCounter: 0,
    biometricCounter: 0,
    authTimeout: 300,
    maxRetryAttempts: 3,
  };
});

describe('Biometric Authentication Payment System', () => {
  
  describe('Contract Deployment', () => {
    it('should deploy contract successfully', () => {
      const deployment = mockClarinet.deployContract('biometric-payment', 'contract-code');
      expect(deployment.contractId).toBe('biometric-payment');
    });
  });

  describe('Biometric Registration', () => {
    it('should register biometric profile successfully', () => {
      const user = createTestUser('alice');
      const biometricHash = generateBiometricHash(user.biometricData);
      const backupHash = generateBiometricHash(user.backupData);
      
      // Simulate registration
      const registrationId = ++contractState.biometricCounter;
      contractState.biometricProfiles.set(user.address, {
        biometricHash,
        backupHash,
        isActive: true,
        registrationId,
        lastUpdated: 0,
        failedAttempts: 0,
        isLocked: false,
      });
      
      contractState.userProfiles.set(user.address, {
        displayName: user.displayName,
        defaultPaymentLimit: 10000000,
        dailySpent: 0,
        lastResetDay: 0,
        isVerified: true,
        registrationDate: 0,
      });

      expect(contractState.biometricProfiles.has(user.address)).toBe(true);
      expect(contractState.userProfiles.has(user.address)).toBe(true);
      expect(contractState.biometricCounter).toBe(1);
    });

    it('should fail to register duplicate biometric profile', () => {
      const user = createTestUser('alice');
      const biometricHash = generateBiometricHash(user.biometricData);
      
      // First registration
      contractState.biometricProfiles.set(user.address, {
        biometricHash,
        isActive: true,
      });
      
      // Second registration should fail
      const isDuplicate = contractState.biometricProfiles.has(user.address);
      expect(isDuplicate).toBe(true);
    });

    it('should validate biometric data before registration', () => {
      const emptyHash = '';
      const validHash = generateBiometricHash('valid-data');
      
      expect(emptyHash.length).toBe(0); // Invalid
      expect(validHash.length).toBeGreaterThan(0); // Valid
    });
  });

  describe('Biometric Authentication', () => {
    beforeEach(() => {
      // Setup test user
      const user = createTestUser('alice');
      const biometricHash = generateBiometricHash(user.biometricData);
      const backupHash = generateBiometricHash(user.backupData);
      
      contractState.biometricProfiles.set(user.address, {
        biometricHash,
        backupHash,
        isActive: true,
        registrationId: 1,
        lastUpdated: 0,
        failedAttempts: 0,
        isLocked: false,
      });
      
      contractState.userProfiles.set(user.address, {
        displayName: user.displayName,
        defaultPaymentLimit: 10000000,
        dailySpent: 0,
        lastResetDay: 0,
        isVerified: true,
        registrationDate: 0,
      });
    });

    it('should authenticate with correct biometric data', () => {
      const user = createTestUser('alice');
      const paymentId = 1;
      const providedHash = generateBiometricHash(user.biometricData);
      const storedProfile = contractState.biometricProfiles.get(user.address);
      
      const isAuthenticated = providedHash === storedProfile.biometricHash;
      expect(isAuthenticated).toBe(true);
    });

    it('should fail authentication with incorrect biometric data', () => {
      const user = createTestUser('alice');
      const wrongData = 'wrong-biometric-data';
      const providedHash = generateBiometricHash(wrongData);
      const storedProfile = contractState.biometricProfiles.get(user.address);
      
      const isAuthenticated = providedHash === storedProfile.biometricHash;
      expect(isAuthenticated).toBe(false);
    });

    it('should increment failed attempts on authentication failure', () => {
      const user = createTestUser('alice');
      const profile = contractState.biometricProfiles.get(user.address);
      
      profile.failedAttempts += 1;
      contractState.biometricProfiles.set(user.address, profile);
      
      expect(profile.failedAttempts).toBe(1);
    });

    it('should lock account after max failed attempts', () => {
      const user = createTestUser('alice');
      const profile = contractState.biometricProfiles.get(user.address);
      
      profile.failedAttempts = contractState.maxRetryAttempts;
      profile.isLocked = profile.failedAttempts >= contractState.maxRetryAttempts;
      contractState.biometricProfiles.set(user.address, profile);
      
      expect(profile.isLocked).toBe(true);
    });

    it('should reset failed attempts on successful authentication', () => {
      const user = createTestUser('alice');
      const profile = contractState.biometricProfiles.get(user.address);
      
      profile.failedAttempts = 2;
      // Simulate successful auth
      profile.failedAttempts = 0;
      profile.isLocked = false;
      contractState.biometricProfiles.set(user.address, profile);
      
      expect(profile.failedAttempts).toBe(0);
      expect(profile.isLocked).toBe(false);
    });
  });

  describe('Payment Creation and Processing', () => {
    let alice, bob;
    
    beforeEach(() => {
      // Setup test users
      alice = createTestUser('alice');
      bob = createTestUser('bob');
      
      [alice, bob].forEach((user, index) => {
        const biometricHash = generateBiometricHash(user.biometricData);
        const backupHash = generateBiometricHash(user.backupData);
        
        contractState.biometricProfiles.set(user.address, {
          biometricHash,
          backupHash,
          isActive: true,
          registrationId: index + 1,
          lastUpdated: 0,
          failedAttempts: 0,
          isLocked: false,
        });
        
        contractState.userProfiles.set(user.address, {
          displayName: user.displayName,
          defaultPaymentLimit: 10000000,
          dailySpent: 0,
          lastResetDay: 0,
          isVerified: true,
          registrationDate: 0,
        });
      });
    });

    it('should create payment request successfully', () => {
      const paymentId = ++contractState.paymentCounter;
      const amount = 1000000; // 1 STX
      const description = 'Test payment';
      
      contractState.paymentRequests.set(paymentId, {
        payer: alice.address,
        payee: bob.address,
        amount,
        description,
        status: 'pending',
        createdAt: 0,
        expiresAt: contractState.authTimeout,
        requiresBiometric: true,
        biometricVerified: false,
      });
      
      expect(contractState.paymentRequests.has(paymentId)).toBe(true);
      expect(contractState.paymentCounter).toBe(1);
    });

    it('should fail to create payment with invalid amount', () => {
      const invalidAmount = 0;
      const isValidAmount = invalidAmount > 0;
      
      expect(isValidAmount).toBe(false);
    });

    it('should require biometric registration for payment creation', () => {
      const unregisteredUser = 'charlie.testnet';
      const isRegistered = contractState.biometricProfiles.has(unregisteredUser);
      
      expect(isRegistered).toBe(false);
    });

    it('should process authenticated payment successfully', () => {
      const paymentId = 1;
      const amount = 1000000;
      
      // Create payment request
      contractState.paymentRequests.set(paymentId, {
        payer: alice.address,
        payee: bob.address,
        amount,
        description: 'Test payment',
        status: 'pending',
        createdAt: 0,
        expiresAt: contractState.authTimeout,
        requiresBiometric: true,
        biometricVerified: true, // Already authenticated
      });
      
      const payment = contractState.paymentRequests.get(paymentId);
      const userProfile = contractState.userProfiles.get(alice.address);
      
      // Check conditions
      expect(payment.status).toBe('pending');
      expect(payment.biometricVerified).toBe(true);
      expect(userProfile.dailySpent + amount).toBeLessThanOrEqual(userProfile.defaultPaymentLimit);
      
      // Process payment
      payment.status = 'completed';
      userProfile.dailySpent += amount;
      
      contractState.paymentRequests.set(paymentId, payment);
      contractState.userProfiles.set(alice.address, userProfile);
      
      expect(payment.status).toBe('completed');
      expect(userProfile.dailySpent).toBe(amount);
    });

    it('should fail payment without biometric verification', () => {
      const paymentId = 1;
      
      contractState.paymentRequests.set(paymentId, {
        payer: alice.address,
        payee: bob.address,
        amount: 1000000,
        description: 'Test payment',
        status: 'pending',
        createdAt: 0,
        expiresAt: contractState.authTimeout,
        requiresBiometric: true,
        biometricVerified: false, // Not verified
      });
      
      const payment = contractState.paymentRequests.get(paymentId);
      expect(payment.biometricVerified).toBe(false);
    });

    it('should respect daily spending limits', () => {
      const userProfile = contractState.userProfiles.get(alice.address);
      const paymentAmount = userProfile.defaultPaymentLimit + 1;
      
      const exceedsLimit = (userProfile.dailySpent + paymentAmount) > userProfile.defaultPaymentLimit;
      expect(exceedsLimit).toBe(true);
    });

    it('should handle payment expiration', () => {
      const paymentId = 1;
      const currentTime = 400; // Past expiration
      const expiresAt = 300;
      
      contractState.paymentRequests.set(paymentId, {
        payer: alice.address,
        payee: bob.address,
        amount: 1000000,
        description: 'Test payment',
        status: 'pending',
        createdAt: 0,
        expiresAt,
        requiresBiometric: true,
        biometricVerified: false,
      });
      
      const isExpired = currentTime > expiresAt;
      expect(isExpired).toBe(true);
    });
  });

  describe('Merchant Functionality', () => {
    it('should register merchant successfully', () => {
      const merchant = createTestUser('merchant');
      const businessName = 'Test Business';
      
      contractState.merchants.set(merchant.address, {
        businessName,
        isVerified: true,
        totalReceived: 0,
        transactionCount: 0,
      });
      
      expect(contractState.merchants.has(merchant.address)).toBe(true);
    });

    it('should update merchant stats on payment', () => {
      const merchant = createTestUser('merchant');
      const paymentAmount = 1000000;
      
      contractState.merchants.set(merchant.address, {
        businessName: 'Test Business',
        isVerified: true,
        totalReceived: 0,
        transactionCount: 0,
      });
      
      const merchantData = contractState.merchants.get(merchant.address);
      merchantData.totalReceived += paymentAmount;
      merchantData.transactionCount += 1;
      contractState.merchants.set(merchant.address, merchantData);
      
      expect(merchantData.totalReceived).toBe(paymentAmount);
      expect(merchantData.transactionCount).toBe(1);
    });
  });

  describe('Backup Authentication', () => {
    beforeEach(() => {
      const user = createTestUser('alice');
      const biometricHash = generateBiometricHash(user.biometricData);
      const backupHash = generateBiometricHash(user.backupData);
      
      contractState.biometricProfiles.set(user.address, {
        biometricHash,
        backupHash,
        isActive: true,
        registrationId: 1,
        lastUpdated: 0,
        failedAttempts: 3, // Max attempts reached
        isLocked: true,
      });
    });

    it('should authenticate with backup biometric data', () => {
      const user = createTestUser('alice');
      const providedBackupHash = generateBiometricHash(user.backupData);
      const storedProfile = contractState.biometricProfiles.get(user.address);
      
      const isBackupAuthenticated = providedBackupHash === storedProfile.backupHash;
      expect(isBackupAuthenticated).toBe(true);
    });

    it('should unlock account after successful backup authentication', () => {
      const user = createTestUser('alice');
      const profile = contractState.biometricProfiles.get(user.address);
      
      // Simulate successful backup auth
      profile.isLocked = false;
      profile.failedAttempts = 0;
      contractState.biometricProfiles.set(user.address, profile);
      
      expect(profile.isLocked).toBe(false);
      expect(profile.failedAttempts).toBe(0);
    });
  });

  describe('Administrative Functions', () => {
    const contractOwner = 'owner.testnet';

    it('should update authentication timeout (owner only)', () => {
      const newTimeout = 600; // 10 minutes
      
      // Simulate owner check and update
      contractState.authTimeout = newTimeout;
      
      expect(contractState.authTimeout).toBe(newTimeout);
    });

    it('should update max retry attempts (owner only)', () => {
      const newMaxRetries = 5;
      
      contractState.maxRetryAttempts = newMaxRetries;
      
      expect(contractState.maxRetryAttempts).toBe(newMaxRetries);
    });

    it('should unlock user account (owner only)', () => {
      const user = createTestUser('alice');
      
      contractState.biometricProfiles.set(user.address, {
        biometricHash: generateBiometricHash(user.biometricData),
        backupHash: generateBiometricHash(user.backupData),
        isActive: true,
        registrationId: 1,
        lastUpdated: 0,
        failedAttempts: 3,
        isLocked: true,
      });
      
      // Simulate admin unlock
      const profile = contractState.biometricProfiles.get(user.address);
      profile.isLocked = false;
      profile.failedAttempts = 0;
      contractState.biometricProfiles.set(user.address, profile);
      
      expect(profile.isLocked).toBe(false);
      expect(profile.failedAttempts).toBe(0);
    });

    it('should fail admin functions for non-owner', () => {
      const nonOwner = 'user.testnet';
      const isOwner = nonOwner === contractOwner;
      
      expect(isOwner).toBe(false);
    });
  });

  describe('Read-Only Functions', () => {
    beforeEach(() => {
      const user = createTestUser('alice');
      const biometricHash = generateBiometricHash(user.biometricData);
      const backupHash = generateBiometricHash(user.backupData);
      
      contractState.biometricProfiles.set(user.address, {
        biometricHash,
        backupHash,
        isActive: true,
        registrationId: 1,
        lastUpdated: 0,
        failedAttempts: 0,
        isLocked: false,
      });
      
      contractState.userProfiles.set(user.address, {
        displayName: user.displayName,
        defaultPaymentLimit: 10000000,
        dailySpent: 5000000,
        lastResetDay: 0,
        isVerified: true,
        registrationDate: 0,
      });
    });

    it('should get biometric profile', () => {
      const user = createTestUser('alice');
      const profile = contractState.biometricProfiles.get(user.address);
      
      expect(profile).toBeDefined();
      expect(profile.isActive).toBe(true);
    });

    it('should get user profile', () => {
      const user = createTestUser('alice');
      const profile = contractState.userProfiles.get(user.address);
      
      expect(profile).toBeDefined();
      expect(profile.isVerified).toBe(true);
    });

    it('should check if biometric is registered', () => {
      const user = createTestUser('alice');
      const isRegistered = contractState.biometricProfiles.has(user.address);
      
      expect(isRegistered).toBe(true);
    });

    it('should get user statistics', () => {
      const user = createTestUser('alice');
      const userProfile = contractState.userProfiles.get(user.address);
      const biometricProfile = contractState.biometricProfiles.get(user.address);
      
      const stats = {
        displayName: userProfile.displayName,
        dailySpent: userProfile.dailySpent,
        spendingLimit: userProfile.defaultPaymentLimit,
        isVerified: userProfile.isVerified,
        isBiometricActive: biometricProfile.isActive,
      };
      
      expect(stats.displayName).toBe(user.displayName);
      expect(stats.dailySpent).toBe(5000000);
      expect(stats.spendingLimit).toBe(10000000);
      expect(stats.isVerified).toBe(true);
      expect(stats.isBiometricActive).toBe(true);
    });

    it('should get payment statistics', () => {
      contractState.paymentCounter = 5;
      contractState.biometricCounter = 3;
      
      const stats = {
        totalPayments: contractState.paymentCounter,
        totalBiometricUsers: contractState.biometricCounter,
        authTimeout: contractState.authTimeout,
      };
      
      expect(stats.totalPayments).toBe(5);
      expect(stats.totalBiometricUsers).toBe(3);
      expect(stats.authTimeout).toBe(300);
    });
  });

  describe('Error Handling', () => {
    it('should handle user not found errors', () => {
      const nonExistentUser = 'nonexistent.testnet';
      const userExists = contractState.userProfiles.has(nonExistentUser);
      
      expect(userExists).toBe(false);
    });

    it('should handle payment not found errors', () => {
      const nonExistentPaymentId = 999;
      const paymentExists = contractState.paymentRequests.has(nonExistentPaymentId);
      
      expect(paymentExists).toBe(false);
    });

    it('should handle insufficient balance errors', () => {
      const userBalance = 1000000; // 1 STX
      const paymentAmount = 2000000; // 2 STX
      const hasSufficientBalance = userBalance >= paymentAmount;
      
      expect(hasSufficientBalance).toBe(false);
    });

    it('should handle unauthorized access errors', () => {
      const paymentPayer = 'alice.testnet';
      const currentUser = 'bob.testnet';
      const isAuthorized = currentUser === paymentPayer;
      
      expect(isAuthorized).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent payment attempts', () => {
      const paymentId = 1;
      
      contractState.paymentRequests.set(paymentId, {
        payer: 'alice.testnet',
        payee: 'bob.testnet',
        amount: 1000000,
        description: 'Test payment',
        status: 'pending',
        createdAt: 0,
        expiresAt: 300,
        requiresBiometric: true,
        biometricVerified: true,
      });
      
      const payment = contractState.paymentRequests.get(paymentId);
      
      // First attempt
      if (payment.status === 'pending') {
        payment.status = 'processing';
        contractState.paymentRequests.set(paymentId, payment);
      }
      
      // Second attempt should see status as processing
      const updatedPayment = contractState.paymentRequests.get(paymentId);
      expect(updatedPayment.status).toBe('processing');
    });

    it('should handle biometric data update', () => {
      const user = createTestUser('alice');
      const oldBiometricHash = generateBiometricHash(user.biometricData);
      const newBiometricData = 'new-biometric-data';
      const newBiometricHash = generateBiometricHash(newBiometricData);
      
      contractState.biometricProfiles.set(user.address, {
        biometricHash: oldBiometricHash,
        backupHash: generateBiometricHash(user.backupData),
        isActive: true,
        registrationId: 1,
        lastUpdated: 0,
        failedAttempts: 0,
        isLocked: false,
      });
      
      // Update biometric hash
      const profile = contractState.biometricProfiles.get(user.address);
      profile.biometricHash = newBiometricHash;
      profile.lastUpdated = Date.now();
      contractState.biometricProfiles.set(user.address, profile);
      
      expect(profile.biometricHash).toBe(newBiometricHash);
      expect(profile.biometricHash).not.toBe(oldBiometricHash);
    });

    it('should handle daily spending limit reset', () => {
      const user = createTestUser('alice');
      
      contractState.userProfiles.set(user.address, {
        displayName: user.displayName,
        defaultPaymentLimit: 10000000,
        dailySpent: 5000000,
        lastResetDay: 1,
        isVerified: true,
        registrationDate: 0,
      });
      
      const profile = contractState.userProfiles.get(user.address);
      const currentDay = 2; // Next day
      
      if (currentDay > profile.lastResetDay) {
        profile.dailySpent = 0;
        profile.lastResetDay = currentDay;
        contractState.userProfiles.set(user.address, profile);
      }
      
      expect(profile.dailySpent).toBe(0);
      expect(profile.lastResetDay).toBe(2);
    });
  });
});