/**
 * Transformer for Immobiliare.it
 *
 * Converts Italian property data to StandardProperty format
 * Handles Italian market conventions and property types
 */

import type { Property } from './types';

/**
 * StandardProperty interface (from @landomo/core)
 * Since @landomo/core is not installed, we define the interface here
 */
export interface StandardProperty {
  // Basic info
  title: string;
  price: number;
  currency: string;
  property_type: string;
  transaction_type: 'sale' | 'rent';
  source_url?: string;

  // Location (standardized)
  location: {
    address?: string;
    city: string;
    region?: string;
    country: string;
    postal_code?: string;
    coordinates?: {
      lat: number;
      lon: number;
    };
    geohash?: string;
  };

  // Details (standardized for cross-country comparison)
  details: {
    bedrooms?: number;
    bathrooms?: number;
    sqm?: number;
    sqm_type?: string;
    floor?: number;
    total_floors?: number;
    rooms?: number;
    year_built?: number;
  };

  // Media
  images?: string[];
  videos?: string[];
  description?: string;
  description_language?: string;

  // Agent/Agency
  agent?: {
    name: string;
    phone?: string;
    email?: string;
    agency?: string;
    agency_logo?: string;
  };

  // Features (standardized array)
  features?: string[];

  // Amenities (structured booleans for filtering)
  amenities?: {
    has_parking?: boolean;
    has_garden?: boolean;
    has_balcony?: boolean;
    has_terrace?: boolean;
    has_pool?: boolean;
    has_elevator?: boolean;
    has_garage?: boolean;
    has_basement?: boolean;
    has_fireplace?: boolean;
    is_furnished?: boolean;
    is_new_construction?: boolean;
    is_luxury?: boolean;
  };

  // Energy rating
  energy_rating?: string;

  // Financial
  price_per_sqm?: number;
  hoa_fees?: number;
  property_tax?: number;

  // Country-specific fields (Italian market conventions)
  country_specific?: Record<string, any>;

  // Status
  status?: 'active' | 'removed' | 'sold' | 'rented';
}

/**
 * Normalize Italian property types to standard types
 */
function normalizePropertyType(italianType: string): string {
  const type = italianType.toLowerCase();

  // Common Italian property types
  const typeMap: Record<string, string> = {
    'appartamento': 'apartment',
    'monolocale': 'studio',
    'bilocale': 'apartment',
    'trilocale': 'apartment',
    'villa': 'villa',
    'villetta': 'villa',
    'casa': 'house',
    'casa indipendente': 'house',
    'casale': 'farmhouse',
    'rustico': 'farmhouse',
    'loft': 'loft',
    'attico': 'penthouse',
    'mansarda': 'attic',
    'palazzo': 'building',
    'terreno': 'land',
    'box': 'garage',
    'garage': 'garage',
    'posto auto': 'parking',
    'ufficio': 'office',
    'negozio': 'commercial',
    'locale commerciale': 'commercial',
    'capannone': 'warehouse',
  };

  for (const [italian, standard] of Object.entries(typeMap)) {
    if (type.includes(italian)) {
      return standard;
    }
  }

  return italianType; // Return original if no match
}

/**
 * Extract amenities from Italian features array
 */
function extractAmenities(features: string[]): StandardProperty['amenities'] {
  const amenities: StandardProperty['amenities'] = {};

  const featureText = features.join(' ').toLowerCase();

  // Parking
  if (featureText.includes('parcheggio') ||
      featureText.includes('posto auto') ||
      featureText.includes('garage') ||
      featureText.includes('box')) {
    amenities.has_parking = true;
  }

  // Garden
  if (featureText.includes('giardino')) {
    amenities.has_garden = true;
  }

  // Balcony
  if (featureText.includes('balcone')) {
    amenities.has_balcony = true;
  }

  // Terrace
  if (featureText.includes('terrazzo') ||
      featureText.includes('terrazza')) {
    amenities.has_terrace = true;
  }

  // Pool
  if (featureText.includes('piscina')) {
    amenities.has_pool = true;
  }

  // Elevator
  if (featureText.includes('ascensore')) {
    amenities.has_elevator = true;
  }

  // Garage
  if (featureText.includes('garage') ||
      featureText.includes('box auto')) {
    amenities.has_garage = true;
  }

  // Basement/Cellar
  if (featureText.includes('cantina') ||
      featureText.includes('seminterrato')) {
    amenities.has_basement = true;
  }

  // Fireplace
  if (featureText.includes('camino')) {
    amenities.has_fireplace = true;
  }

  // Furnished
  if (featureText.includes('arredato')) {
    amenities.is_furnished = true;
  }

  // New construction
  if (featureText.includes('nuova costruzione') ||
      featureText.includes('nuovo')) {
    amenities.is_new_construction = true;
  }

  // Luxury
  if (featureText.includes('lusso') ||
      featureText.includes('prestigio')) {
    amenities.is_luxury = true;
  }

  return amenities;
}

/**
 * Extract Italian country-specific fields
 */
