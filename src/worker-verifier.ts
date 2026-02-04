/**
 * Immobiliare.it Verifier Worker
 *
 * Verifies properties that haven't been seen recently.
 * Marks them as inactive if they're no longer available.
 *
 * Usage:
 *   npm run worker:verifier
 */

import { RedisQueue } from './redis-queue';
import { ScraperDatabase } from './database';
import { markPropertyInactive } from './core';
import { createLogger } from './logger';
import { randomDelay } from './utils';
import axios from 'axios';

const logger = createLogger('Verifier');

const BASE_URL = 'https://www.immobiliare.it';

export class ImmobiliareVerifier {
  private queue: RedisQueue;
  private db: ScraperDatabase;
  private workerId: string;
  private isRunning: boolean = false;
  private verifiedCount: number = 0;
  private inactiveCount: number = 0;
  private activeCount: number = 0;

  constructor(workerId?: string) {
    this.workerId = workerId || `verifier-${process.pid}`;
    this.queue = new RedisQueue('immobiliare');
    this.db = new ScraperDatabase();
  }

  async initialize() {
    await this.queue.initialize();
    await this.db.initialize();
    logger.info(`Verifier ${this.workerId} initialized`);
  }

  /**
   * Check if property still exists on portal
   */
  async verifyProperty(listingId: string): Promise<boolean> {
    const url = `${BASE_URL}/annunci/${listingId}/`;

    try {
      const response = await axios.head(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 10000,
        validateStatus: (status) => status < 500, // Don't throw on 404
      });

      // Property exists if we get 200
      return response.status === 200;
    } catch (error) {
      logger.error(`Error verifying ${listingId}:`, error);
      return true; // Assume exists on error (don't mark as inactive)
    }
  }

  /**
   * Process single property verification
   */
  async processVerification(id: string): Promise<void> {
    try {
      logger.info(`[${this.workerId}] Verifying ${id}...`);

      const exists = await this.verifyProperty(id);

      if (exists) {
        // Property still active
        logger.info(`[${this.workerId}] ✓ ${id} - still active`);
        await this.queue.updateLastSeen(id);
        this.activeCount++;
      } else {
        // Property removed/sold
        logger.info(`[${this.workerId}] ✗ ${id} - INACTIVE`);

        // Mark as verified inactive in Redis
        await this.queue.markVerifiedInactive(id);

        // Send to Core Service
        await markPropertyInactive(id, 'verified_removed');

        // Update database
        await this.db.updatePropertyMetadata(id, {
          lastSeen: new Date(),
          currentStatus: 'inactive',
          currentPrice: null,
          hasChanges: false,
        });

        this.inactiveCount++;
      }

      this.verifiedCount++;
    } catch (error) {
      logger.error(`[${this.workerId}] Error verifying ${id}:`, error);
    }
  }

  /**
   * Find and queue missing properties
   */
  async queueMissingProperties(hoursThreshold: number = 24): Promise<number> {
    logger.info(`Finding properties not seen in last ${hoursThreshold} hours...`);

    const missingIds = await this.queue.findMissingProperties(hoursThreshold);
    logger.info(`Found ${missingIds.length} potentially missing properties`);

    if (missingIds.length > 0) {
      const queuedCount = await this.queue.pushToMissingQueue(missingIds);
      logger.info(`Queued ${queuedCount} properties for verification`);
      return queuedCount;
    }

    return 0;
  }

  /**
   * Start verification worker
   */
  async start(): Promise<void> {
    this.isRunning = true;
    logger.info(`[${this.workerId}] Starting verifier...`);

    // First, queue missing properties
    await this.queueMissingProperties(24); // 24 hours

    // Process verification queue
    while (this.isRunning) {
      try {
        // Pop from missing queue
        const id = await this.queue.popFromMissingQueue(5);

        if (!id) {
          const queueDepth = await this.queue.getMissingQueueDepth();
          if (queueDepth === 0) {
            logger.info(`[${this.workerId}] Missing queue empty, stopping...`);
            break;
          }
          continue;
        }

        // Verify property
        await this.processVerification(id);

        // Rate limiting
        await randomDelay(1000, 2000);

        // Log progress every 10 verifications
        if (this.verifiedCount % 10 === 0) {
          logger.info(
            `[${this.workerId}] Progress: ${this.verifiedCount} verified ` +
            `(${this.activeCount} active, ${this.inactiveCount} inactive)`
          );
        }
      } catch (error) {
        logger.error(`[${this.workerId}] Verifier error:`, error);
        await randomDelay(5000, 10000);
      }
    }

    logger.info(
      `[${this.workerId}] Verifier stopped. ` +
      `Verified: ${this.verifiedCount}, Active: ${this.activeCount}, Inactive: ${this.inactiveCount}`
    );
  }

  /**
   * Stop verifier
   */
  stop(): void {
    this.isRunning = false;
    logger.info(`[${this.workerId}] Stopping verifier...`);
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.queue.close();
    await this.db.close();
    logger.info(`[${this.workerId}] Verifier closed`);
  }
}

// ===== Main Execution =====

async function main() {
  const verifier = new ImmobiliareVerifier();

  try {
    await verifier.initialize();
    await verifier.start();
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await verifier.close();
  }

  process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('\nReceived SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('\nReceived SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Execute
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}
