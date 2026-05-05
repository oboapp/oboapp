import { describe, it, expect } from "vitest";
import {
  gradeGoogle,
  gradeOverpass,
  gradeCadastre,
  gradeGtfs,
  gradeEducational,
  gradePrecomputed,
  gradeUnknown,
} from "./quality";
import {
  QUALITY_PROVIDERS,
  OSM_ELEMENT_TYPES,
  GOOGLE_LOCATION_TYPES,
} from "@oboapp/shared";

describe("gradeGoogle", () => {
  it("returns quality 0 when locationType is missing", () => {
    expect(gradeGoogle()).toEqual({
      provider: QUALITY_PROVIDERS.GOOGLE,
      geometryQuality: 0,
    });
  });

  it("returns quality 0 when locationType is undefined explicitly", () => {
    expect(gradeGoogle(undefined, false)).toEqual({
      provider: QUALITY_PROVIDERS.GOOGLE,
      geometryQuality: 0,
    });
  });

  it("returns quality 3 for ROOFTOP without partial match", () => {
    expect(gradeGoogle(GOOGLE_LOCATION_TYPES.ROOFTOP, false)).toEqual({
      provider: QUALITY_PROVIDERS.GOOGLE,
      locationType: GOOGLE_LOCATION_TYPES.ROOFTOP,
      partialMatch: false,
      geometryQuality: 3,
    });
  });

  it("returns quality 1 for ROOFTOP with partial match", () => {
    const result = gradeGoogle(GOOGLE_LOCATION_TYPES.ROOFTOP, true);
    expect(result.geometryQuality).toBe(1);
    expect(result.partialMatch).toBe(true);
  });

  it("returns quality 2 for RANGE_INTERPOLATED without partial match", () => {
    expect(
      gradeGoogle(GOOGLE_LOCATION_TYPES.RANGE_INTERPOLATED, false),
    ).toEqual({
      provider: QUALITY_PROVIDERS.GOOGLE,
      locationType: GOOGLE_LOCATION_TYPES.RANGE_INTERPOLATED,
      partialMatch: false,
      geometryQuality: 2,
    });
  });

  it("returns quality 1 for RANGE_INTERPOLATED with partial match", () => {
    const result = gradeGoogle(GOOGLE_LOCATION_TYPES.RANGE_INTERPOLATED, true);
    expect(result.geometryQuality).toBe(1);
  });

  it("returns quality 2 for GEOMETRIC_CENTER without partial match", () => {
    expect(gradeGoogle(GOOGLE_LOCATION_TYPES.GEOMETRIC_CENTER, false)).toEqual({
      provider: QUALITY_PROVIDERS.GOOGLE,
      locationType: GOOGLE_LOCATION_TYPES.GEOMETRIC_CENTER,
      partialMatch: false,
      geometryQuality: 2,
    });
  });

  it("returns quality 1 for GEOMETRIC_CENTER with partial match", () => {
    const result = gradeGoogle(GOOGLE_LOCATION_TYPES.GEOMETRIC_CENTER, true);
    expect(result.geometryQuality).toBe(1);
  });

  it("returns quality 1 for APPROXIMATE", () => {
    expect(gradeGoogle(GOOGLE_LOCATION_TYPES.APPROXIMATE)).toEqual({
      provider: QUALITY_PROVIDERS.GOOGLE,
      locationType: GOOGLE_LOCATION_TYPES.APPROXIMATE,
      geometryQuality: 1,
    });
  });

  it("returns quality 1 for unknown locationType with partialMatch", () => {
    const result = gradeGoogle("UNKNOWN_TYPE", true);
    expect(result.provider).toBe(QUALITY_PROVIDERS.GOOGLE);
    expect(result.geometryQuality).toBe(1);
  });

  it("returns quality 1 for unknown locationType without partialMatch", () => {
    const result = gradeGoogle("UNKNOWN_TYPE", false);
    expect(result.provider).toBe(QUALITY_PROVIDERS.GOOGLE);
    expect(result.geometryQuality).toBe(1);
  });
});

