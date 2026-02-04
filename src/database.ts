/**
 * PostgreSQL Database Client for Scraper DB (Tier 1)
 * Stores raw data, change history, and monitoring metadata for Immobiliare.it
 */

import { Pool } from 'pg';
import { createLogger } from './logger';
import { config } from './config';

const logger = createLogger('Database');

export class ScraperDatabase {
  private pool: Pool;
  private currentRunId: number | null = null;

  constructor() {
    this.pool = new Pool({
      host: config.postgresHost,
      port: config.postgresPort,
      database: config.postgresDb,
      user: config.postgresUser,
      password: config.postgresPassword,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected database error:', err);
    });
  }

  async initialize(): Promise<void> {
    try {
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      logger.info('Database connection established');
    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  /**
   * Start a new scrape run
   */
  async startScrapeRun(runType: 'city' | 'search'): Promise<number> {
    const result = await this.pool.query(
      'INSERT INTO scrape_runs (run_type, started_at, status) VALUES ($1, NOW(), $2) RETURNING id',
      [runType, 'running']
    );
    this.currentRunId = result.rows[0].id;
    logger.info(`Started scrape run #${this.currentRunId} (${runType})`);
    return this.currentRunId;
  }

  /**
   * Complete a scrape run
   */
  async completeScrapeRun(
    runId: number,
    stats: {
      propertiesDiscovered: number;
      propertiesChanged: number;
      propertiesUnchanged: number;
      propertiesNew: number;
      propertiesInactive: number;
      errorsCount: number;
    }
  ): Promise<void> {
    await this.pool.query(
      `UPDATE scrape_runs SET
        completed_at = NOW(),
        status = 'completed',
        properties_discovered = $2,
        properties_changed = $3,
        properties_unchanged = $4,
        properties_new = $5,
        properties_inactive = $6,
        errors_count = $7,
        duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))
      WHERE id = $1`,
      [
        runId,
        stats.propertiesDiscovered,
        stats.propertiesChanged,
        stats.propertiesUnchanged,
        stats.propertiesNew,
        stats.propertiesInactive,
        stats.errorsCount,
      ]
    );
    logger.info(`Completed scrape run #${runId}`);
  }

  /**
   * Store property snapshot
   */
  async storeSnapshot(
    portalId: string,
    rawData: any,
    checksum: string
  ): Promise<number> {
    const result = await this.pool.query(
      `INSERT INTO property_snapshots
        (portal_id, scraped_at, raw_data, checksum, price, status, transaction_type)
      VALUES ($1, NOW(), $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        portalId,
        rawData,
        checksum,
        rawData.price?.value || null,
        'active',
        rawData.forRent ? 'rent' : 'sale',
      ]
    );
    return result.rows[0].id;
  }

  /**
   * Record property change
   */
  async recordChange(
    portalId: string,
    changeType: string,
    fieldName: string,
    oldValue: any,
    newValue: any,
    snapshotId?: number
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO property_changes
        (portal_id, changed_at, change_type, field_name, old_value, new_value, snapshot_id)
      VALUES ($1, NOW(), $2, $3, $4, $5, $6)`,
      [portalId, changeType, fieldName, oldValue, newValue, snapshotId]
    );
  }

  /**
   * Update or create property metadata
   */
  async updatePropertyMetadata(
    portalId: string,
    data: {
      firstSeen?: Date;
      lastSeen: Date;
      lastChanged?: Date;
      currentStatus: string;
      currentPrice: number | null;
      hasChanges: boolean;
    }
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO property_metadata
        (portal_id, first_seen, last_seen, last_changed, current_status, current_price, scrape_count, change_count)
      VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
      ON CONFLICT (portal_id) DO UPDATE SET
        last_seen = EXCLUDED.last_seen,
        last_changed = CASE WHEN $7 > 0 THEN EXCLUDED.last_changed ELSE property_metadata.last_changed END,
        current_status = EXCLUDED.current_status,
        current_price = EXCLUDED.current_price,
        scrape_count = property_metadata.scrape_count + 1,
        change_count = property_metadata.change_count + $7,
        change_rate = (property_metadata.change_count + $7)::NUMERIC / (property_metadata.scrape_count + 1)::NUMERIC,
        updated_at = NOW()`,
      [
        portalId,
        data.firstSeen || data.lastSeen,
        data.lastSeen,
        data.lastChanged || data.lastSeen,
        data.currentStatus,
        data.currentPrice,
        data.hasChanges ? 1 : 0,
      ]
    );
  }

  /**
   * Get property metadata
   */
  async getPropertyMetadata(portalId: string): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT * FROM property_metadata WHERE portal_id = $1',
      [portalId]
    );
    return result.rows[0] || null;
  }

  /**
   * Update geographic area stats (Italian cities)
   */
  async updateAreaStats(
    areaName: string,
    areaType: 'city' | 'region',
    stats: {
      changeRate: number;
      totalProperties: number;
      activeProperties: number;
      avgChangesPerScrape: number;
    }
  ): Promise<void> {
    // Calculate adaptive scrape interval based on change rate
    let scrapeIntervalHours = 6; // Default
    if (stats.changeRate > 0.20) {
      scrapeIntervalHours = 2; // High activity
    } else if (stats.changeRate > 0.10) {
      scrapeIntervalHours = 4; // Medium-high activity
    } else if (stats.changeRate > 0.05) {
      scrapeIntervalHours = 6; // Medium activity
    } else if (stats.changeRate > 0.02) {
      scrapeIntervalHours = 12; // Low activity
    } else {
      scrapeIntervalHours = 24; // Very low activity
    }

    await this.pool.query(
      `INSERT INTO geographic_areas
        (area_name, area_type, change_rate, scrape_interval_hours, last_scraped, next_scrape,
         total_properties, active_properties, avg_changes_per_scrape)
      VALUES ($1, $2, $3, $4, NOW(), NOW() + ($4 || ' hours')::INTERVAL, $5, $6, $7)
      ON CONFLICT (area_name) DO UPDATE SET
        change_rate = EXCLUDED.change_rate,
        scrape_interval_hours = EXCLUDED.scrape_interval_hours,
        last_scraped = EXCLUDED.last_scraped,
        next_scrape = EXCLUDED.next_scrape,
        total_properties = EXCLUDED.total_properties,
        active_properties = EXCLUDED.active_properties,
        avg_changes_per_scrape = EXCLUDED.avg_changes_per_scrape,
        updated_at = NOW()`,
      [
        areaName,
        areaType,
        stats.changeRate,
        scrapeIntervalHours,
        stats.totalProperties,
        stats.activeProperties,
        stats.avgChangesPerScrape,
      ]
    );
  }

  /**
   * Get areas due for scraping
   */
  async getAreasDueForScraping(): Promise<Array<{
    areaName: string;
    areaType: string;
    changeRate: number;
    scrapeIntervalHours: number;
    lastScraped: Date;
    nextScrape: Date;
  }>> {
    const result = await this.pool.query(
      `SELECT area_name, area_type, change_rate, scrape_interval_hours, last_scraped, next_scrape
       FROM geographic_areas
       WHERE next_scrape <= NOW()
       ORDER BY change_rate DESC, next_scrape ASC
       LIMIT 100`
    );
    return result.rows;
  }

  /**
   * Get high-change properties for priority processing
   */
  async getHighChangeProperties(limit: number = 1000): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT portal_id FROM property_metadata
       WHERE change_rate > 0.15
       AND last_seen > NOW() - INTERVAL '7 days'
       ORDER BY change_rate DESC, last_changed DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => row.portal_id);
  }

  /**
   * Record detailed changes between snapshots (Italian properties)
   */
  async recordDetailedChanges(
    portalId: string,
    oldData: any,
    newData: any,
    snapshotId: number
  ): Promise<void> {
    const changes: Array<{ type: string; field: string; oldVal: any; newVal: any }> = [];

    // Price change
    const oldPrice = oldData.price?.value || 0;
    const newPrice = newData.price?.value || 0;
    if (oldPrice !== newPrice) {
      changes.push({ type: 'price', field: 'price.value', oldVal: oldPrice, newVal: newPrice });
    }

    // Title change
    if (oldData.title !== newData.title) {
      changes.push({
        type: 'title',
        field: 'title',
        oldVal: oldData.title?.substring(0, 100),
        newVal: newData.title?.substring(0, 100),
      });
    }

    // Description change
    if (oldData.description !== newData.description) {
      changes.push({
        type: 'description',
        field: 'description',
        oldVal: oldData.description?.substring(0, 100),
        newVal: newData.description?.substring(0, 100),
      });
    }

    // Images change
    const oldImages = oldData.multimedia?.images?.length || 0;
    const newImages = newData.multimedia?.images?.length || 0;
    if (oldImages !== newImages) {
      changes.push({
        type: 'images',
        field: 'multimedia.images.length',
        oldVal: oldImages,
        newVal: newImages,
      });
    }

    // Surface change
    if (oldData.surface !== newData.surface) {
      changes.push({
        type: 'surface',
        field: 'surface',
        oldVal: oldData.surface,
        newVal: newData.surface,
      });
    }

    // Store all changes
    for (const change of changes) {
      await this.recordChange(
        portalId,
        change.type,
        change.field,
        change.oldVal,
        change.newVal,
        snapshotId
      );
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection closed');
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    totalSnapshots: number;
    totalChanges: number;
    totalProperties: number;
    activeProperties: number;
    avgChangeRate: number;
  }> {
    const result = await this.pool.query(`
      SELECT
        (SELECT COUNT(*) FROM property_snapshots) as total_snapshots,
        (SELECT COUNT(*) FROM property_changes) as total_changes,
        (SELECT COUNT(*) FROM property_metadata) as total_properties,
        (SELECT COUNT(*) FROM property_metadata WHERE current_status = 'active') as active_properties,
        (SELECT AVG(change_rate) FROM property_metadata) as avg_change_rate
    `);
    return {
      totalSnapshots: parseInt(result.rows[0].total_snapshots),
      totalChanges: parseInt(result.rows[0].total_changes),
      totalProperties: parseInt(result.rows[0].total_properties),
      activeProperties: parseInt(result.rows[0].active_properties),
      avgChangeRate: parseFloat(result.rows[0].avg_change_rate || 0),
    };
  }
}
