/**
 * Queue Statistics and Management Tool
 *
 * Usage:
 *   npm run queue:stats        # Show stats
 *   npm run queue:clear        # Clear all data
 *   npm run queue:retry-failed # Retry failed items
 */

import { RedisQueue } from './redis-queue';
import { createLogger } from './logger';

const logger = createLogger('QueueStats');

async function showStats() {
  const queue = new RedisQueue('immobiliare');

  try {
    await queue.initialize();

    const stats = await queue.getStats();
    const progress = await queue.getProgress();
    const missingQueueDepth = await queue.getMissingQueueDepth();
    const verifiedInactiveCount = await queue.getVerifiedInactiveCount();

    logger.info('\n' + '='.repeat(60));
    logger.info('Immobiliare.it Queue Statistics');
    logger.info('='.repeat(60));
    logger.info(`Started: ${stats.startedAt || 'N/A'}`);
    logger.info(`Total discovered: ${stats.totalDiscovered.toLocaleString()}`);
    logger.info(`Processed: ${stats.processedCount.toLocaleString()}`);
    logger.info(`Queue depth: ${stats.queueDepth.toLocaleString()}`);
    logger.info(`Failed: ${stats.failedCount.toLocaleString()}`);
    logger.info(`Progress: ${progress.toFixed(2)}%`);
    logger.info(`Missing queue: ${missingQueueDepth.toLocaleString()}`);
    logger.info(`Verified inactive: ${verifiedInactiveCount.toLocaleString()}`);
    logger.info('='.repeat(60) + '\n');

    await queue.close();
  } catch (error) {
    logger.error('Error getting stats:', error);
    process.exit(1);
  }
}

async function clearQueue() {
  const queue = new RedisQueue('immobiliare');

  try {
    await queue.initialize();

    logger.warn('WARNING: This will delete all queue data!');
    logger.warn('Press Ctrl+C within 5 seconds to cancel...');

    await new Promise(resolve => setTimeout(resolve, 5000));

    await queue.clear();
    logger.info('Queue cleared successfully');

    await queue.close();
  } catch (error) {
    logger.error('Error clearing queue:', error);
    process.exit(1);
  }
}

async function retryFailed() {
  const queue = new RedisQueue('immobiliare');

  try {
    await queue.initialize();

    const count = await queue.retryFailedListings();
    logger.info(`Re-queued ${count} failed listings`);

    await queue.close();
  } catch (error) {
    logger.error('Error retrying failed listings:', error);
    process.exit(1);
  }
}

async function showFailed() {
  const queue = new RedisQueue('immobiliare');

  try {
    await queue.initialize();

    const failedIds = await queue.getFailedIds();
    logger.info(`\nFailed listings (${failedIds.length}):`);
    failedIds.slice(0, 20).forEach(id => logger.info(`  - ${id}`));

    if (failedIds.length > 20) {
      logger.info(`  ... and ${failedIds.length - 20} more`);
    }

    await queue.close();
  } catch (error) {
    logger.error('Error getting failed listings:', error);
    process.exit(1);
  }
}

// Main
const command = process.argv[2] || 'stats';

switch (command) {
  case 'stats':
    showStats();
    break;
  case 'clear':
    clearQueue();
    break;
  case 'retry-failed':
    retryFailed();
    break;
  case 'show-failed':
    showFailed();
    break;
  default:
    logger.error(`Unknown command: ${command}`);
    logger.info('Available commands: stats, clear, retry-failed, show-failed');
    process.exit(1);
}
