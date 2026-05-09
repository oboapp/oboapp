/** TypeScript interface definitions for geocoding provider configuration */

export type PinsResolver =
  | { readonly provider: "google" }
  | { readonly provider: "overpass" };

export type StreetsResolver =
  | { readonly provider: "overpass" }
  | { readonly provider: "google" };

export type CadastralPropertiesResolver =
  | { readonly provider: "cadastre" }
  | { readonly provider: "skip" };

export type BusStopsResolver =
  | { readonly provider: "gtfs"; readonly url: string }
  | { readonly provider: "google" }
  | { readonly provider: "overpass" }
  | { readonly provider: "skip" };

export type EducationalFacilitiesResolver =
  | {
      readonly provider: "educational-facilities";
      readonly "schools-url": string;
      readonly "kindergartens-url": string;
    }
  | { readonly provider: "google" }
  | { readonly provider: "skip" };

export interface GeocodingResolverConfig {
  readonly pins: PinsResolver;
  readonly streets: StreetsResolver;
  readonly "cadastral-properties": CadastralPropertiesResolver;
  readonly "bus-stops": BusStopsResolver;
  readonly "educational-facilities": EducationalFacilitiesResolver;
}

export interface GeocodingSourceMetadata {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}
