import { createLogger } from '@shared/logger';
/**
 * Immobiliare.it Scraper
 *
 * Approach: JSON API with DataDome bypass
 * - Intercepts API calls to `/api-next/search-list/listings/`
 * - Uses stealth Playwright to bypass DataDome protection
 * - Extracts structured JSON responses
 *
 * IMPORTANT: DataDome protection is active. For production use:
 * - Residential/mobile proxies recommended
 * - Set PROXY_SERVER, PROXY_USERNAME, PROXY_PASSWORD env vars
 */

import { Browser, BrowserContext, Page, chromium } from 'playwright';
import { applyStealthConfig, applyPageStealth } from '@shared/stealth.js';
import type { Property } from '@shared/types.js';
import { parseApiResponse } from './parser.js';

const BASE_URL = 'https://www.immobiliare.it';
const API_ENDPOINT = '/api-next/search-list/listings/';

// Italian cities for search
export const ITALIAN_CITIES = [
  'milano',
  'roma',
  'napoli',
  'torino',
  'firenze',
  'bologna',
  'genova',
  'palermo',
  'venezia',
  'verona',
  'bari',
  'catania',
  'trieste',
  'padova',
  'brescia',
];

interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

interface ScraperOptions {
  headless?: boolean;
  minDelayMs?: number;
  maxDelayMs?: number;
  proxy?: ProxyConfig;
}

interface ApiInterceptResult {
  url: string;
  response: any;
  status: number;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Random delay between min and max milliseconds
 */
function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  this.logger.info(`⏱️  Waiting ${delay}ms...`);
  return sleep(delay);
}

export class ImmobiliareScraper {
  private logger = createLogger(this.constructor.name);
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private options: ScraperOptions;
  private interceptedApiCalls: ApiInterceptResult[] = [];

  constructor(options: ScraperOptions = {}) {
    // Check for proxy from environment variables
    const envProxy = process.env.PROXY_SERVER
      ? {
          server: process.env.PROXY_SERVER,
          username: process.env.PROXY_USERNAME,
          password: process.env.PROXY_PASSWORD,
        }
      : undefined;

    this.options = {
      headless: options.headless ?? true,
      minDelayMs: options.minDelayMs ?? 3000,
      maxDelayMs: options.maxDelayMs ?? 5000,
      proxy: options.proxy ?? envProxy,
    };

    if (this.options.proxy) {
      this.logger.info(`🔒 Using proxy: ${this.options.proxy.server}`);
    } else {
      this.logger.warn('⚠️  No proxy configured - DataDome may block datacenter IPs');
      this.logger.warn('   Set PROXY_SERVER, PROXY_USERNAME, PROXY_PASSWORD env vars');
    }
  }

