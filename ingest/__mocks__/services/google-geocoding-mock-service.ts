import { readFileSync } from "node:fs";
import type { Address } from "@/lib/types";
import { gradeGoogle } from "@/geocoding/shared/quality";
import { GOOGLE_LOCATION_TYPES } from "@/geocoding/shared/google-location-types";

export class GoogleGeocodingMockService {
  private customFixturePath: string | null = null;

  constructor() {
    this.customFixturePath = process.env.GEOCODING_FIXTURE_PATH || null;
  }

  async geocodeAddress(address: string): Promise<Address | null> {
    // Use custom fixture if specified
    if (this.customFixturePath) {
      return JSON.parse(readFileSync(this.customFixturePath, "utf-8"));
    }

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Return minimal mock data - Sofia center coordinates with ROOFTOP quality
    // Developers can add real fixtures over time
    const qualitySignals = gradeGoogle(GOOGLE_LOCATION_TYPES.ROOFTOP, false);

    return {
      originalText: address,
      formattedAddress: "Sofia, Bulgaria",
      coordinates: {
        lat: 42.6977,
        lng: 23.3219,
      },
      qualitySignals,
    };
  }

  async geocodeAddresses(addresses: string[]): Promise<Address[]> {
    const results: Address[] = [];
    for (const addr of addresses) {
      const result = await this.geocodeAddress(addr);
      if (result) {
        results.push(result);
      }
    }
    return results;
  }
}
