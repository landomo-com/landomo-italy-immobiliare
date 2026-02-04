/**
 * Landomo Core Service Integration
 * Sends standardized property data to Core API
 */

import axios from 'axios';
import { config } from './config';
import { StandardProperty, IngestionPayload } from './transformer';

/**
 * Send property data to Landomo Core Service
 */
export async function sendToCoreService(payload: IngestionPayload): Promise<void> {
  if (!config.langomoApiKey) {
    console.warn('LANDOMO_API_KEY not set - skipping Core Service ingestion');
    return;
  }

  try {
    await axios.post(
      `${config.langomoApiUrl}/properties/ingest`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${config.langomoApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
  } catch (error) {
    console.error('Failed to send to Core Service:', error);
    throw error;
  }
}

/**
 * Mark property as inactive in Core Service
 */
export async function markPropertyInactive(
  portalId: string,
  reason: string = 'not_found'
): Promise<void> {
  const payload: any = {
    portal: 'immobiliare',
    portal_id: portalId,
    country: 'italy',
    data: null,
    status: 'inactive',
    inactive_reason: reason,
    last_seen: Date.now(),
  };

  await sendToCoreService(payload);
}
