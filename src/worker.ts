/**
 * Immobiliare.it Worker - Phase 2: Detail Fetching
 *
 * Consumes listing IDs from Redis queue and fetches property details.
 *
 * Features:
 * - Distributed processing (run multiple workers)
 * - Automatic retry with exponential backoff
 * - Change detection with checksums
 * - Rate limiting per worker
 *
 * Usage:
 *   npm run worker
 */

import axios from 'axios';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { config } from './config';
import { createLogger } from './logger';
import { randomDelay } from './utils';
import { RedisQueue } from './redis-queue';
import { ScraperDatabase } from './database';
import { sendToCoreService } from './core';
import { createIngestionPayload } from './transformer';
import { parseApiResponse } from './parser';
import type { Property } from './types';
import { applyStealthConfig, applyPageStealth } from './stealth';

const logger = createLogger('Worker');

const BASE_URL = 'https://www.immobiliare.it';

export class ImmobiliareWorker {
  private queue: RedisQueue;
  private db: ScraperDatabase;
  private workerId: string;
  private isRunning: boolean = false;
  private processedCount: number = 0;
  private failedCount: number = 0;
  private changedCount: number = 0;
  private unchangedCount: number = 0;

  // Browser (lazy init for headless scraping if needed)
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(workerId?: string) {
    this.workerId = workerId || `worker-${process.pid}`;
    this.queue = new RedisQueue('immobiliare');
    this.db = new ScraperDatabase();
  }

  async initialize() {
    await this.queue.initialize();
    await this.db.initialize();
    logger.info(`Worker ${this.workerId} initialized`);
  }

  /**
   * Fetch property details using direct URL scraping
   * Falls back to browser if needed
   */
  async fetchPropertyDetail(listingId: string): Promise<Property | null> {
    const url = `${BASE_URL}/annunci/${listingId}/`;

    try {
      // Try direct fetch first (faster)
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml',
          'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        timeout: 30000,
      });

