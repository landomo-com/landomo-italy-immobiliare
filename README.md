# Immobiliare.it Scraper - Phase 2 Architecture

Scraper for [Immobiliare.it](https://www.immobiliare.it), Italy's leading real estate portal.

## Architecture Overview

This scraper uses a **two-phase distributed architecture** with Redis queue coordination:

- **Phase 1 (Coordinator)**: Discovers listing IDs from search pages → pushes to Redis queue
- **Phase 2 (Workers)**: Consume IDs from queue → fetch full details → send to Core Service

## Features

- **Redis Queue Architecture**: Distributed processing with multiple workers
- **DataDome Bypass**: Uses stealth Playwright to bypass bot protection
- **Change Detection**: Checksum-based tracking to detect property updates
- **Scraper DB (Tier 1)**: PostgreSQL database for raw data and change history
- **Adaptive Scheduling**: Scrape frequency adapts based on change rates
- **Missing Property Detection**: Identifies removed/sold properties
- **Prometheus Metrics**: (TODO) Monitoring and observability
- **Docker Deployment**: Containerized with docker-compose
- **Proxy Support**: Residential proxy integration for DataDome bypass

## Installation

```bash
npm install
```

## Quick Start

### 1. Setup Environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### 2. Start Infrastructure (Docker)

```bash
docker-compose up -d redis postgres
```

### 3. Initialize Database

```bash
psql -U landomo -h localhost -d scraper_italy_immobiliare < schema.sql
```

### 4. Run Coordinator (Phase 1)

```bash
npm run coordinator
```

Discovers all listing IDs and pushes to Redis queue.

### 5. Run Workers (Phase 2)

```bash
# Single worker
npm run worker

# Multiple workers (3 instances)
docker-compose up -d worker
```

Workers fetch property details and send to Core Service.

### 6. Monitor Progress

```bash
npm run queue:stats
```

## Commands

### Coordinator
```bash
npm run coordinator          # Discover listing IDs (all cities)
```

### Workers
```bash
npm run worker              # Start single worker
npm run worker:verifier     # Verify missing properties
```

### Queue Management
```bash
npm run queue:stats         # Show queue statistics
npm run queue:clear         # Clear all queue data
npm run queue:retry-failed  # Retry failed listings
npm run queue:show-failed   # Show failed listing IDs
```

### Docker
```bash
docker-compose up -d                    # Start all services
docker-compose up -d --scale worker=5   # Scale to 5 workers
docker-compose logs -f worker           # View worker logs
docker-compose down                     # Stop all services
```

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
