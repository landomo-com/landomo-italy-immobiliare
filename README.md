# Immobiliare.it Scraper

Scraper for [Immobiliare.it](https://www.immobiliare.it), Italy's leading real estate portal.

## Features

- **JSON API Interception**: Intercepts API calls to `/api-next/search-list/listings/` for structured data
- **DataDome Bypass**: Uses stealth Playwright to bypass DataDome bot protection
- **Redis Storage**: Stores scraped properties in Redis for easy access
- **CLI Interface**: Simple command-line interface with Commander.js
- **Proxy Support**: Optional proxy configuration for enhanced stealth

## Installation

```bash
npm install
```

## Usage

### Basic Usage

```bash
# Test with Milano, limit 5 properties
npm test

# Or using tsx directly
tsx src/index.ts --location milano --limit 5
```

### Advanced Usage

```bash
# Scrape Rome with 10 properties for rent
tsx src/index.ts --location roma --transactionType rent --limit 10

# Scrape Naples, up to 5 pages
tsx src/index.ts --location napoli --maxPages 5

# Run with visible browser (non-headless)
tsx src/index.ts --location firenze --no-headless --limit 5
```

### Available Options

- `--location <city>` - City to scrape (default: milano)
  - Available: milano, roma, napoli, torino, firenze, bologna, genova, palermo, venezia, verona, bari, catania, trieste, padova, brescia
- `--transactionType <sale|rent>` - Transaction type (default: sale)
- `--limit <number>` - Maximum properties to scrape
- `--maxPages <number>` - Maximum pages per city (default: 3)
- `--headless <true|false>` - Run browser in headless mode (default: true)
- `--no-headless` - Run browser with visible window
- `--help` - Show help message

## How It Works

### Architecture

1. **Stealth Playwright**: Launches Chromium with stealth configurations from `shared/stealth.ts`
2. **API Interception**: Intercepts network requests to the JSON API endpoint
3. **Data Extraction**: Parses JSON responses into standardized Property interface
4. **Redis Storage**: Saves properties to Redis for persistence

### DataDome Protection

Immobiliare.it uses DataDome for bot protection. This scraper bypasses it using:

1. **Stealth techniques** from `shared/stealth.ts`:
   - Browser fingerprint masking
   - WebDriver detection evasion
   - Human-like behavior simulation

2. **Proxy support** (recommended for production):
   ```bash
   export PROXY_SERVER=http://proxy.example.com:8080
   export PROXY_USERNAME=your_username
   export PROXY_PASSWORD=your_password
   ```

### API Endpoint

The scraper intercepts calls to:
```
https://www.immobiliare.it/api-next/search-list/listings/
```

This endpoint returns structured JSON data with property information.

## Data Structure

Properties are parsed into the standardized `Property` interface:

```typescript
interface Property {
  id: string;
  source: string;              // "immobiliare.it"
  url: string;
  title: string;
  price: number;
  currency: string;            // "EUR"
  propertyType: string;
  transactionType: string;     // "sale" or "rent"
  location: {
    address?: string;
    city: string;
    region?: string;
    country: string;           // "Italy"
    coordinates?: { lat: number; lon: number };
  };
  details: {
    bedrooms?: number;
    bathrooms?: number;
    sqm?: number;
    floor?: number;
    rooms?: number;
  };
  features: string[];
  images: string[];
  description?: string;
  agent?: {
    name: string;
    phone?: string;
    agency?: string;
  };
  scrapedAt: string;
}
```

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

## Troubleshooting

### DataDome Challenge Detected

If you see "DataDome protection detected", try:

1. **Use a proxy**: Residential or mobile proxies work best
2. **Reduce scraping speed**: Increase delays between requests
3. **Run non-headless**: Sometimes visible browsers are less suspicious

### No Properties Found

Check:
1. City name is correct (use lowercase, e.g., "milano" not "Milan")
2. Network connection is stable
3. Redis is running (if storing results)

### API Calls Not Intercepted

The scraper has a fallback that extracts data from `__NEXT_DATA__` if API interception fails.

## Dependencies

- `playwright` - Browser automation
- `commander` - CLI framework
- `redis` - Redis client for storage
- `tsx` - TypeScript execution
- `typescript` - TypeScript compiler

## Related Files

- `shared/stealth.ts` - Stealth browser configuration for DataDome bypass
- `shared/redis.ts` - Redis client and storage utilities
- `shared/types.ts` - TypeScript type definitions

## License

MIT
