import { createLogger } from '@shared/logger';
/**
 * Parser for Immobiliare.it API responses
 *
 * Converts JSON API responses to standardized Property interface
 */

import type { Property } from '@shared/types.js';

const logger = createLogger('module');

export interface ImmobiliareApiListing {
  id: string;
  realEstate?: {
    id: string;
    title?: string;
    typology?: string;
    category?: {
      name?: string;
    };
    price?: {
      value?: number;
      formattedValue?: string;
    };
    location?: {
      city?: string;
      province?: string;
      region?: string;
      microzone?: string;
      macrozone?: string;
      latitude?: number;
      longitude?: number;
    };
    properties?: Array<{
      name?: string;
      value?: string | number;
      values?: Array<{ value?: string | number }>;
    }>;
    surface?: number;
    rooms?: number;
    bathrooms?: number;
    floor?: number;
    features?: string[];
    multimedia?: {
      images?: Array<{
        url?: string;
        caption?: string;
      }>;
    };
    description?: string;
    advertiser?: {
      name?: string;
      phone?: string;
      agency?: {
        name?: string;
      };
    };
  };
}

export interface ImmobiliareApiResponse {
  results?: ImmobiliareApiListing[];
  listings?: ImmobiliareApiListing[];
  realEstates?: ImmobiliareApiListing[];
  total?: number;
  count?: number;
}

/**
 * Extract numeric value from string (e.g., "100 m²" -> 100)
 */
function extractNumber(value: any): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const match = value.match(/[\d,]+/);
    if (match) {
      return parseFloat(match[0].replace(/,/g, ''));
    }
  }
  return undefined;
}

/**
 * Extract features from properties array
 */
function extractFeatures(properties?: Array<any>): string[] {
  if (!properties || !Array.isArray(properties)) {
    return [];
  }

  const features: string[] = [];

  for (const prop of properties) {
    if (prop.name && prop.value) {
      features.push(`${prop.name}: ${prop.value}`);
    } else if (prop.values && Array.isArray(prop.values)) {
      for (const val of prop.values) {
        if (val.value) {
          features.push(String(val.value));
        }
      }
    }
  }

  return features;
}

/**
 * Extract property details from properties array
 */
function extractDetails(listing: ImmobiliareApiListing) {
  const details: Property['details'] = {};
  const realEstate = listing.realEstate;

  if (!realEstate) {
    return details;
  }

  // Try direct fields first
  if (realEstate.surface) {
    details.sqm = extractNumber(realEstate.surface);
  }
  if (realEstate.rooms) {
    details.rooms = extractNumber(realEstate.rooms);
  }
  if (realEstate.bathrooms) {
    details.bathrooms = extractNumber(realEstate.bathrooms);
  }
  if (realEstate.floor !== undefined) {
    details.floor = extractNumber(realEstate.floor);
  }

  // Extract from properties array
  if (realEstate.properties && Array.isArray(realEstate.properties)) {
    for (const prop of realEstate.properties) {
      const name = prop.name?.toLowerCase() || '';

      if (name.includes('superficie') || name.includes('surface')) {
        details.sqm = details.sqm || extractNumber(prop.value);
      } else if (name.includes('locali') || name.includes('rooms')) {
        details.rooms = details.rooms || extractNumber(prop.value);
      } else if (name.includes('bagni') || name.includes('bathrooms')) {
        details.bathrooms = details.bathrooms || extractNumber(prop.value);
      } else if (name.includes('camere') || name.includes('bedrooms')) {
        details.bedrooms = details.bedrooms || extractNumber(prop.value);
      } else if (name.includes('piano') || name.includes('floor')) {
        details.floor = details.floor || extractNumber(prop.value);
      }
    }
  }

  return details;
}

/**
 * Parse a single listing from API response
 */
function parseListing(listing: ImmobiliareApiListing): Property | null {
  const realEstate = listing.realEstate;

  if (!realEstate || !realEstate.id) {
    return null;
  }

  // Build property URL
  const url = `https://www.immobiliare.it/annunci/${realEstate.id}/`;

  // Extract price
  const price = realEstate.price?.value || 0;

  // Extract location
  const location = realEstate.location || {};
  const city = location.city || location.province || 'Unknown';
  const region = location.region || '';
  const address = [location.microzone, location.macrozone]
    .filter(Boolean)
    .join(', ');

  // Extract coordinates
  const coordinates =
    location.latitude && location.longitude
      ? { lat: location.latitude, lon: location.longitude }
      : undefined;

  // Extract images
  const images: string[] = [];
  if (realEstate.multimedia?.images) {
    for (const img of realEstate.multimedia.images) {
      if (img.url) {
        images.push(img.url);
      }
    }
  }

  // Extract features
  const features = [
    ...(realEstate.features || []),
    ...extractFeatures(realEstate.properties),
  ];

  // Extract property type and transaction type
  const propertyType =
    realEstate.category?.name || realEstate.typology || 'Unknown';
  const transactionType = url.includes('/vendita/') ? 'sale' : 'rent';

  // Extract agent info
  const agent = realEstate.advertiser
    ? {
        name: realEstate.advertiser.name || 'Unknown',
        phone: realEstate.advertiser.phone,
        agency: realEstate.advertiser.agency?.name,
      }
    : undefined;

  const property: Property = {
    id: realEstate.id,
    source: 'immobiliare.it',
    url,
    title: realEstate.title || propertyType,
    price,
    currency: 'EUR',
    propertyType,
    transactionType,
    location: {
      address: address || undefined,
      city,
      region: region || undefined,
      country: 'Italy',
      coordinates,
    },
    details: extractDetails(listing),
    features,
    images,
    description: realEstate.description,
    agent,
    scrapedAt: new Date().toISOString(),
  };

  return property;
}

/**
 * Parse API response and extract properties
 */
export function parseApiResponse(apiResponse: any): Property[] {
  const properties: Property[] = [];

  // Handle different API response structures
  let listings: ImmobiliareApiListing[] = [];

  if (apiResponse.results) {
    listings = apiResponse.results;
  } else if (apiResponse.listings) {
    listings = apiResponse.listings;
  } else if (apiResponse.realEstates) {
    listings = apiResponse.realEstates;
  } else if (Array.isArray(apiResponse)) {
    listings = apiResponse;
  }

  for (const listing of listings) {
    try {
      const property = parseListing(listing);
      if (property) {
        properties.push(property);
      }
    } catch (error) {
      logger.error('Error parsing listing:', error);
      // Continue with next listing
    }
  }

  return properties;
}

/**
 * Parse Next.js data from __NEXT_DATA__ script tag
 */
export function parseNextData(nextDataJson: string): Property[] {
  try {
    const data = JSON.parse(nextDataJson);
    const listings = data?.props?.pageProps?.listings;

    if (!listings) {
      return [];
    }

    return parseApiResponse(listings);
  } catch (error) {
    logger.error('Error parsing __NEXT_DATA__:', error);
    return [];
  }
}
