import { CheckServiceAreaInput } from "../schemas/toolSchemas";
import { env } from "../config/env";
import { elijahPestControlKnowledgeBase } from "../retell/knowledgeBase";

export type ServiceAreaStatus = "in_area" | "maybe" | "out_of_area" | "unknown";

export interface ServiceAreaResult {
  status: ServiceAreaStatus;
  normalized_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  reason: string;
  message_for_agent: string;
}

function configuredServiceArea(): string {
  const match = elijahPestControlKnowledgeBase.match(/^Service Area:\s*(.*)$/m);
  return match?.[1]?.trim().toLowerCase() ?? "";
}

function tokenMatch(needle: string | null | undefined, haystack: string): boolean {
  if (!needle || !haystack) return false;
  return haystack.includes(needle.toLowerCase().trim());
}

function listFromEnv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const digits = zip.replace(/\D/g, "").slice(0, 5);
  return digits.length === 5 ? digits : null;
}

function parseAddress(input: CheckServiceAreaInput) {
  const address = input.address || input.property_address || input.property_street || "";
  const text = [address, input.city, input.state, input.zip_code, input.property_city, input.property_state, input.property_zip]
    .filter(Boolean)
    .join(", ");
  const zip = normalizeZip(input.property_zip || input.zip_code || text.match(/\b\d{5}(?:-\d{4})?\b/)?.[0]);
  const state =
    input.property_state ||
    input.state ||
    text.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i)?.[0] ||
    null;
  const city = input.property_city || input.city || null;
  return {
    normalized_address: text || null,
    city,
    state: state ? state.toUpperCase() : null,
    zip,
  };
}

function maybeResult(parsed: ReturnType<typeof parseAddress>, reason: string): ServiceAreaResult {
  return {
    status: "maybe",
    ...parsed,
    reason,
    message_for_agent:
      "The service area could not be confirmed from the configured data. Continue capturing the lead and say the team can confirm coverage.",
  };
}

function toNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radiusMiles = 3958.8;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusMiles * Math.asin(Math.sqrt(h));
}

async function geocodeAddress(address: string): Promise<
  | {
      normalized_address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      location: { lat: number; lng: number } | null;
    }
  | null
> {
  if (!env.GOOGLE_MAPS_API_KEY || !address) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);
  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      address_components?: Array<{ long_name?: string; short_name?: string; types?: string[] }>;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };
  if (payload.status !== "OK" || !payload.results?.[0]) return null;
  const result = payload.results[0];
  const component = (type: string) =>
    result.address_components?.find((item) => item.types?.includes(type));
  const city =
    component("locality")?.long_name ||
    component("postal_town")?.long_name ||
    component("sublocality")?.long_name ||
    null;
  const state = component("administrative_area_level_1")?.short_name || null;
  const zip = normalizeZip(component("postal_code")?.long_name);
  const lat = result.geometry?.location?.lat;
  const lng = result.geometry?.location?.lng;
  return {
    normalized_address: result.formatted_address || address,
    city,
    state,
    zip,
    location: typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null,
  };
}

function configuredAreaResult(parsed: ReturnType<typeof parseAddress>, location?: { lat: number; lng: number } | null): ServiceAreaResult | null {
  if (!parsed.normalized_address && !parsed.city && !parsed.state && !parsed.zip) {
    return {
      status: "unknown",
      ...parsed,
      reason: "no_location_supplied",
      message_for_agent:
        "No address, city, or ZIP was provided. Do not confirm coverage; continue and say the team can confirm the service area.",
    };
  }

  const centerLat = toNumber(env.SERVICE_AREA_CENTER_LAT);
  const centerLng = toNumber(env.SERVICE_AREA_CENTER_LNG);
  const radiusMiles = toNumber(env.SERVICE_AREA_RADIUS_MILES);
  if (location && centerLat !== null && centerLng !== null && radiusMiles !== null) {
    const distance = distanceMiles({ lat: centerLat, lng: centerLng }, location);
    return {
      status: distance <= radiusMiles ? "in_area" : "out_of_area",
      ...parsed,
      reason: distance <= radiusMiles ? "within_configured_radius" : "outside_configured_radius",
      message_for_agent:
        distance <= radiusMiles
          ? "The address appears to be within the configured service radius. Continue normally."
          : "The address appears to be outside the configured service radius. Do not reject harshly; say the team can confirm coverage or follow up.",
    };
  }

  const allowedZips = listFromEnv(env.SERVICE_AREA_ZIPS);
  const allowedCities = listFromEnv(env.SERVICE_AREA_CITIES);
  if (parsed.zip && allowedZips.length > 0) {
    if (allowedZips.includes(parsed.zip)) {
      return {
        status: "in_area",
        ...parsed,
        reason: "zip_in_configured_service_area",
        message_for_agent: "The address ZIP appears to be in the configured service area. Continue normally.",
      };
    }
    return {
      status: "out_of_area",
      ...parsed,
      reason: "zip_not_in_configured_service_area",
      message_for_agent:
        "This ZIP is not in the configured service area list. Do not reject harshly; say the team can confirm coverage or follow up.",
    };
  }
  if (parsed.city && allowedCities.length > 0) {
    if (allowedCities.includes(parsed.city.toLowerCase())) {
      return {
        status: "in_area",
        ...parsed,
        reason: "city_in_configured_service_area",
        message_for_agent: "The city appears to be in the configured service area. Continue normally.",
      };
    }
    return {
      status: "out_of_area",
      ...parsed,
      reason: "city_not_in_configured_service_area",
      message_for_agent:
        "This city is not in the configured service area list. Do not reject harshly; say the team can confirm coverage or follow up.",
    };
  }

  const serviceArea = configuredServiceArea();
  if (!serviceArea) {
    return maybeResult(parsed, "no_structured_or_kb_service_area");
  }

  if (parsed.zip && tokenMatch(parsed.zip, serviceArea)) {
    return {
      status: "in_area",
      ...parsed,
      reason: "zip_in_kb_service_area",
      message_for_agent: "The caller appears to match the service area listed in the knowledge base. Continue normally.",
    };
  }

  const city = parsed.city?.toLowerCase().trim();
  const state = parsed.state?.toLowerCase().trim();
  if (tokenMatch(city, serviceArea) || tokenMatch(state, serviceArea)) {
    return {
      status: "in_area",
      ...parsed,
      reason: "city_or_state_in_kb_service_area",
      message_for_agent: "The caller appears to match the service area listed in the knowledge base. Continue normally.",
    };
  }

  return maybeResult(parsed, "location_not_clearly_listed");
}

export async function checkServiceArea(input: CheckServiceAreaInput): Promise<ServiceAreaResult> {
  const parsed = parseAddress(input);
  const geocoded = parsed.normalized_address ? await geocodeAddress(parsed.normalized_address) : null;
  const enriched = geocoded
    ? {
        normalized_address: geocoded.normalized_address ?? parsed.normalized_address,
        city: geocoded.city ?? parsed.city,
        state: geocoded.state ?? parsed.state,
        zip: geocoded.zip ?? parsed.zip,
      }
    : parsed;
  const result = configuredAreaResult(enriched, geocoded?.location);
  return result ?? maybeResult(enriched, "service_area_not_configured");
}
