import * as proj4Module from "proj4";
import { delay } from "./delay";
import { logger } from "@/lib/logger";

const proj4 = proj4Module.default || proj4Module;

const DELAY_BETWEEN_REQUESTS = 2000; // 2 seconds matching other crawlers

// Define BGS 2005 / CCS2005 (EPSG:7801) - Lambert Conformal Conic projection
// This is the main projection used by Bulgarian Cadastre for cadastral mapping
// Source: https://epsg.io/7801
proj4.defs(
  "EPSG:7801",
  "+proj=lcc +lat_0=42.6678756833333 +lon_0=25.5 +lat_1=42 +lat_2=43.3333333333333 +x_0=500000 +y_0=4725824.3591 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
);

// Define Zone 34 for reference (not typically used by cadastre)
proj4.defs(
  "EPSG:7802",
  "+proj=utm +zone=34 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
);

interface CadastreSession {
  cookies: Map<string, string>;
  csrfToken: string;
}

interface CadastreSearchResult {
  Id: string;
  Type: number;
  Number: string;
  Title: string;
  ShortDescription: string;
  Hash: number;
  OfficeId: string;
}

interface ESRIGeometry {
  rings: number[][][]; // [[[x, y], [x, y], ...]]
}

interface CadastreGeometryResponse {
  Type: number;
  Format: string;
  Geometry: ESRIGeometry;
  SpatialReferenceCode: string;
  Attributes: {
    cadnum: string;
    xc: number;
    yc: number;
    [key: string]: unknown;
  };
}

export interface CadastralGeometry {
  identifier: string;
  polygon: [number, number][][]; // GeoJSON coordinates [lng, lat]
}

/**
 * Initialize session by visiting main page and extracting CSRF token
 */
async function initializeSession(): Promise<CadastreSession> {
  const cookies = new Map<string, string>();

  const mainPageResponse = await fetch(
    "https://kais.cadastre.bg/bg/Map/Index",
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    },
  );

  // Parse cookies
  const setCookieHeader = mainPageResponse.headers.get("set-cookie");
  if (setCookieHeader) {
    const cookiePairs = setCookieHeader.split(",").map((c) => c.trim());
    for (const pair of cookiePairs) {
      const match = pair.match(/^([^=]+)=([^;]+)/);
      if (match) {
        cookies.set(match[1], match[2]);
      }
    }
  }

  // Extract CSRF token from HTML
  const html = await mainPageResponse.text();
  const csrfMatch = html.match(
    /name="__RequestVerificationToken".*?value="([^"]+)"/,
  );
  if (!csrfMatch) {
    throw new Error("Failed to extract CSRF token from cadastre main page");
  }

  return {
    cookies,
    csrfToken: csrfMatch[1],
  };
}

/**
 * Step 1: FastSearch - Initiate search for cadastral identifier
 */
