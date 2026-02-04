/**
 * Simple utility functions
 * Replaces @shared/utils dependency
 */

export async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function sleep(ms: number): Promise<void> {
  return delay(ms);
}

export function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return delay(ms);
}
