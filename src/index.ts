import { createLogger } from '@shared/logger';
/**
 * Immobiliare.it Scraper - CLI Entry Point
 *
 * Usage:
 *   tsx src/index.ts [options]
 *
 * Options:
 *   --location <city>              City to scrape (default: milano)
 *   --transactionType <sale|rent>  Transaction type (default: sale)
 *   --limit <number>               Maximum properties to scrape
 *   --maxPages <number>            Max pages per city (default: 3)
 *   --headless <true|false>        Run browser in headless mode (default: true)
 *   --help                         Show this help message
 *
 * Examples:
 *   tsx src/index.ts --location milano --limit 5
 *   tsx src/index.ts --location roma --transactionType rent --limit 10
 */

import { program } from 'commander';
import { ImmobiliareScraper, ITALIAN_CITIES } from './scraper.js';
import { connectRedis, saveProperties, disconnectRedis } from '@shared/redis.js';
import type { Property } from '@shared/types.js';

const logger = createLogger('module');

// CLI Configuration
program
  .name('immobiliare-scraper')
  .description('Scraper for Immobiliare.it - bypasses DataDome using stealth Playwright')
  .version('2.0.0')
  .option(
    '--location <city>',
    'City to scrape (e.g., milano, roma, napoli)',
    'milano'
  )
  .option(
    '--transactionType <type>',
    'Transaction type: sale or rent',
    'sale'
  )
  .option(
    '--limit <number>',
    'Maximum number of properties to scrape',
    (value) => parseInt(value, 10)
  )
  .option(
    '--maxPages <number>',
    'Maximum pages to scrape per city',
    (value) => parseInt(value, 10),
    3
  )
  .option(
    '--headless <boolean>',
    'Run browser in headless mode',
    (value) => value !== 'false',
    true
  )
  .option('--no-headless', 'Run browser with visible window')
  .parse();

const options = program.opts();

// Validate transaction type
if (options.transactionType !== 'sale' && options.transactionType !== 'rent') {
  logger.error("❌ Error: --transactionType must be "sale" or "rent"");
  process.exit(1);
}

// Validate location
const location = options.location.toLowerCase();
if (!ITALIAN_CITIES.includes(location)) {
  logger.warn(`⚠️  Warning: "${location}" is not in the predefined city list, but will attempt to scrape anyway.`);
  logger.info(`Available cities: ${ITALIAN_CITIES.join(', ')}`);
}

/**
 * Format property for console output
 */
function formatProperty(prop: Property): void {
  logger.info("-" + "=".repeat(80));
  logger.info(`🏠 ID: ${prop.id}`);
  logger.info(`📝 Title: ${prop.title}`);
  logger.info(
    `💰 Price: ${prop.price ? `EUR ${prop.price.toLocaleString()}` : 'N/A'}`
  );
  logger.info(`📍 Location: ${prop.location.city || '?'}, ${prop.location.region || '?'}`);
  logger.info(`📐 Features: ${prop.details.sqm || '?'} sqm, ${
      prop.details.rooms || '?'
    } rooms, ${prop.details.bathrooms || '?'} bathrooms`);
  logger.info(`🔗 URL: ${prop.url}`);
}

/**
 * Main execution function
 */
async function main() {
  logger.info("=" + "=".repeat(80));
  logger.info('🇮🇹  Immobiliare.it Scraper v2.0');
  logger.info("=" + "=".repeat(80));
  logger.info(`📍 Location: ${location}`);
  logger.info(`💼 Transaction type: ${options.transactionType}`);
  logger.info(`📄 Max pages: ${options.maxPages}`);
  logger.info(`🎯 Limit: ${options.limit || 'none'}`);
  logger.info(`👁️  Headless: ${options.headless}`);
  logger.info("=" + "=".repeat(80));
  logger.info("");

  // Initialize scraper
  const scraper = new ImmobiliareScraper({
    headless: options.headless,
    minDelayMs: 3000,
    maxDelayMs: 5000,
  });

  let properties: Property[] = [];

  try {
    // Initialize browser
    await scraper.initialize();

    // Scrape the specified city
    properties = await scraper.scrapeCity(
      location,
      options.transactionType,
      options.maxPages,
      options.limit
    );

    logger.info("");
    logger.info("=" + "=".repeat(80));
    logger.info(`✅ Scraping complete!`);
    logger.info(`📊 Total properties found: ${properties.length}`);
    logger.info("=" + "=".repeat(80));

    if (properties.length === 0) {
      logger.info("");
      logger.info('⚠️  No properties were scraped. This might be due to:');
      logger.info('   - DataDome bot protection blocking requests');
      logger.info('   - Invalid city name');
      logger.info('   - Network issues');
      logger.info('   - Try using a residential/mobile proxy');
      logger.info("");
      process.exit(1);
    }

    // Print sample of results
    logger.info("");
    logger.info('📋 Sample properties:');
    const sample = properties.slice(0, Math.min(3, properties.length));
    for (const prop of sample) {
      formatProperty(prop);
    }
    logger.info("-" + "=".repeat(80));

    // Store in Redis
    logger.info("");
    logger.info('💾 Storing properties in Redis...');

    try {
      await connectRedis();
      await saveProperties(properties);
      const count = properties.length;
      logger.info(`✅ Successfully stored ${count} properties in Redis`);

      // Print summary
      logger.info("");
      logger.info('📊 Summary:');
      logger.info(`   - Source: immobiliare.it`);
      logger.info(`   - Location: ${location}`);
      logger.info(`   - Transaction type: ${options.transactionType}`);
      logger.info(`   - Properties stored: ${count}`);
      logger.info("");
    } catch (error) {
      logger.error('❌ Failed to store properties in Redis:', error);
      logger.info("");
      logger.info('📄 Properties will be output to console instead:');
      logger.info('Data dump', properties));
    } finally {
      await disconnectRedis();
    }
  } catch (error) {
    logger.error('❌ Scraper error:', error);

    if (error instanceof Error) {
      logger.error('Error details:', error.message);
      if (error.stack) {
        logger.error('Stack trace:', error.stack);
      }
    }

    process.exit(1);
  } finally {
    await scraper.close();
  }

  logger.info('✨ Done!');
  process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info("");
  logger.info('⚠️  Received SIGINT, shutting down gracefully...');
  await disconnectRedis();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info("");
  logger.info('⚠️  Received SIGTERM, shutting down gracefully...');
  await disconnectRedis();
  process.exit(0);
});

// Execute main function
main().catch((error) => {
  logger.error('❌ Fatal error:', error);
  process.exit(1);
});