function extractCountrySpecific(property: Property): Record<string, any> {
  const countrySpecific: Record<string, any> = {};

  // Extract energy class from features
  const energyPattern = /classe energetica[:\s]*([A-G][0-9]*)/i;
  const energyMatch = property.features?.join(' ').match(energyPattern);
  if (energyMatch) {
    countrySpecific.classe_energetica = energyMatch[1];
  }

  // Extract property condition (stato)
  const statoPattern = /stato[:\s]*(ottimo|buono|da ristrutturare|nuovo)/i;
  const statoMatch = property.features?.join(' ').match(statoPattern);
  if (statoMatch) {
    countrySpecific.stato = statoMatch[1].toLowerCase();
  }

  // Extract heating type (riscaldamento)
  const heatingPattern = /riscaldamento[:\s]*(autonomo|centralizzato|condominiale)/i;
  const heatingMatch = property.features?.join(' ').match(heatingPattern);
  if (heatingMatch) {
    countrySpecific.riscaldamento = heatingMatch[1].toLowerCase();
  }

  // Extract property type specific details
  const propertyTypeSpecific = extractPropertyTypeSpecific(property);
  Object.assign(countrySpecific, propertyTypeSpecific);

  // Extract expenses (spese condominiali)
  const spesePattern = /spese[:\s]*€?\s*([\d.,]+)/i;
  const speseMatch = property.features?.join(' ').match(spesePattern);
  if (speseMatch) {
    countrySpecific.spese_condominiali = parseFloat(speseMatch[1].replace(/[.,]/g, ''));
  }

  // Add original Italian property type
  countrySpecific.tipologia_originale = property.propertyType;

  return countrySpecific;
}

/**
 * Extract property type specific details for Italian properties
 */
function extractPropertyTypeSpecific(property: Property): Record<string, any> {
  const specific: Record<string, any> = {};

  // Apartment/flat specific
  if (property.propertyType.toLowerCase().includes('appartamento') ||
      property.propertyType.toLowerCase().includes('locale')) {

    // Extract layout (disposizione)
    if (property.propertyType.includes('monolocale')) {
      specific.disposizione = 'monolocale';
    } else if (property.propertyType.includes('bilocale')) {
      specific.disposizione = 'bilocale';
    } else if (property.propertyType.includes('trilocale')) {
      specific.disposizione = 'trilocale';
    } else if (property.propertyType.includes('quadrilocale')) {
      specific.disposizione = 'quadrilocale';
    }

    // Extract floor information
    if (property.details?.floor !== undefined) {
      specific.piano = property.details.floor;

      // Add floor description
      if (property.details.floor === 0) {
        specific.piano_descrizione = 'piano terra';
      } else if (property.details.floor < 0) {
        specific.piano_descrizione = 'piano seminterrato';
      } else if (property.details.floor === property.details.totalFloors) {
        specific.piano_descrizione = 'ultimo piano';
      }
    }
  }

  // Villa/House specific
  if (property.propertyType.toLowerCase().includes('villa') ||
      property.propertyType.toLowerCase().includes('casa')) {

    // Check for independent property
    if (property.propertyType.toLowerCase().includes('indipendente')) {
      specific.tipo_proprieta = 'indipendente';
    }

    // Check for semi-detached (bifamiliare)
    if (property.propertyType.toLowerCase().includes('bifamiliare')) {
      specific.tipo_proprieta = 'bifamiliare';
    }
  }

  return specific;
}

/**
 * Calculate price per square meter
 */
function calculatePricePerSqm(price: number, sqm?: number): number | undefined {
  if (!sqm || sqm === 0) {
    return undefined;
  }
  return Math.round(price / sqm);
}

/**
 * Transform Italian property to StandardProperty format
 */
export function transformToStandard(property: Property): StandardProperty {
  const standardized: StandardProperty = {
    title: property.title,
    price: property.price,
    currency: property.currency,
    property_type: normalizePropertyType(property.propertyType),
    transaction_type: property.transactionType as 'sale' | 'rent',
    source_url: property.url,

    location: {
      address: property.location.address,
      city: property.location.city,
      region: property.location.region,
      country: 'italy',
      postal_code: property.location.postcode,
      coordinates: property.location.coordinates,
    },

    details: {
      bedrooms: property.details?.bedrooms,
      bathrooms: property.details?.bathrooms,
      sqm: property.details?.sqm,
      sqm_type: 'living', // Italian properties typically report living area
      floor: property.details?.floor,
      total_floors: property.details?.totalFloors,
      rooms: property.details?.rooms,
      year_built: property.details?.constructionYear,
    },

    images: property.images,
    description: property.description || property.details?.description,
    description_language: 'it',

    agent: property.agent ? {
      name: property.agent.name || 'Unknown',
      phone: property.agent.phone,
      email: property.agent.email,
      agency: property.agent.agency,
    } : undefined,

    features: property.features,

    amenities: extractAmenities(property.features || []),

    price_per_sqm: calculatePricePerSqm(property.price, property.details?.sqm),

    country_specific: extractCountrySpecific(property),

    status: 'active',
  };

  // Extract energy rating from features
  const energyPattern = /classe energetica[:\s]*([A-G][0-9]*)/i;
  const energyMatch = property.features?.join(' ').match(energyPattern);
  if (energyMatch) {
    standardized.energy_rating = energyMatch[1];
  }

  return standardized;
}

/**
 * Create ingestion payload for Core Service
 */
export interface IngestionPayload {
  portal: string;
  portal_id: string;
  country: string;
  data: StandardProperty;
  raw_data: any;
}

export function createIngestionPayload(
  property: Property,
  rawData?: any
): IngestionPayload {
  return {
    portal: 'immobiliare',
    portal_id: property.id,
    country: 'italy',
    data: transformToStandard(property),
    raw_data: rawData || property,
  };
}

/**
 * Batch transform multiple properties
 */
export function transformBatch(properties: Property[]): StandardProperty[] {
  return properties.map(transformToStandard);
}

/**
 * Create batch ingestion payloads
 */
export function createBatchIngestionPayloads(
  properties: Property[]
): IngestionPayload[] {
  return properties.map(property => createIngestionPayload(property));
}
