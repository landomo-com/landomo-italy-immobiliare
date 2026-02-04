/**
 * Immobiliare.it Configuration
 */

import * as dotenv from 'dotenv';
dotenv.config();

export interface ImmobiliareConfig {
  // Redis
  redisUrl: string;

  // Core Service
  langomoApiUrl: string;
  langomoApiKey: string;

  // PostgreSQL (Tier 1 Scraper DB)
  postgresHost: string;
  postgresPort: number;
  postgresDb: string;
  postgresUser: string;
  postgresPassword: string;

  // Scraper settings
  transactionType: 'sale' | 'rent';
  requestDelayMs: number;
  headless: boolean;
  debug: boolean;

  // Proxy settings (for DataDome bypass)
  proxyServer?: string;
  proxyUsername?: string;
  proxyPassword?: string;

  // Rate limiting
  maxConcurrentWorkers: number;
  minDelayMs: number;
  maxDelayMs: number;
}

export const config: ImmobiliareConfig = {
  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Core Service
  langomoApiUrl: process.env.LANDOMO_API_URL || 'https://core.landomo.com/api/v1',
  langomoApiKey: process.env.LANDOMO_API_KEY || '',

  // PostgreSQL
  postgresHost: process.env.POSTGRES_HOST || 'localhost',
  postgresPort: parseInt(process.env.POSTGRES_PORT || '5432'),
  postgresDb: process.env.POSTGRES_DB || 'scraper_italy_immobiliare',
  postgresUser: process.env.POSTGRES_USER || 'landomo',
  postgresPassword: process.env.POSTGRES_PASSWORD || '',

  // Scraper settings
  transactionType: (process.env.TRANSACTION_TYPE || 'sale') as 'sale' | 'rent',
  requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || '2000'),
  headless: process.env.HEADLESS !== 'false',
  debug: process.env.DEBUG === 'true',

  // Proxy settings
  proxyServer: process.env.PROXY_SERVER,
  proxyUsername: process.env.PROXY_USERNAME,
  proxyPassword: process.env.PROXY_PASSWORD,

  // Rate limiting
  maxConcurrentWorkers: parseInt(process.env.MAX_CONCURRENT_WORKERS || '3'),
  minDelayMs: parseInt(process.env.MIN_DELAY_MS || '3000'),
  maxDelayMs: parseInt(process.env.MAX_DELAY_MS || '5000'),
};

// Italian cities for scraping
export const ITALIAN_CITIES = [
  'milano',
  'roma',
  'napoli',
  'torino',
  'firenze',
  'bologna',
  'genova',
  'palermo',
  'venezia',
  'verona',
  'bari',
  'catania',
  'trieste',
  'padova',
  'brescia',
  'parma',
  'modena',
  'reggio-emilia',
  'reggio-calabria',
  'perugia',
  'ravenna',
  'livorno',
  'cagliari',
  'foggia',
  'salerno',
  'ferrara',
  'sassari',
  'monza',
  'siracusa',
  'pescara',
  'bergamo',
  'latina',
  'vicenza',
  'terni',
  'forlì',
  'trento',
  'novara',
  'piacenza',
  'ancona',
  'andria',
  'arezzo',
  'udine',
  'cesena',
  'lecce',
  'pesaro',
  'prato',
  'taranto',
  'la-spezia',
  'como',
  'pisa',
  'lucca',
  'varese',
  'rimini',
  'bolzano',
  'catanzaro',
];

// Cities with coordinates for geo-based scraping
export interface CityCoords {
  lat: number;
  lng: number;
  name: string;
}

export const MAJOR_CITIES_COORDS: Record<string, CityCoords> = {
  'milano': { lat: 45.4642, lng: 9.1900, name: 'Milano' },
  'roma': { lat: 41.9028, lng: 12.4964, name: 'Roma' },
  'napoli': { lat: 40.8518, lng: 14.2681, name: 'Napoli' },
  'torino': { lat: 45.0703, lng: 7.6869, name: 'Torino' },
  'firenze': { lat: 43.7696, lng: 11.2558, name: 'Firenze' },
  'bologna': { lat: 44.4949, lng: 11.3426, name: 'Bologna' },
  'genova': { lat: 44.4056, lng: 8.9463, name: 'Genova' },
  'palermo': { lat: 38.1157, lng: 13.3615, name: 'Palermo' },
  'venezia': { lat: 45.4408, lng: 12.3155, name: 'Venezia' },
  'verona': { lat: 45.4384, lng: 10.9916, name: 'Verona' },
};
