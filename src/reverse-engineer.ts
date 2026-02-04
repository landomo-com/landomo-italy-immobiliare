import { chromium, Request, Response, Page, BrowserContext } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { createLogger } from './logger';

const logger = createLogger('module');

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
  timestamp: string;
  response?: {
    status: number;
    headers: Record<string, string>;
    body?: string;
  };
}

const capturedRequests: CapturedRequest[] = [];
const RUN_DURATION_MS = 90000; // 90 seconds

async function scrollPage(page: Page) {
  // Scroll down in increments to trigger lazy loading
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(800 + Math.random() * 400);
  }
}

async function handleCookieConsent(page: Page) {
  try {
    // Try to accept cookies if dialog appears
    const acceptButton = page.locator('#didomi-notice-agree-button, button:has-text("Accetta tutti"), button:has-text("Accetta"), button:has-text("Accept")');
    if (await acceptButton.isVisible({ timeout: 3000 })) {
      await acceptButton.first().click();
      logger.info('Cookie consent accepted');
      await page.waitForTimeout(1000);
    }
  } catch {
    // Cookie dialog not present or already handled
  }
}

async function randomDelay(min: number = 1000, max: number = 3000) {
  return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
}

async function setupStealthContext(): Promise<BrowserContext> {
  const browser = await chromium.launch({
    headless: true, // Headless mode
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--ignore-certificate-errors',
      '--lang=it-IT',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    geolocation: { latitude: 45.4642, longitude: 9.1900 }, // Milan
    permissions: ['geolocation'],
    extraHTTPHeaders: {
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  // Add stealth scripts to every page
  await context.addInitScript(() => {
    // Override the navigator properties to mask automation
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });

    // Override the chrome property
    (window as any).chrome = { runtime: {} };

    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });

  return context;
}

async function main() {
  const startTime = Date.now();

  logger.info('\n=== Starting Immobiliare.it reverse engineering (automated + stealth) ===\n');
  logger.info(`Running for ${RUN_DURATION_MS / 1000} seconds...\n`);

  const context = await setupStealthContext();
  const page = await context.newPage();

  // Intercept requests
  page.on("request", (request: Request) => {
    const resourceType = request.resourceType();

    // Filter for API calls (xhr, fetch) and document requests
    if (["xhr", "fetch", "document"].includes(resourceType)) {
      const url = request.url();
      // Skip captcha-related URLs from logging
      if (url.includes('captcha') || url.includes('datadome')) {
        return;
      }

      const captured: CapturedRequest = {
        url,
        method: request.method(),
        headers: request.headers(),
        postData: request.postData() ?? undefined,
        resourceType,
        timestamp: new Date().toISOString(),
      };

      capturedRequests.push(captured);
      logger.info(`[${resourceType.toUpperCase()}] ${request.method()} ${url.slice(0, 100)}${url.length > 100 ? '...' : ''}`);
    }
  });

  // Capture responses
  page.on("response", async (response: Response) => {
    const request = response.request();
    const resourceType = request.resourceType();
    const url = request.url();

    // Skip captcha-related URLs
    if (url.includes('captcha') || url.includes('datadome')) {
      return;
    }

    if (["xhr", "fetch"].includes(resourceType)) {
      const captured = capturedRequests.find(
        (r) => r.url === url && r.method === request.method() && !r.response
      );

      if (captured) {
        try {
          const body = await response.text();
          captured.response = {
            status: response.status(),
            headers: response.headers(),
            body: body.length < 100000 ? body : "[TRUNCATED - too large]",
          };

          // Pretty print JSON responses
          if (response.headers()["content-type"]?.includes("application/json")) {
            try {
              const json = JSON.parse(body);
              logger.info(`\n--- JSON Response for ${url.slice(0, 80)} ---`);
              logger.info('Data dump', json).slice(0, 2000));
              logger.info('---\n');
            } catch {
              // Not valid JSON
            }
          }
        } catch {
          // Response body not available
        }
      }
    }
  });

  try {
    // Step 1: Go to homepage with random delay
    logger.info('Step 1: Navigating to homepage...');
    await page.goto("https://www.immobiliare.it/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await handleCookieConsent(page);
    await randomDelay(2000, 4000);

    // Check if we got blocked
    const pageContent = await page.content();
    if (pageContent.includes('captcha') || pageContent.includes('challenge')) {
      logger.info('CAPTCHA detected on homepage. Site has anti-bot protection.');
    }

    // Step 2: Navigate directly to a search results page
    logger.info('Step 2: Navigating to search results page (vendita case in Milano)...');
    await page.goto("https://www.immobiliare.it/vendita-case/milano/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await handleCookieConsent(page);
    await randomDelay(2000, 4000);

    // Step 3: Scroll through results
    logger.info('Step 3: Scrolling through results...');
    await scrollPage(page);
    await randomDelay(1500, 3000);

    // Step 4: Click on first listing
    logger.info('Step 4: Clicking on a listing to view details...');
    try {
      const listingLink = page.locator('a[href*="/annunci/"]').first();
      if (await listingLink.isVisible({ timeout: 5000 })) {
        await listingLink.click();
        await page.waitForLoadState("domcontentloaded");
        await randomDelay(2000, 4000);
        await scrollPage(page);
      }
    } catch (e) {
      logger.info('Could not click on listing');
    }

    // Step 5: Go back
    logger.info('Step 5: Going back to search results...');
    await page.goBack({ waitUntil: "domcontentloaded" });
    await randomDelay(1500, 3000);

    // Step 6: Try pagination
    logger.info('Step 6: Navigating to page 2...');
    await page.goto("https://www.immobiliare.it/vendita-case/milano/?pag=2", { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(2000, 3500);
    await scrollPage(page);

    // Step 7: Try filtered search
    logger.info('Step 7: Navigating to filtered search (bilocale)...');
    await page.goto("https://www.immobiliare.it/vendita-case/milano/?localiMinimo=2&localiMassimo=2", { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(2000, 3500);
    await scrollPage(page);

    // Step 8: Try price filtered search
    logger.info('Step 8: Navigating to price filtered search...');
    await page.goto("https://www.immobiliare.it/vendita-case/milano/?prezzoMinimo=100000&prezzoMassimo=300000", { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(2000, 3500);
    await scrollPage(page);

    // Step 9: Try another property detail
    logger.info('Step 9: Viewing another property detail...');
    try {
      const listingLink = page.locator('a[href*="/annunci/"]').first();
      if (await listingLink.isVisible({ timeout: 5000 })) {
        await listingLink.click();
        await page.waitForLoadState("domcontentloaded");
        await randomDelay(2000, 4000);
        await scrollPage(page);
      }
    } catch {
      logger.info('Could not click on second listing');
    }

    // Step 10: Try rental listings
    logger.info('Step 10: Navigating to rental listings...');
    await page.goto("https://www.immobiliare.it/affitto-case/milano/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await randomDelay(2000, 3500);
    await scrollPage(page);

    // Step 11: Try API endpoints directly
    logger.info('Step 11: Trying to access API endpoints directly...');

    // Try some common API patterns for immobiliare.it
    const apiEndpoints = [
      'https://www.immobiliare.it/api/v2/search',
      'https://www.immobiliare.it/api-next/fe/search',
      'https://www.immobiliare.it/api-next/search-list/real-estates/',
    ];

    for (const endpoint of apiEndpoints) {
      try {
        logger.info(`Trying: ${endpoint}`);
        const response = await page.evaluate(async (url) => {
          const res = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            }
          });
          return {
            status: res.status,
            body: await res.text().catch(() => null)
          };
        }, endpoint);
        logger.info(`Response status: ${response.status}`);
        if (response.body) {
          logger.info(`Body preview: ${response.body.slice(0, 500)}`);
        }
      } catch (e) {
        logger.info(`Error accessing ${endpoint}`);
      }
    }

  } catch (e) {
    logger.error('Navigation error:', e);
  }

  // Wait remaining time if any
  const elapsed = Date.now() - startTime;
  const remaining = RUN_DURATION_MS - elapsed;
  if (remaining > 0) {
    logger.info(`Waiting ${(remaining / 1000).toFixed(1)}s remaining time...`);
    await page.waitForTimeout(remaining);
  }

  await context.browser()?.close();
  saveCapture();
}

function saveCapture() {
  const cwd = process.cwd();
  mkdirSync(`${cwd}/data`, { recursive: true });
  const filename = `${cwd}/data/captured-requests-${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify(capturedRequests, null, 2));
  logger.info(`\nSaved ${capturedRequests.length} requests to ${filename}`);
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  logger.info('\n\nInterrupted - saving captured requests...');
  saveCapture();
  process.exit(0);
});

main().catch(err => logger.error('Error', err));
