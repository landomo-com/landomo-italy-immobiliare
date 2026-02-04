/**
 * Redis Queue Client for Distributed Scraping - Immobiliare.it
 *
 * Provides queue-based architecture for scraping:
 * - Phase 1: Coordinator discovers listing IDs and pushes to queue
 * - Phase 2: Workers consume from queue and fetch details
 *
 * Features:
 * - Persistence (survives crashes)
 * - Resumability (stop and resume)
 * - Distributed processing (multiple workers)
 * - Deduplication (Redis Sets)
 * - Change detection with checksums
 * - Missing property tracking
 */

import Redis from 'ioredis';
import { createLogger } from './logger';
import { config } from './config';
import * as crypto from 'crypto';

const logger = createLogger('RedisQueue');

export interface QueueStats {
  queueDepth: number;
  totalDiscovered: number;
  processedCount: number;
  failedCount: number;
  remaining: number;
  startedAt?: string;
}

export class RedisQueue {
  private redis: Redis;
  private namespace: string;
  private queueKey: string;
  private allIdsKey: string;
  private processedIdsKey: string;
  private failedIdsKey: string;
  private retriesKey: string;
  private statsKey: string;

  constructor(
    portal: string = 'immobiliare',
    redisUrl?: string
  ) {
    // Connect to Redis
    this.redis = new Redis(redisUrl || config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error('Redis connection failed after 3 retries');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });

    // Set up key namespaces
    this.namespace = `landomo:${portal}`;
    this.queueKey = `${this.namespace}:queue`;
    this.allIdsKey = `${this.namespace}:all_ids`;
    this.processedIdsKey = `${this.namespace}:processed`;
    this.failedIdsKey = `${this.namespace}:failed`;
    this.retriesKey = `${this.namespace}:retries`;
    this.statsKey = `${this.namespace}:stats`;

    // Event handlers
    this.redis.on('connect', () => {
      logger.info('Redis connected');
    });

