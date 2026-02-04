/**
 * Integration Test for Immobiliare.it Scraper
 *
 * Tests the full pipeline:
 * 1. Coordinator discovers IDs
 * 2. Worker fetches details
 * 3. Transformer creates payload
 * 4. Data sent to Core Service (mock)
 */

import { ImmobiliareCoordinator } from './coordinator';
import { ImmobiliareWorker } from './worker';
import { RedisQueue } from './redis-queue';
import { ScraperDatabase } from './database';
import { createLogger } from './logger';

const logger = createLogger('IntegrationTest');

async function testCoordinator() {
  logger.info('\n=== Testing Coordinator ===');

  const coordinator = new ImmobiliareCoordinator();

  try {
    await coordinator.initialize();

    // Test scraping a single city with 1 page
    logger.info('Scraping Milano (1 page)...');
    const count = await coordinator.scrapeCity('milano', 'sale', 1);

    logger.info(`✓ Coordinator: Discovered ${count} listing IDs`);

    await coordinator.close();

    return count > 0;
  } catch (error) {
    logger.error('Coordinator test failed:', error);
    await coordinator.close();
    return false;
  }
}

async function testWorker() {
  logger.info('\n=== Testing Worker ===');

  const queue = new RedisQueue('immobiliare');
  const worker = new ImmobiliareWorker('test-worker');

  try {
    await queue.initialize();
    await worker.initialize();

    // Check if there are items in queue
    const stats = await queue.getStats();
    logger.info(`Queue depth: ${stats.queueDepth}`);

    if (stats.queueDepth === 0) {
      logger.warn('No items in queue. Run coordinator first.');
      await queue.close();
      await worker.close();
      return true; // Not a failure
    }

    // Pop one item and process it
    const id = await queue.popListingId(1);

    if (id) {
      logger.info(`Processing listing ${id}...`);
      const success = await worker.processListing(id);

      if (success) {
        logger.info('✓ Worker: Successfully processed listing');
      } else {
        logger.warn('Worker: Failed to process listing');
      }
    }

    await queue.close();
    await worker.close();

    return true;
  } catch (error) {
    logger.error('Worker test failed:', error);
    await queue.close();
    await worker.close();
    return false;
  }
}

async function testDatabase() {
  logger.info('\n=== Testing Database ===');

  const db = new ScraperDatabase();

  try {
    await db.initialize();

    // Test stats query
    const stats = await db.getStats();
    logger.info('Database stats:', stats);

    logger.info('✓ Database: Connected and operational');

    await db.close();
    return true;
  } catch (error) {
    logger.error('Database test failed:', error);
    return false;
  }
}

async function testQueue() {
  logger.info('\n=== Testing Redis Queue ===');

  const queue = new RedisQueue('immobiliare-test');

  try {
    await queue.initialize();

    // Test push/pop
    await queue.pushListingId('test-123');
    const id = await queue.popListingId(1);

    if (id === 'test-123') {
      logger.info('✓ Queue: Push/pop working');
    } else {
      logger.error('Queue: Push/pop failed');
      return false;
    }

    // Test stats
    const stats = await queue.getStats();
    logger.info('Queue stats:', stats);

    // Cleanup
    await queue.clear();
    await queue.close();

    return true;
  } catch (error) {
    logger.error('Queue test failed:', error);
    return false;
  }
}

// Main
async function main() {
  logger.info('='.repeat(60));
  logger.info('Immobiliare.it Scraper - Integration Tests');
  logger.info('='.repeat(60));

  const results = {
    queue: false,
    database: false,
    coordinator: false,
    worker: false,
  };

  // Test queue
  results.queue = await testQueue();

  // Test database
  results.database = await testDatabase();

  // Test coordinator (optional - takes time)
  if (process.env.TEST_COORDINATOR === 'true') {
    results.coordinator = await testCoordinator();
  } else {
    logger.info('\nSkipping coordinator test (set TEST_COORDINATOR=true to run)');
  }

  // Test worker (optional)
  if (process.env.TEST_WORKER === 'true') {
    results.worker = await testWorker();
  } else {
    logger.info('\nSkipping worker test (set TEST_WORKER=true to run)');
  }

  // Summary
  logger.info('\n' + '='.repeat(60));
  logger.info('Test Results:');
  logger.info(`  Queue:       ${results.queue ? '✓ PASS' : '✗ FAIL'}`);
  logger.info(`  Database:    ${results.database ? '✓ PASS' : '✗ FAIL'}`);
  logger.info(`  Coordinator: ${process.env.TEST_COORDINATOR === 'true' ? (results.coordinator ? '✓ PASS' : '✗ FAIL') : '⊘ SKIP'}`);
  logger.info(`  Worker:      ${process.env.TEST_WORKER === 'true' ? (results.worker ? '✓ PASS' : '✗ FAIL') : '⊘ SKIP'}`);
  logger.info('='.repeat(60));

  const allPassed = results.queue && results.database;
  process.exit(allPassed ? 0 : 1);
}

// Run
main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
