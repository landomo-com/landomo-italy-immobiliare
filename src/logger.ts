/**
 * Simple logger utility for scraper
 * Replaces @shared/logger dependency
 */

export interface Logger {
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

export function createLogger(module: string): Logger {
  const prefix = `[${module}]`;

  return {
    info: (message: string, ...args: any[]) => {
      console.log(`${prefix} ${message}`, ...args);
    },
    warn: (message: string, ...args: any[]) => {
      console.warn(`${prefix} ${message}`, ...args);
    },
    error: (message: string, ...args: any[]) => {
      console.error(`${prefix} ${message}`, ...args);
    },
    debug: (message: string, ...args: any[]) => {
      if (process.env.DEBUG === 'true') {
        console.debug(`${prefix} ${message}`, ...args);
      }
    }
  };
}
