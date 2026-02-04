/**
 * Immobiliare.it Coordinator - Phase 1: Listing Discovery
 *
 * Discovers all listing IDs from search pages and pushes them to Redis queue.
 * Uses stealth Playwright to bypass DataDome protection.
 *
 * Usage:
 *   npm run coordinator
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { config, ITALIAN_CITIES } from './config';
import { createLogger } from './logger';
import { randomDelay } from './utils';
import { RedisQueue } from './redis-queue';
import { ScraperDatabase } from './database';
import { applyStealthConfig, applyPageStealth } from './stealth';

const logger = createLogger('Coordinator');

const BASE_URL = 'https://www.immobiliare.it';
const API_ENDPOINT = '/api-next/search-list/listings/';

export class ImmobiliareCoordinator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private queue: RedisQueue;
  private db: ScraperDatabase;
  private interceptedIds: Set<string> = new Set();

  constructor() {
    this.queue = new RedisQueue('immobiliare');
    this.db = new ScraperDatabase();
  }

  async initialize() {
    await this.queue.initialize();
    await this.db.initialize();
    await this.initializeBrowser();
    logger.info('Coordinator initialized');
  }

  /**
   * Initialize Playwright browser with stealth settings
   */
  private async initializeBrowser(): Promise<void> {
    logger.info('Initializing stealth Playwright browser...');

    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: config.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    };

    // Add proxy if configured
    if (config.proxyServer) {
      launchOptions.proxy = {
        server: config.proxyServer,
        username: config.proxyUsername,
        password: config.proxyPassword,
      };
      logger.info(`Using proxy: ${config.proxyServer}`);
    } else {
      logger.warn('No proxy configured - DataDome may block datacenter IPs');
    }

    this.browser = await chromium.launch(launchOptions);

    // Create context with stealth settings
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'it-IT',
      timezoneId: 'Europe/Rome',
      geolocation: { latitude: 45.4642, longitude: 9.19 }, // Milano
      permissions: ['geolocation'],
    });

    await applyStealthConfig(this.context);
    this.page = await this.context.newPage();
    await applyPageStealth(this.page);

    logger.info('Browser initialized with stealth settings');
  }

  /**
   * Setup API interception to capture listing IDs
   */
  private setupApiInterception(): void {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    this.interceptedIds.clear();

    this.page.on('response', async (response) => {
      const url = response.url();

      // Check if this is the listings API endpoint
      if (url.includes(API_ENDPOINT)) {
        try {
          const status = response.status();
          if (status === 200) {
            const responseData = await response.json();

            // Extract listing IDs from API response
            const ids = this.extractListingIds(responseData);
            ids.forEach(id => this.interceptedIds.add(id));

            logger.debug(`Captured ${ids.length} listing IDs from API`);
          }
        } catch (error) {
          logger.error(`Failed to parse API response:`, error);
        }
      }
    });
  }

  /**
   * Extract listing IDs from API response
   */
  private extractListingIds(apiResponse: any): string[] {
    const ids: string[] = [];

    // Handle different API response structures
    let listings: any[] = [];
    if (apiResponse.results) {
      listings = apiResponse.results;
    } else if (apiResponse.listings) {
      listings = apiResponse.listings;
    } else if (apiResponse.realEstates) {
      listings = apiResponse.realEstates;
    } else if (Array.isArray(apiResponse)) {
      listings = apiResponse;
    }

    for (const listing of listings) {
      const id = listing.realEstate?.id || listing.id;
      if (id) {
        ids.push(String(id));
      }
    }

    return ids;
  }

  /**
   * Build search URL for a city and transaction type
   */
  private buildSearchUrl(city: string, transactionType: 'sale' | 'rent'): string {
    const type = transactionType === 'sale' ? 'vendita' : 'affitto';
    return `${BASE_URL}/${type}/residenziale/${city.toLowerCase()}/`;
  }

  /**
   * Scrape a single page and extract listing IDs
   */
  private async scrapePage(url: string, pageNumber: number = 1): Promise<string[]> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    logger.info(`Scraping page ${pageNumber}: ${url}`);

    // Clear previous intercepted IDs
    this.interceptedIds.clear();
    this.setupApiInterception();

    try {
      // Navigate to the page
      const response = await this.page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 60000,
      });

      if (!response) {
        throw new Error('No response received');
      }

      const status = response.status();
      logger.info(`Page loaded with status: ${status}`);

      // Check for DataDome challenge
      const title = await this.page.title();
      if (title.includes('DataDome') || status === 403) {
        logger.error('DataDome protection detected!');
        throw new Error('DataDome challenge detected - need better proxy');
      }

      // Wait for API calls to complete
      await randomDelay(2000, 4000);

      // Try to extract from __NEXT_DATA__ if no API calls intercepted
      if (this.interceptedIds.size === 0) {
        logger.warn('No API calls intercepted, trying __NEXT_DATA__...');
        const nextDataIds = await this.extractFromNextData();
        nextDataIds.forEach(id => this.interceptedIds.add(id));
      }

      return Array.from(this.interceptedIds);
    } catch (error) {
      logger.error(`Error scraping page ${pageNumber}:`, error);
      throw error;
    }
  }

  /**
   * Extract listing IDs from __NEXT_DATA__ script tag
   */
  private async extractFromNextData(): Promise<string[]> {
    if (!this.page) return [];

    try {
      const nextData = await this.page.evaluate(() => {
        const scriptEl = document.getElementById('__NEXT_DATA__');
        if (scriptEl) {
          return scriptEl.textContent;
        }
        return null;
      });

      if (nextData) {
        const parsed = JSON.parse(nextData);
        const listings = parsed?.props?.pageProps?.listings;
        if (listings) {
          return this.extractListingIds(listings);
        }
      }
    } catch (error) {
      logger.error('Failed to extract from __NEXT_DATA__:', error);
    }

    return [];
  }

  /**
   * Scrape a single city
   */
  async scrapeCity(
    city: string,
    transactionType: 'sale' | 'rent',
    maxPages: number = 5
  ): Promise<number> {
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`Scraping ${city} - ${transactionType}`);
    logger.info(`${'='.repeat(60)}`);

    const allIds: string[] = [];
    const baseUrl = this.buildSearchUrl(city, transactionType);

    for (let page = 1; page <= maxPages; page++) {
      try {
        // Add page parameter for pages > 1
        const url = page === 1 ? baseUrl : `${baseUrl}?pag=${page}`;
        const ids = await this.scrapePage(url, page);

        if (ids.length === 0) {
          logger.info(`No listings found on page ${page}, stopping...`);
          break;
        }

        allIds.push(...ids);
        logger.info(`Page ${page}: Found ${ids.length} IDs (total: ${allIds.length})`);

        // Random delay between pages
        if (page < maxPages) {
          await randomDelay(config.minDelayMs, config.maxDelayMs);
        }
      } catch (error) {
        logger.error(`Failed to scrape page ${page}:`, error);
        break;
      }
    }

    // Push IDs to Redis queue
    if (allIds.length > 0) {
      const addedCount = await this.queue.pushListingIds(allIds);
      logger.info(`Pushed ${addedCount} new listing IDs to queue`);
    }

    return allIds.length;
  }

  /**
   * Scrape all Italian cities
   */
  async scrapeAllCities(maxPagesPerCity: number = 5): Promise<void> {
    const runId = await this.db.startScrapeRun('city');
    let totalDiscovered = 0;

    try {
      for (const city of ITALIAN_CITIES) {
        try {
          logger.info(`\nProcessing city: ${city}`);
          const count = await this.scrapeCity(city, config.transactionType, maxPagesPerCity);
          totalDiscovered += count;

          // Delay between cities
          await randomDelay(5000, 8000);
        } catch (error) {
          logger.error(`Failed to scrape ${city}:`, error);
          // Continue with next city
        }
      }

      // Complete run
      await this.db.completeScrapeRun(runId, {
        propertiesDiscovered: totalDiscovered,
        propertiesChanged: 0,
        propertiesUnchanged: 0,
        propertiesNew: totalDiscovered,
        propertiesInactive: 0,
        errorsCount: 0,
      });

      logger.info(`\nCoordinator complete! Discovered ${totalDiscovered} properties`);
    } catch (error) {
      logger.error('Coordinator error:', error);
      throw error;
    }
  }

  /**
   * Close browser and connections
   */
  async close(): Promise<void> {
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
    await this.queue.close();
    await this.db.close();
    logger.info('Coordinator closed');
  }
}

// ===== Main Execution =====

async function main() {
  logger.info('='.repeat(60));
  logger.info('Immobiliare.it Coordinator - Phase 1');
  logger.info('='.repeat(60));
  logger.info(`Transaction type: ${config.transactionType}`);
  logger.info(`Cities: ${ITALIAN_CITIES.length}`);
  logger.info('='.repeat(60));

  const coordinator = new ImmobiliareCoordinator();

  try {
    await coordinator.initialize();
    await coordinator.scrapeAllCities(5); // 5 pages per city
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  } finally {
    await coordinator.close();
  }

  logger.info('Done!');
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