  /**
   * Initialize the browser with stealth settings
   */
  async initialize(): Promise<void> {
    this.logger.info('🚀 Initializing stealth Playwright browser...');

    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: this.options.headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=site-per-process',
        '--flag-switches-begin',
        '--disable-site-isolation-trials',
        '--flag-switches-end',
      ],
    };

    // Add proxy if configured
    if (this.options.proxy) {
      launchOptions.proxy = {
        server: this.options.proxy.server,
        username: this.options.proxy.username,
        password: this.options.proxy.password,
      };
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

    // Apply stealth configuration to context
    await applyStealthConfig(this.context);

    this.page = await this.context.newPage();

    // Apply page-level stealth techniques
    await applyPageStealth(this.page);

    this.logger.info('✅ Browser initialized with stealth settings');
  }

  /**
   * Intercept API calls and extract JSON responses
   */
  private setupApiInterception(): void {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    this.interceptedApiCalls = [];

    this.page.on('response', async (response) => {
      const url = response.url();

      // Check if this is the listings API endpoint
      if (url.includes(API_ENDPOINT)) {
        try {
          const status = response.status();
          this.logger.info(`📡 Intercepted API call: ${url} (status: ${status})`);

          if (status === 200) {
            const responseData = await response.json();
            this.interceptedApiCalls.push({
              url,
              response: responseData,
              status,
            });
            this.logger.info(`✅ Captured API response`);
          } else {
            this.logger.warn(`⚠️  API call failed with status ${status}`);
          }
        } catch (error) {
          this.logger.error(`❌ Failed to parse API response:`, error);
        }
      }
    });
  }

  /**
   * Build search URL for a city and transaction type
   */
  private buildSearchUrl(city: string, transactionType: 'sale' | 'rent'): string {
    const type = transactionType === 'sale' ? 'vendita' : 'affitto';
    return `${BASE_URL}/${type}/residenziale/${city.toLowerCase()}/`;
  }

  /**
   * Scrape a single page and return intercepted API data
   */
  private async scrapePage(
    url: string,
    pageNumber: number = 1
  ): Promise<Property[]> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    this.logger.info(`\n📄 Scraping page ${pageNumber}: ${url}`);

    // Clear previous intercepted calls
    this.interceptedApiCalls = [];

    // Setup API interception
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
      this.logger.info(`📊 Page loaded with status: ${status}`);

      // Check for DataDome challenge
      const title = await this.page.title();
      if (title.includes('DataDome') || status === 403) {
        this.logger.error('❌ DataDome protection detected!');
        throw new Error('DataDome challenge detected - proxy or better stealth required');
      }

      // Wait for API calls to complete
      this.logger.info('⏳ Waiting for API calls to complete...');
      await sleep(3000);

      // Wait for listings to appear
      try {
        await this.page.waitForSelector('[data-cy="listing-item"]', {
          timeout: 10000,
        });
        this.logger.info('✅ Listings found on page');
      } catch (error) {
        this.logger.warn('⚠️  No listings selector found, checking API data...');
      }

      // Parse intercepted API responses
      const properties: Property[] = [];

      if (this.interceptedApiCalls.length === 0) {
        this.logger.warn('⚠️  No API calls intercepted, trying to extract from page...');
        // Fallback: try to extract from __NEXT_DATA__ or window object
        const nextData = await this.page.evaluate(() => {
          const scriptEl = document.getElementById('__NEXT_DATA__');
          if (scriptEl) {
            return scriptEl.textContent;
          }
          return null;
        });

        if (nextData) {
          this.logger.info('📦 Found __NEXT_DATA__, parsing...');
          const parsed = JSON.parse(nextData);
          const apiData = parsed?.props?.pageProps?.listings;
          if (apiData) {
            const parsedProps = parseApiResponse(apiData);
            properties.push(...parsedProps);
            this.logger.info(`✅ Parsed ${parsedProps.length} properties from __NEXT_DATA__`);
          }
        }
      } else {
        // Parse all intercepted API calls
        for (const apiCall of this.interceptedApiCalls) {
          try {
            const parsedProps = parseApiResponse(apiCall.response);
            properties.push(...parsedProps);
            this.logger.info(`✅ Parsed ${parsedProps.length} properties from API response`);
          } catch (error) {
            this.logger.error('❌ Failed to parse API response:', error);
          }
        }
      }

      return properties;
    } catch (error) {
      this.logger.error(`❌ Error scraping page ${pageNumber}:`, error);
      throw error;
    }
  }

  /**
   * Scrape a city for properties
   */
  async scrapeCity(
    city: string,
    transactionType: 'sale' | 'rent' = 'sale',
    maxPages: number = 3,
    limit?: number
  ): Promise<Property[]> {
    this.logger.info(`\n${'='.repeat(60)}`);
    this.logger.info(`🏙️  Scraping ${city} - ${transactionType}`);
    this.logger.info(`${'='.repeat(60)}`);

    const allProperties: Property[] = [];
    const baseUrl = this.buildSearchUrl(city, transactionType);

    for (let page = 1; page <= maxPages; page++) {
      if (limit && allProperties.length >= limit) {
        this.logger.info(`✅ Reached limit of ${limit} properties`);
        break;
      }

      // Add page parameter for pages > 1
      const url = page === 1 ? baseUrl : `${baseUrl}?pag=${page}`;

      try {
        const properties = await this.scrapePage(url, page);

        if (properties.length === 0) {
          this.logger.info(`⚠️  No properties found on page ${page}, stopping...`);
          break;
        }

        allProperties.push(...properties);
        this.logger.info(`📊 Page ${page}: Found ${properties.length} properties (total: ${allProperties.length})`);

        // Random delay between pages to avoid detection
        if (page < maxPages && (!limit || allProperties.length < limit)) {
          await randomDelay(this.options.minDelayMs!, this.options.maxDelayMs!);
        }
      } catch (error) {
        this.logger.error(`❌ Failed to scrape page ${page}:`, error);
        break;
      }
    }

    // Apply limit if specified
    const finalProperties = limit
      ? allProperties.slice(0, limit)
      : allProperties;

    this.logger.info(`\n✅ Scraping complete: ${finalProperties.length} properties from ${city}`);
    return finalProperties;
  }

  /**
   * Scrape multiple cities
   */
  async scrapeCities(
    cities: string[],
    transactionType: 'sale' | 'rent' = 'sale',
    options: { maxPagesPerCity?: number; limit?: number } = {}
  ): Promise<Property[]> {
    const { maxPagesPerCity = 3, limit } = options;
    const allProperties: Property[] = [];

    for (const city of cities) {
      if (limit && allProperties.length >= limit) {
        this.logger.info(`✅ Reached overall limit of ${limit} properties`);
        break;
      }

      try {
        const cityLimit = limit ? limit - allProperties.length : undefined;
        const properties = await this.scrapeCity(
          city,
          transactionType,
          maxPagesPerCity,
          cityLimit
        );
        allProperties.push(...properties);

        // Delay between cities
        if (cities.indexOf(city) < cities.length - 1) {
          await randomDelay(5000, 8000);
        }
      } catch (error) {
        this.logger.error(`❌ Failed to scrape ${city}:`, error);
        // Continue with next city
      }
    }

    return allProperties;
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.page) {
      await this.page.close();
    }
    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
    this.logger.info('🔒 Browser closed');
  }
}
