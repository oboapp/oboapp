import { readFileSync } from "node:fs";
import type { Address, Coordinates } from "@/lib/types";
import type { Position } from "geojson";
import { gradeOverpass } from "@/geocoding/shared/quality";

export class OverpassMockService {
  private customFixturePath: string | null = null;

  constructor() {
    this.customFixturePath = process.env.OVERPASS_FIXTURE_PATH || null;
  }

  async overpassGeocodeIntersections(
    intersections: string[],
  ): Promise<Address[]> {
    // Use custom fixture if specified
    if (this.customFixturePath) {
      const data = JSON.parse(readFileSync(this.customFixturePath, "utf-8"));
      if (!Array.isArray(data))
        throw new Error(
          `OVERPASS_FIXTURE_PATH fixture must be a JSON array, got ${typeof data}: ${this.customFixturePath}`,
        );
      // Ensure qualitySignals are present
      return data.map((addr: Address) => ({
        ...addr,
        qualitySignals: addr.qualitySignals || gradeOverpass("node"),
      }));
    }

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Return empty - Overpass data requires real API calls
    // Developers can add fixtures for specific intersections over time
    return [];
  }

  async getStreetSectionGeometry(
    streetName: string,
    startCoords: Coordinates,
    endCoords: Coordinates,
  ): Promise<Position[] | null> {
    // Use custom fixture if specified
    if (this.customFixturePath) {
      const data = JSON.parse(readFileSync(this.customFixturePath, "utf-8"));
      return data.geometry || null;
    }

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Return null - Overpass data requires real API calls
    return null;
  }

  async overpassGeocodeAddresses(addresses: string[]): Promise<Address[]> {
    // Use custom fixture if specified
    if (this.customFixturePath) {
      const data = JSON.parse(readFileSync(this.customFixturePath, "utf-8"));
      if (!Array.isArray(data))
        throw new Error(
          `OVERPASS_FIXTURE_PATH fixture must be a JSON array, got ${typeof data}: ${this.customFixturePath}`,
        );
      // Ensure qualitySignals are present
      return data.map((addr: Address) => ({
        ...addr,
        qualitySignals: addr.qualitySignals || gradeOverpass("node"),
      }));
    }

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Return empty - Overpass data requires real API calls
    // Developers can add fixtures for specific addresses over time
    return [];
  }
}