      // Extract __NEXT_DATA__ from HTML
      const html = response.data;
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);

      if (nextDataMatch) {
        const nextData = JSON.parse(nextDataMatch[1]);
        const propertyData = nextData?.props?.pageProps?.listing || nextData?.props?.pageProps?.realEstate;

        if (propertyData) {
          const properties = parseApiResponse({ realEstates: [{ realEstate: propertyData }] });
          return properties[0] || null;
        }
      }

      // Fallback to browser if direct fetch didn't work
      logger.warn(`Direct fetch failed for ${listingId}, trying browser...`);
      return await this.fetchWithBrowser(listingId);
    } catch (error) {
      logger.error(`Fetch failed for ${listingId}:`, error);
      return null;
    }
  }

  /**
   * Fetch using Playwright browser (for DataDome bypass)
   */
  private async fetchWithBrowser(listingId: string): Promise<Property | null> {
    // Lazy initialize browser
    if (!this.browser) {
      await this.initializeBrowser();
    }

    if (!this.context) {
      throw new Error('Browser context not initialized');
    }

    const page = await this.context.newPage();
    await applyPageStealth(page);

    try {
      const url = `${BASE_URL}/annunci/${listingId}/`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

      // Extract __NEXT_DATA__
      const nextData = await page.evaluate(() => {
        const scriptEl = document.getElementById('__NEXT_DATA__');
        return scriptEl ? scriptEl.textContent : null;
      });

      if (nextData) {
        const parsed = JSON.parse(nextData);
        const propertyData = parsed?.props?.pageProps?.listing || parsed?.props?.pageProps?.realEstate;

        if (propertyData) {
          const properties = parseApiResponse({ realEstates: [{ realEstate: propertyData }] });
          return properties[0] || null;
        }
      }

      return null;
    } finally {
      await page.close();
    }
  }

  /**
   * Initialize browser for fallback scraping
   */
  private async initializeBrowser(): Promise<void> {
    logger.info('Initializing browser for fallback scraping...');

    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: config.headless,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    };

    if (config.proxyServer) {
      launchOptions.proxy = {
        server: config.proxyServer,
        username: config.proxyUsername,
        password: config.proxyPassword,
      };
    }

    this.browser = await chromium.launch(launchOptions);
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      locale: 'it-IT',
      timezoneId: 'Europe/Rome',
    });

    await applyStealthConfig(this.context);
  }

  /**
   * Process single listing ID
   */
  async processListing(id: string): Promise<boolean> {
    try {
      // Check if already processed (race condition check)
      const isProcessed = await this.queue.isProcessed(id);
      if (isProcessed) {
        logger.debug(`[${this.workerId}] Skipping ${id} - already processed`);
        return true;
      }

      // Fetch property details
      const property = await this.fetchPropertyDetail(id);

      if (!property) {
        logger.warn(`[${this.workerId}] No data found for ${id}`);
        await this.queue.markFailed(id, 'No data returned');
        this.failedCount++;
        return false;
      }

      // Check for changes
      const hasChanged = await this.queue.hasPropertyChanged(id, property);

      if (hasChanged) {
        // Send to Core Service
        const payload = createIngestionPayload(property, property);
        await sendToCoreService(payload);

        // Store snapshot in Redis
        await this.queue.storePropertySnapshot(id, property);

        // Store in Scraper DB
        const checksum = await this.calculateChecksum(property);
        const snapshotId = await this.db.storeSnapshot(id, property, checksum);

        logger.info(`[${this.workerId}] ✓ ${id} - CHANGED`);
        this.changedCount++;
      } else {
        logger.info(`[${this.workerId}] ✓ ${id} - unchanged`);
        this.unchangedCount++;
      }

      // Mark as processed
      await this.queue.markProcessed(id);
      await this.queue.updateLastSeen(id);

      // Update metadata
      await this.db.updatePropertyMetadata(id, {
        lastSeen: new Date(),
        currentStatus: 'active',
        currentPrice: property.price,
        hasChanges: hasChanged,
      });

      this.processedCount++;
      return true;
    } catch (error) {
      logger.error(`[${this.workerId}] Error processing ${id}:`, error);

      // Retry with exponential backoff
      const retryCount = await this.queue.getRetryCount(id);
      if (retryCount < 3) {
        await this.queue.requeueWithRetry(id, 3);
        logger.info(`[${this.workerId}] Re-queued ${id} (retry ${retryCount + 1}/3)`);
      } else {
        await this.queue.markFailed(id, String(error));
        this.failedCount++;
      }

      return false;
    }
  }

  /**
   * Calculate simple checksum for property
   */
  private async calculateChecksum(property: Property): Promise<string> {
    const data = JSON.stringify({
      price: property.price,
      title: property.title,
      description: property.description,
    });
    return Buffer.from(data).toString('base64').substring(0, 32);
  }

  /**
   * Start processing queue
   */
  async start(): Promise<void> {
    this.isRunning = true;
    logger.info(`[${this.workerId}] Starting worker...`);

    while (this.isRunning) {
      try {
        // Pop listing ID from queue (blocking)
        const id = await this.queue.popListingId(5);

        if (!id) {
          // No items in queue, check stats
          const stats = await this.queue.getStats();
          if (stats.remaining === 0) {
            logger.info(`[${this.workerId}] Queue empty, stopping...`);
            break;
          }
          continue;
        }

        // Process listing
        await this.processListing(id);

        // Rate limiting
        await randomDelay(config.requestDelayMs, config.requestDelayMs + 1000);

        // Log progress every 10 properties
        if (this.processedCount % 10 === 0) {
          logger.info(
            `[${this.workerId}] Progress: ${this.processedCount} processed ` +
            `(${this.changedCount} changed, ${this.unchangedCount} unchanged, ${this.failedCount} failed)`
          );
        }
      } catch (error) {
        logger.error(`[${this.workerId}] Worker error:`, error);
        await randomDelay(5000, 10000); // Back off on error
      }
    }

    logger.info(
      `[${this.workerId}] Worker stopped. ` +
      `Processed: ${this.processedCount}, Changed: ${this.changedCount}, ` +
      `Unchanged: ${this.unchangedCount}, Failed: ${this.failedCount}`
    );
  }

  /**
   * Stop worker
   */
  stop(): void {
    this.isRunning = false;
    logger.info(`[${this.workerId}] Stopping worker...`);
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    await this.queue.close();
    await this.db.close();
    logger.info(`[${this.workerId}] Worker closed`);
  }
}

// ===== Main Execution =====

async function main() {
  const worker = new ImmobiliareWorker();

  try {
    await worker.initialize();
    await worker.start();
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await worker.close();
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
