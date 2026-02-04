/**
 * Redis stub implementation
 * Replaces @shared/redis dependency
 * For now, this is a no-op implementation
 */

import type { Property } from './types';

export async function connectRedis(): Promise<void> {
  // No-op for now - can be implemented later if needed
  console.log('[redis] Connect called (stub implementation)');
}

export async function disconnectRedis(): Promise<void> {
  // No-op for now
  console.log('[redis] Disconnect called (stub implementation)');
}

export async function saveProperties(properties: Property[]): Promise<void> {
  // No-op for now - properties can be saved via Core Service API instead
  console.log(`[redis] SaveProperties called with ${properties.length} properties (stub implementation)`);
}