async function fastSearch(
  session: CadastreSession,
  identifier: string,
): Promise<void> {
  const searchUrl = `https://kais.cadastre.bg/bg/Map/FastSearch?KeyWords=${identifier}&ServiceObjectHash=&LimitSearchExtent=false&LimitResultCount=true&LimitResultCount=false&X-Requested-With=XMLHttpRequest&_=${Date.now()}`;

  const cookieString = Array.from(session.cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  const response = await fetch(searchUrl, {
    headers: {
      Accept: "*/*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://kais.cadastre.bg/bg/Map/Index",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookieString,
    },
  });

  if (response.status !== 200) {
    throw new Error(
      `FastSearch failed with status ${response.status} for ${identifier}`,
    );
  }

  // Update cookies from response
  const setCookieHeader = response.headers.get("set-cookie");
  if (setCookieHeader) {
    const cookiePairs = setCookieHeader.split(",").map((c) => c.trim());
    for (const pair of cookiePairs) {
      const match = pair.match(/^([^=]+)=([^;]+)/);
      if (match) {
        session.cookies.set(match[1], match[2]);
      }
    }
  }
}

/**
 * Step 2: ReadFoundObjects - Get search results
 */
async function readFoundObjects(
  session: CadastreSession,
): Promise<CadastreSearchResult | null> {
  const cookieString = Array.from(session.cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  const response = await fetch(
    "https://kais.cadastre.bg/bg/Map/ReadFoundObjects",
    {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://kais.cadastre.bg/bg/Map/Index",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-TOKEN": session.csrfToken,
        Cookie: cookieString,
      },
      body: "sort=&page=1&pageSize=10&group=&filter=",
    },
  );

  if (response.status !== 200) {
    throw new Error(`ReadFoundObjects failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!data.Data || data.Data.length === 0) {
    return null;
  }

  const result: CadastreSearchResult = data.Data[0];
  return result;
}

/**
 * Step 3: GetGeometry - Fetch actual geometry
 */
async function getGeometry(
  session: CadastreSession,
  searchResult: CadastreSearchResult,
): Promise<CadastreGeometryResponse | null> {
  const cookieString = Array.from(session.cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

  const formData = new URLSearchParams({
    IsChecked: "false",
    HistoryDate: "",
    OfficeId: searchResult.OfficeId,
    OtherData: "",
    DbId: "",
    Id: searchResult.Id,
    Type: searchResult.Type.toString(),
    SubType: "",
    Number: searchResult.Number,
    Title: searchResult.Title,
    ShortDescription: searchResult.ShortDescription,
    Description: "",
    IsAdditional: "false",
    Hash: searchResult.Hash.toString(),
  });

  const response = await fetch("https://kais.cadastre.bg/bg/Map/GetGeometry/", {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://kais.cadastre.bg/bg/Map/Index",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRF-TOKEN": session.csrfToken,
      Cookie: cookieString,
    },
    body: formData.toString(),
  });

  if (response.status !== 200) {
    throw new Error(`GetGeometry failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  const result: CadastreGeometryResponse = data[0];
  return result;
}

/**
 * Transform coordinates from BGS 2005 to WGS84 (EPSG:4326)
 * Automatically detects correct UTM zone based on spatial reference code
 */
function transformCoordinates(
  x: number,
  y: number,
  spatialRef: string,
): [number, number] {
  // Use the spatial reference from the API response to determine correct zone
  const sourceEPSG = `EPSG:${spatialRef}`;
  const [lng, lat] = proj4(sourceEPSG, "EPSG:4326", [x, y]);
  return [lng, lat];
}

/**
 * Convert ESRI JSON rings to GeoJSON polygon coordinates
 */
function convertESRIRingsToGeoJSON(
  esriRings: number[][][],
  spatialRef: string,
): [number, number][][] {
  return esriRings.map((ring) =>
    ring.map(([x, y]) => transformCoordinates(x, y, spatialRef)),
  );
}

/**
 * Geocode a single cadastral property identifier
 */
export async function geocodeCadastralProperty(
  identifier: string,
): Promise<CadastralGeometry | null> {
  try {
    logger.info("Geocoding cadastral property", { identifier });

    // Initialize session
    const session = await initializeSession();
    await delay(DELAY_BETWEEN_REQUESTS);

    // Step 1: FastSearch
    await fastSearch(session, identifier);
    await delay(DELAY_BETWEEN_REQUESTS);

    // Step 2: ReadFoundObjects
    const searchResult = await readFoundObjects(session);
    if (!searchResult) {
      logger.info("No cadastre results found", { identifier });
      return null;
    }

    await delay(DELAY_BETWEEN_REQUESTS);

    // Step 3: GetGeometry
    const geometryResponse = await getGeometry(session, searchResult);
    if (!geometryResponse) {
      logger.info("No cadastre geometry found", { identifier });
      return null;
    }

    // Validate spatial reference
    if (
      geometryResponse.SpatialReferenceCode !== "7801" &&
      geometryResponse.SpatialReferenceCode !== "7802"
    ) {
      logger.warn("Unexpected cadastre spatial reference", { spatialReferenceCode: geometryResponse.SpatialReferenceCode, expected: "7801 or 7802" });
    }

    // Convert coordinates using the spatial reference from the API
    const polygon = convertESRIRingsToGeoJSON(
      geometryResponse.Geometry.rings,
      geometryResponse.SpatialReferenceCode,
    );

    logger.info("Successfully geocoded cadastral property", { identifier, vertices: polygon[0].length });

    return {
      identifier,
      polygon,
    };
  } catch (error) {
    logger.error("Failed to geocode cadastral property", { identifier, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Geocode multiple cadastral properties with rate limiting
 */
export async function geocodeCadastralProperties(
  identifiers: string[],
): Promise<Map<string, CadastralGeometry>> {
  const results = new Map<string, CadastralGeometry>();

  for (const identifier of identifiers) {
    const geometry = await geocodeCadastralProperty(identifier);
    if (geometry) {
      results.set(identifier, geometry);
    }
    // Rate limiting is already applied within geocodeCadastralProperty
  }

  return results;
}
