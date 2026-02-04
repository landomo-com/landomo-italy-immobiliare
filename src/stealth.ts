/**
 * Stealth browser utilities
 * Replaces @shared/stealth dependency
 */

import type { Page, Browser } from 'playwright';

export interface StealthConfig {
  userAgent?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezone?: string;
}

/**
 * Apply stealth configuration to a Playwright page
 */
export async function applyStealth(page: Page, config: StealthConfig = {}): Promise<void> {
  // Set user agent
  if (config.userAgent) {
    await page.setExtraHTTPHeaders({
      'User-Agent': config.userAgent
    });
  }

  // Set viewport
  if (config.viewport) {
    await page.setViewportSize(config.viewport);
  }

  // Inject scripts to avoid detection
  await page.addInitScript(() => {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });
}

/**
 * Get random user agent string
 */
export function getRandomUserAgent(): string {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * Apply stealth configuration to browser context
 */
export async function applyStealthConfig(browser: Browser, config: StealthConfig = {}): Promise<void> {
  console.log('[stealth] Apply config called (stub)');
}

/**
 * Apply stealth to page
 */
export async function applyPageStealth(page: Page): Promise<void> {
  await applyStealth(page);
}

/**
 * Perform human-like scrolling
 */
export async function humanScroll(page: Page, distance: number = 1000): Promise<void> {
  await page.evaluate((dist) => {
    window.scrollBy({ top: dist, behavior: 'smooth' });
  }, distance);
  await page.waitForTimeout(Math.random() * 1000 + 500);
}

/**
 * Perform human-like click
 */
export async function humanClick(page: Page, selector: string): Promise<void> {
  await page.waitForSelector(selector, { timeout: 5000 });
  await page.click(selector, { delay: Math.random() * 100 + 50 });
  await page.waitForTimeout(Math.random() * 500 + 200);
}

/**
 * Bypass DataDome protection
 */
export async function bypassDataDome(page: Page): Promise<boolean> {
  console.log('[stealth] DataDome bypass called (stub)');
  // Stub implementation - would need real bypass logic
  return true;
}