describe("gradeOverpass", () => {
  it("returns quality 2 for way", () => {
    expect(gradeOverpass(OSM_ELEMENT_TYPES.WAY)).toEqual({
      provider: QUALITY_PROVIDERS.OVERPASS,
      osmElementType: OSM_ELEMENT_TYPES.WAY,
      geometryQuality: 2,
    });
  });

  it("returns quality 1 for node", () => {
    expect(gradeOverpass(OSM_ELEMENT_TYPES.NODE)).toEqual({
      provider: QUALITY_PROVIDERS.OVERPASS,
      osmElementType: OSM_ELEMENT_TYPES.NODE,
      geometryQuality: 1,
    });
  });

  it("returns quality 1 for relation", () => {
    expect(gradeOverpass(OSM_ELEMENT_TYPES.RELATION)).toEqual({
      provider: QUALITY_PROVIDERS.OVERPASS,
      osmElementType: OSM_ELEMENT_TYPES.RELATION,
      geometryQuality: 1,
    });
  });

  it("returns quality 1 when elementType is undefined (fallback)", () => {
    expect(gradeOverpass()).toEqual({
      provider: QUALITY_PROVIDERS.OVERPASS,
      geometryQuality: 1,
    });
  });

  it("returns quality 1 for unknown element type (fallback)", () => {
    const result = gradeOverpass("area");
    expect(result.provider).toBe(QUALITY_PROVIDERS.OVERPASS);
    expect(result.geometryQuality).toBe(1);
  });
});

describe("gradeCadastre", () => {
  it("returns quality 3", () => {
    expect(gradeCadastre()).toEqual({
      provider: QUALITY_PROVIDERS.CADASTRE,
      geometryQuality: 3,
    });
  });
});

describe("gradeGtfs", () => {
  it("returns quality 3", () => {
    expect(gradeGtfs()).toEqual({
      provider: QUALITY_PROVIDERS.GTFS,
      geometryQuality: 3,
    });
  });
});

describe("gradeEducational", () => {
  it("returns quality 3", () => {
    expect(gradeEducational()).toEqual({
      provider: QUALITY_PROVIDERS.EDUCATIONAL,
      geometryQuality: 3,
    });
  });
});

describe("gradePrecomputed", () => {
  it("returns quality 3 for trust >= 0.9 (exact threshold)", () => {
    expect(gradePrecomputed(0.9)).toEqual({
      provider: QUALITY_PROVIDERS.PRECOMPUTED,
      geometryQuality: 3,
    });
  });

  it("returns quality 3 for trust = 1.0 (maximum)", () => {
    expect(gradePrecomputed(1.0)).toEqual({
      provider: QUALITY_PROVIDERS.PRECOMPUTED,
      geometryQuality: 3,
    });
  });

  it("returns quality 2 for trust just below 0.9", () => {
    expect(gradePrecomputed(0.89)).toEqual({
      provider: QUALITY_PROVIDERS.PRECOMPUTED,
      geometryQuality: 2,
    });
  });

  it("returns quality 2 for trust = 0 (minimum)", () => {
    expect(gradePrecomputed(0)).toEqual({
      provider: QUALITY_PROVIDERS.PRECOMPUTED,
      geometryQuality: 2,
    });
  });

  it("returns quality 2 for trust = 0.5 (mid-range)", () => {
    expect(gradePrecomputed(0.5)).toEqual({
      provider: QUALITY_PROVIDERS.PRECOMPUTED,
      geometryQuality: 2,
    });
  });
});

describe("gradeUnknown", () => {
  it("returns quality 0 with SOURCE provider", () => {
    expect(gradeUnknown()).toEqual({
      provider: QUALITY_PROVIDERS.SOURCE,
      geometryQuality: 0,
    });
  });
});
