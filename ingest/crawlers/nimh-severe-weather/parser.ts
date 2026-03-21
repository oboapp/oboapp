import type {
  WeatherPageData,
  WarningCell,
  WarningLevel,
  WarningType,
} from "./types";
import { logger } from "@/lib/logger";

/**
 * Column mapping for the weather warning table
 */
const COLUMN_TYPES: WarningType[] = [
  "high_temperature",
  "low_temperature",
  "wind",
  "rain",
  "snow_ice",
];

/**
 * Parse warning level from CSS class, image, or cell content
 * If explicit color indicators are not found but cell has content, assume yellow
 */
function parseWarningLevel(cellHtml: string, cellText: string): WarningLevel {
  // Look for color indicators in class names, image sources, or Bulgarian text
  const htmlLower = cellHtml.toLowerCase();

  // Check for red indicators
  if (
    htmlLower.includes("red") ||
    htmlLower.includes("червен") ||
    htmlLower.includes("много опасно") ||
    htmlLower.includes("_r.") ||
    htmlLower.includes("level4") ||
    htmlLower.includes("danger4")
  ) {
    return "red";
  }

  // Check for orange indicators
  if (
    htmlLower.includes("orange") ||
    htmlLower.includes("оранжев") ||
    htmlLower.includes("опасно") ||
    htmlLower.includes("_o.") ||
    htmlLower.includes("level3") ||
    htmlLower.includes("danger3")
  ) {
    return "orange";
  }

  // Check for yellow indicators
  if (
    htmlLower.includes("yellow") ||
    htmlLower.includes("жълт") ||
    htmlLower.includes("потенциално") ||
    htmlLower.includes("_y.") ||
    htmlLower.includes("level2") ||
    htmlLower.includes("danger2")
  ) {
    return "yellow";
  }

  // If there's text content in the cell, it means there's a warning - assume yellow
  // (NIMH doesn't publish "green" warnings with text, only active warnings)
  if (cellText.trim().length > 0) {
    return "yellow";
  }

  return "green";
}

/**
 * Extract notes from a warning cell
 * Notes are typically separated by semicolons or line breaks
 */
function parseNotes(cellText: string): string[] {
  if (!cellText.trim()) {
    return [];
  }

  // Split by semicolons and filter empty entries
  return cellText
    .split(";")
    .map((note) => note.trim())
    .filter((note) => note.length > 0);
}

/**
 * Parse the weather warning page HTML
 *
 * Expected structure:
 * - Forecast date in header
 * - Recommendation text after "прогноза за:"
 * - Table with columns: Община | Висока температура | Ниска температура | Вятър | Дъжд | Сняг и/или поледица
 */
export function parseWeatherPage(html: string): WeatherPageData | null {
  // Extract forecast date (format: прогноза за: DD.MM.YYYY or similar)
  const forecastDateRegex =
    /прогноза за[:\s]+(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/i;
  const forecastDateMatch = forecastDateRegex.exec(html);
  if (!forecastDateMatch) {
    logger.warn("Could not find forecast date in HTML", { sourceType: "nimh-severe-weather" });
    return null;
  }

  const [, day, month, year] = forecastDateMatch;
  const forecastDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

  // Extract issued date (format: издадена на: YYYY-MM-DD HH:MM:SS)
  const issuedRegex =
    /издадена на[:\s]+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/i;
  const issuedMatch = issuedRegex.exec(html);
  const issuedAt = issuedMatch
    ? `${issuedMatch[1]}-${issuedMatch[2]}-${issuedMatch[3]}T${issuedMatch[4]}:${issuedMatch[5]}:${issuedMatch[6]}`
    : new Date().toISOString();

  // Extract recommendation text (between "прогноза за: DATE" and "издадена на:")
  const recommendationRegex =
    /прогноза за[:\s]+\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}\s*([\s\S]*?)(?=издадена на:|<table)/i;
  const recommendationMatch = recommendationRegex.exec(html);
  const recommendation = recommendationMatch
    ? recommendationMatch[1].replaceAll(/<[^>]+>/g, "").trim()
    : "";

  // Find Sofia row in the table
  const sofiaWarnings = parseSofiaRow(html);

  return {
    forecastDate,
    issuedAt,
    recommendation,
    sofiaWarnings,
  };
}

/**
 * Parse the Sofia municipality row from the warning table
 */
function parseSofiaRow(html: string): WarningCell[] {
  const warnings: WarningCell[] = [];

  // Find table rows containing "Столична" (Sofia municipality)
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/gi);
  if (!tableMatch) {
    return warnings;
  }

  for (const table of tableMatch) {
    // Look for row with Столична
    const rowRegex = /<tr[^>]*>[\s\S]*?Столична[\s\S]*?<\/tr>/i;
    const rowMatch = rowRegex.exec(table);
    if (!rowMatch) {
      continue;
    }

    // Extract all cells from the row
    const cellMatches = rowMatch[0].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
    if (!cellMatches) {
      continue;
    }

    // Skip first cell (municipality name), process remaining 5 warning columns
    for (let i = 1; i < cellMatches.length && i <= 5; i++) {
      const cellHtml = cellMatches[i];
      const cellText = cellHtml.replaceAll(/<[^>]+>/g, "").trim();
      const level = parseWarningLevel(cellHtml, cellText);
      const notes = parseNotes(cellText);

      // Only add if there's actual content (not green/empty)
      if (notes.length > 0 || level !== "green") {
        warnings.push({
          type: COLUMN_TYPES[i - 1],
          level,
          notes,
        });
      }
    }

    // Found Sofia row, stop searching
    break;
  }

  return warnings;
}

/**
 * Phrases that indicate no danger
 * (keep lowercased for case-insensitive comparisons)
 */
const NO_DANGER_PHRASES = [
  "няма опасност",
  "без опасност",
  "не се очаква опасност",
];

/**
 * Check if the parsed data contains any actual warnings
 */
export function hasActiveWarnings(data: WeatherPageData): boolean {
  // Has any non-green warnings (green is always ignored)
  if (data.sofiaWarnings.some((w) => w.level !== "green")) {
    return true;
  }

  // Check recommendation text - only counts if it's not a "no danger" message
  if (data.recommendation.length > 0) {
    const lowerRec = data.recommendation.toLowerCase();
    const isNoDanger = NO_DANGER_PHRASES.some((phrase) =>
      lowerRec.includes(phrase),
    );
    return !isNoDanger;
  }

  return false;
}
