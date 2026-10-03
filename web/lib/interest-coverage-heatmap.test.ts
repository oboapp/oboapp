import { describe, expect, it } from "vitest";
import { rasterizeInterestCoverage } from "./interest-coverage-heatmap";

function cell(west: number, min = 20, south = 42.68) {
  return { south, north: south + 0.018, west, east: west + 0.024, users: { min, max: min + 9 } };
}

type Raster = NonNullable<ReturnType<typeof rasterizeInterestCoverage>>;

function pixel(raster: Raster, x: number, y: number) {
  const offset = (y * raster.width + x) * 4;
  return [...raster.pixels.slice(offset, offset + 4)];
}

function projectLatitude(latitude: number) {
  return Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
}

function atLocation(raster: Raster, latitude: number, longitude: number) {
  const { bounds, width, height } = raster;
  const x = Math.floor((longitude - bounds.west) / (bounds.east - bounds.west) * width);
  const y = Math.floor((projectLatitude(bounds.north) - projectLatitude(latitude)) /
    (projectLatitude(bounds.north) - projectLatitude(bounds.south)) * height);
  return pixel(raster, x, y);
}

describe("interest coverage heatmap raster", () => {
  it("does not invent coverage for an empty report", () => {
    expect(rasterizeInterestCoverage([])).toBeNull();
  });

  it("renders a symmetric, soft hotspot without clipped quadrants or hard edges", () => {
    const raster = rasterizeInterestCoverage([cell(23.3)])!;
    const centerX = Math.floor(raster.width / 2);
    const centerY = Math.floor(raster.height / 2);
    expect(pixel(raster, centerX, centerY)[3]).toBe(210);
    let maximumAsymmetry = 0;
    for (let y = 0; y < raster.height; y++) {
      for (let x = 0; x < raster.width; x++) {
        for (let channel = 0; channel < 4; channel++) {
          const value = raster.pixels[(y * raster.width + x) * 4 + channel];
          const reflectedX = raster.pixels[(y * raster.width + raster.width - 1 - x) * 4 + channel];
          const reflectedY = raster.pixels[((raster.height - 1 - y) * raster.width + x) * 4 + channel];
          maximumAsymmetry = Math.max(maximumAsymmetry, Math.abs(value - reflectedX), Math.abs(value - reflectedY));
        }
      }
    }
    expect(maximumAsymmetry).toBe(0);
    expect(pixel(raster, centerX, 0)[3]).toBe(0);
    expect(pixel(raster, 0, centerY)[3]).toBe(0);
    expect(pixel(raster, centerX, centerY + 60)[3]).toBeGreaterThan(0);
    expect(pixel(raster, centerX, centerY + 60)[3]).toBeLessThan(210);
  });

  it("makes the area with more people hotter and preserves geographic orientation", () => {
    const raster = rasterizeInterestCoverage([cell(23.3, 10), cell(23.5, 40, 42.8)])!;
    const cooler = atLocation(raster, 42.689, 23.312);
    const hotter = atLocation(raster, 42.809, 23.512);
    expect(cooler[2]).toBeGreaterThan(cooler[0]);
    expect(hotter[0]).toBeGreaterThan(hotter[2]);
    expect(cooler[3]).toBeLessThan(hotter[3]);
    expect(atLocation(raster, 42.689, 23.512)[3]).toBe(0);
  });

  it("smoothly connects neighboring cells without repeated artificial peaks", () => {
    const raster = rasterizeInterestCoverage([cell(23.3), cell(23.324)])!;
    const left = atLocation(raster, 42.689, 23.312);
    const middle = atLocation(raster, 42.689, 23.324);
    const right = atLocation(raster, 42.689, 23.336);
    expect(middle[3]).toBe(210);
    expect(Math.abs(middle[0] - left[0])).toBeLessThan(25);
    expect(Math.abs(middle[0] - right[0])).toBeLessThan(25);
  });

  it("uses the same report-wide relative scale regardless of count magnitude", () => {
    const original = rasterizeInterestCoverage([cell(23.3, 10), cell(23.5, 40)])!;
    const scaled = rasterizeInterestCoverage([cell(23.3, 20), cell(23.5, 80)])!;
    expect(original.bounds).toEqual(scaled.bounds);
    expect(Buffer.from(original.pixels).equals(Buffer.from(scaled.pixels))).toBe(true);
  });

  it("leaves distant unpublished areas transparent", () => {
    const raster = rasterizeInterestCoverage([cell(23.3), cell(23.5)])!;
    expect(atLocation(raster, 42.689, 23.412)[3]).toBe(0);
    expect(raster.bounds.west).toBeLessThan(23.3);
    expect(raster.bounds.east).toBeGreaterThan(23.524);
  });
});