    this.redis.on('error', (err) => {
      logger.error('Redis error:', err);
    });
  }

  /**
   * Initialize queue (set start time)
   */
  async initialize(): Promise<void> {
    const startedAt = await this.redis.hget(this.statsKey, 'started_at');
    if (!startedAt) {
      await this.redis.hset(this.statsKey, 'started_at', new Date().toISOString());
    }
  }

  /**
   * Push listing ID to queue (if not already queued/processed)
   */
  async pushListingId(id: string): Promise<boolean> {
    // Check if already in all_ids set
    const exists = await this.redis.sismember(this.allIdsKey, id);
    if (exists) {
      return false; // Already queued
    }

    // Add to queue and all_ids set atomically
    const pipeline = this.redis.pipeline();
    pipeline.lpush(this.queueKey, id);
    pipeline.sadd(this.allIdsKey, id);
    await pipeline.exec();

    return true;
  }

  /**
   * Push multiple listing IDs to queue
   * Also updates last_seen timestamp for all IDs (for change detection)
   */
  async pushListingIds(ids: string[]): Promise<number> {
    let addedCount = 0;
    const timestamp = Date.now();

    // Process in batches of 1000 for efficiency
    const batchSize = 1000;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const pipeline = this.redis.pipeline();

      for (const id of batch) {
        pipeline.sadd(this.allIdsKey, id);
        // Update last_seen timestamp for all discovered IDs (new and existing)
        pipeline.set(`${this.namespace}:last_seen:${id}`, timestamp);
      }

      const results = await pipeline.exec();

      // Count how many were new (sadd returns 1 for new, 0 for existing)
      // Every other result is last_seen set (which we don't count)
      const newIds = batch.filter((id, idx) => results![idx * 2][1] === 1);

      if (newIds.length > 0) {
        await this.redis.lpush(this.queueKey, ...newIds);
        addedCount += newIds.length;
      }
    }

    return addedCount;
  }

  /**
   * Pop next listing ID from queue (blocking)
   */
  async popListingId(timeoutSeconds: number = 5): Promise<string | null> {
    const result = await this.redis.brpop(this.queueKey, timeoutSeconds);
    if (!result) {
      return null;
    }
    return result[1]; // brpop returns [key, value]
  }

  /**
   * Check if listing ID is already processed
   */
  async isProcessed(id: string): Promise<boolean> {
    return (await this.redis.sismember(this.processedIdsKey, id)) === 1;
  }

  /**
   * Mark listing ID as processed
   */
  async markProcessed(id: string): Promise<void> {
    await this.redis.sadd(this.processedIdsKey, id);
  }

  /**
   * Mark listing ID as failed
   */
  async markFailed(id: string, error?: string): Promise<void> {
    await this.redis.sadd(this.failedIdsKey, id);
    if (error) {
      await this.redis.hset(`${this.failedIdsKey}:errors`, id, error);
    }
  }

  /**
   * Increment retry count for listing ID
   */
  async incrementRetry(id: string): Promise<number> {
    return await this.redis.hincrby(this.retriesKey, id, 1);
  }

  /**
   * Get retry count for listing ID
   */
  async getRetryCount(id: string): Promise<number> {
    const count = await this.redis.hget(this.retriesKey, id);
    return count ? parseInt(count) : 0;
  }

  /**
   * Re-queue failed listing with retry check
   */
  async requeueWithRetry(id: string, maxRetries: number = 3): Promise<boolean> {
    const retries = await this.incrementRetry(id);

    if (retries <= maxRetries) {
      await this.redis.lpush(this.queueKey, id);
      return true;
    } else {
      await this.markFailed(id, `Max retries (${maxRetries}) exceeded`);
      return false;
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const pipeline = this.redis.pipeline();
    pipeline.llen(this.queueKey);           // Queue depth
    pipeline.scard(this.allIdsKey);         // Total discovered
    pipeline.scard(this.processedIdsKey);   // Processed count
    pipeline.scard(this.failedIdsKey);      // Failed count
    pipeline.hget(this.statsKey, 'started_at');

    const results = await pipeline.exec();

    const queueDepth = (results![0][1] as number) || 0;
    const totalDiscovered = (results![1][1] as number) || 0;
    const processedCount = (results![2][1] as number) || 0;
    const failedCount = (results![3][1] as number) || 0;
    const startedAt = results![4][1] as string | null;

    return {
      queueDepth,
      totalDiscovered,
      processedCount,
      failedCount,
      remaining: queueDepth,
      startedAt: startedAt || undefined,
    };
  }

  /**
   * Get processing progress percentage
   */
  async getProgress(): Promise<number> {
    const stats = await this.getStats();
    if (stats.totalDiscovered === 0) return 0;
    return (stats.processedCount / stats.totalDiscovered) * 100;
  }

  /**
   * Clear all queue data (use with caution!)
   */
  async clear(): Promise<void> {
    await this.redis.del(
      this.queueKey,
      this.allIdsKey,
      this.processedIdsKey,
      this.failedIdsKey,
      this.retriesKey,
      this.statsKey
    );
    logger.warn('Queue data cleared');
  }

  /**
   * Get failed listing IDs
   */
  async getFailedIds(): Promise<string[]> {
    return await this.redis.smembers(this.failedIdsKey);
  }

  /**
   * Retry all failed listings
   */
  async retryFailedListings(): Promise<number> {
    const failedIds = await this.getFailedIds();

    if (failedIds.length === 0) {
      return 0;
    }

    // Remove from failed set and add back to queue
    const pipeline = this.redis.pipeline();
    for (const id of failedIds) {
      pipeline.srem(this.failedIdsKey, id);
      pipeline.lpush(this.queueKey, id);
      pipeline.hdel(this.retriesKey, id); // Reset retry count
    }
    await pipeline.exec();

    logger.info(`Re-queued ${failedIds.length} failed listings`);
    return failedIds.length;
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
    logger.info('Redis connection closed');
  }

  /**
   * Check if Redis is connected
   */
  isConnected(): boolean {
    return this.redis.status === 'ready';
  }

  // ===== CHANGE DETECTION & MISSING PROPERTY TRACKING =====

  /**
   * Update last seen timestamp for a property
   */
  async updateLastSeen(id: string): Promise<void> {
    const timestamp = Date.now();
    await this.redis.set(`${this.namespace}:last_seen:${id}`, timestamp);
  }

  /**
   * Get last seen timestamp for a property
   */
  async getLastSeen(id: string): Promise<number | null> {
    const timestamp = await this.redis.get(`${this.namespace}:last_seen:${id}`);
    return timestamp ? parseInt(timestamp, 10) : null;
  }

  /**
   * Find properties not seen in the last N hours
   * Returns array of property IDs that may be inactive/removed
   */
  async findMissingProperties(hoursThreshold: number = 12): Promise<string[]> {
    const allIds = await this.redis.smembers(this.allIdsKey);
    const missingIds: string[] = [];
    const cutoffTime = Date.now() - (hoursThreshold * 60 * 60 * 1000);

    // Check each property's last_seen timestamp
    for (const id of allIds) {
      const lastSeen = await this.getLastSeen(id);

      if (!lastSeen || lastSeen < cutoffTime) {
        // Property not seen recently
        missingIds.push(id);
      }
    }

    return missingIds;
  }

  /**
   * Push property IDs to missing verification queue
   */
  async pushToMissingQueue(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const missingQueueKey = `${this.namespace}:missing_queue`;
    const verifiedInactiveKey = `${this.namespace}:verified_inactive`;

    let newCount = 0;

    for (const id of ids) {
      // Skip if already verified as inactive
      const isVerifiedInactive = await this.redis.sismember(verifiedInactiveKey, id);
      if (isVerifiedInactive) continue;

      // Add to missing queue
      await this.redis.lpush(missingQueueKey, id);
      newCount++;
    }

    return newCount;
  }

  /**
   * Pop property ID from missing verification queue
   */
  async popFromMissingQueue(timeoutSeconds: number = 5): Promise<string | null> {
    const missingQueueKey = `${this.namespace}:missing_queue`;
    const result = await this.redis.brpop(missingQueueKey, timeoutSeconds);
    return result ? result[1] : null;
  }

  /**
   * Mark property as verified inactive (removed from portal)
   */
  async markVerifiedInactive(id: string): Promise<void> {
    const verifiedInactiveKey = `${this.namespace}:verified_inactive`;
    await this.redis.sadd(verifiedInactiveKey, id);

    // Remove from processed to allow re-verification if it comes back
    await this.redis.srem(this.processedIdsKey, id);
  }

  /**
   * Check if property is verified inactive
   */
  async isVerifiedInactive(id: string): Promise<boolean> {
    const verifiedInactiveKey = `${this.namespace}:verified_inactive`;
    return (await this.redis.sismember(verifiedInactiveKey, id)) === 1;
  }

  /**
   * Get count of verified inactive properties
   */
  async getVerifiedInactiveCount(): Promise<number> {
    const verifiedInactiveKey = `${this.namespace}:verified_inactive`;
    return await this.redis.scard(verifiedInactiveKey);
  }

  /**
   * Get missing queue depth
   */
  async getMissingQueueDepth(): Promise<number> {
    const missingQueueKey = `${this.namespace}:missing_queue`;
    return await this.redis.llen(missingQueueKey);
  }

  // ===== CHANGE DETECTION & SNAPSHOTS =====

  /**
   * Calculate checksum of important property fields (Italian properties)
   */
  private calculatePropertyChecksum(property: any): string {
    // Gather all important fields for Italian properties
    const importantData = {
      price: property.price?.value || 0,
      title: property.title || '',
      description: property.description || '',
      surface: property.surface || 0,
      rooms: property.rooms || 0,
      bathrooms: property.bathrooms || 0,
      floor: property.floor || '',
      images: (property.multimedia?.images || []).map((img: any) => img.url).join('|'),
      features: (property.features || []).sort().join('|'),
      properties: JSON.stringify((property.properties || []).sort()),
      location: JSON.stringify(property.location || {}),
      typology: property.typology || '',
    };

    // Create JSON string of all important data
    const dataString = JSON.stringify(importantData);

    // Calculate SHA256 checksum
    return crypto.createHash('sha256').update(dataString).digest('hex');
  }

  /**
   * Store property snapshot for change detection
   */
  async storePropertySnapshot(id: string, property: any): Promise<void> {
    const snapshotKey = `${this.namespace}:snapshot:${id}`;

    // Calculate comprehensive checksum
    const checksum = this.calculatePropertyChecksum(property);

    // Create snapshot with individual fields AND checksum
    const snapshot = {
      checksum: checksum,
      price: property.price?.value || 0,
      title: property.title || '',
      surface: property.surface || 0,
      updated_at: Date.now().toString(),
    };

    await this.redis.hset(snapshotKey, snapshot as any);
  }

  /**
   * Get property snapshot
   */
  async getPropertySnapshot(id: string): Promise<any | null> {
    const snapshotKey = `${this.namespace}:snapshot:${id}`;
    const snapshot = await this.redis.hgetall(snapshotKey);

    if (!snapshot || Object.keys(snapshot).length === 0) {
      return null;
    }

    return {
      checksum: snapshot.checksum,
      price: parseFloat(snapshot.price || '0'),
      title: snapshot.title,
      surface: parseFloat(snapshot.surface || '0'),
      updated_at: parseInt(snapshot.updated_at || '0', 10),
    };
  }

  /**
   * Detect changes between current property and snapshot
   * Uses comprehensive checksum comparison for efficiency
   * Returns true if property has changed
   */
  async hasPropertyChanged(id: string, currentProperty: any): Promise<boolean> {
    const snapshot = await this.getPropertySnapshot(id);

    // If no snapshot, it's a new property (considered changed)
    if (!snapshot) {
      return true;
    }

    // Calculate current property checksum
    const currentChecksum = this.calculatePropertyChecksum(currentProperty);

    // Compare checksums - single comparison for all fields!
    if (snapshot.checksum !== currentChecksum) {
      return true;
    }

    return false;
  }

  /**
   * Get change statistics
   */
  async getChangeStats(): Promise<{
    totalSnapshots: number;
    snapshotsWithChanges: number;
  }> {
    // Count snapshots
    const pattern = `${this.namespace}:snapshot:*`;
    const keys = await this.redis.keys(pattern);

    return {
      totalSnapshots: keys.length,
      snapshotsWithChanges: 0, // Would need to track separately
    };
  }
}
