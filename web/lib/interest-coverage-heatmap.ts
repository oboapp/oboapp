import type { LegacyInterestCoverageReport } from "@oboapp/shared";
import { INTEREST_HEATMAP_COLORS } from "@oboapp/shared";

const PIXELS_PER_CELL = 64;
const KERNEL_CUTOFF = 3;

// Image overlays are stretched in Web Mercator, so rasterize in that same space.
function projectLatitude(latitude: number) {
  return Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) * 180 / Math.PI;
}

function unprojectLatitude(y: number) {
  return (2 * Math.atan(Math.exp(y * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;
}

function rgb(hex: string) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}

/**
 * Render only public cell counts, never individual zone locations. Each cell
 * contributes one broad Gaussian weighted by its published user-band minimum.
 * Rasterizing once keeps geography and the report-wide color scale stable at
 * every zoom, without repeated point stamps or oversized shadow kernels.
 */
export function rasterizeInterestCoverage(cells: LegacyInterestCoverageReport["cells"]) {
  if (cells.length === 0) return null;

  const points = cells.map((cell) => {
    const north = projectLatitude(cell.north);
    const south = projectLatitude(cell.south);
    return {
      x: (cell.west + cell.east) / 2,
      y: (north + south) / 2,
      sigmaX: (cell.east - cell.west) / 2,
      sigmaY: (north - south) / 2,
      weight: cell.users.min,
    };
  });
  const west = Math.min(...points.map((p) => p.x - KERNEL_CUTOFF * p.sigmaX));
  const east = Math.max(...points.map((p) => p.x + KERNEL_CUTOFF * p.sigmaX));
  const south = Math.min(...points.map((p) => p.y - KERNEL_CUTOFF * p.sigmaY));
  const north = Math.max(...points.map((p) => p.y + KERNEL_CUTOFF * p.sigmaY));
  const cellWidth = Math.max(...points.map((p) => 2 * p.sigmaX));
  const cellHeight = Math.max(...points.map((p) => 2 * p.sigmaY));
  const width = Math.min(2048, Math.ceil((east - west) / cellWidth * PIXELS_PER_CELL));
  const height = Math.min(2048, Math.ceil((north - south) / cellHeight * PIXELS_PER_CELL));
  const density = new Float32Array(width * height);

  // Accumulate only within each kernel's footprint, rather than scanning all
  // cells for every pixel. Subtract the cutoff for a transparent, seamless edge.
  const edge = Math.exp(-(KERNEL_CUTOFF ** 2) / 2);
  for (const point of points) {
    const left = Math.max(0, Math.floor((point.x - KERNEL_CUTOFF * point.sigmaX - west) / (east - west) * width));
    const right = Math.min(width, Math.ceil((point.x + KERNEL_CUTOFF * point.sigmaX - west) / (east - west) * width));
    const top = Math.max(0, Math.floor((north - point.y - KERNEL_CUTOFF * point.sigmaY) / (north - south) * height));
    const bottom = Math.min(height, Math.ceil((north - point.y + KERNEL_CUTOFF * point.sigmaY) / (north - south) * height));
    for (let row = top; row < bottom; row++) {
      const y = north - (row + 0.5) / height * (north - south);
      for (let column = left; column < right; column++) {
        const x = west + (column + 0.5) / width * (east - west);
        const distanceSquared = ((x - point.x) / point.sigmaX) ** 2 + ((y - point.y) / point.sigmaY) ** 2;
        const kernel = Math.max(0, Math.exp(-distanceSquared / 2) - edge);
        density[row * width + column] += point.weight * kernel;
      }
    }
  }

  const peak = density.reduce((max, value) => Math.max(max, value), 0);
  const palette = INTEREST_HEATMAP_COLORS.map(rgb);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < density.length; index++) {
    const intensity = peak > 0 ? density[index] / peak : 0;
    // Keep faint coverage blue, then transition through amber to red.
    const position = Math.max(0, (intensity - 0.25) / 0.75) * (palette.length - 1);
    const lower = Math.min(palette.length - 2, Math.floor(position));
    const fraction = position - lower;
    for (let channel = 0; channel < 3; channel++) {
      pixels[index * 4 + channel] = palette[lower][channel] * (1 - fraction) + palette[lower + 1][channel] * fraction;
    }
    pixels[index * 4 + 3] = 210 * Math.min(1, intensity * 2);
  }

  return {
    width, height, pixels,
    bounds: { west, east, south: unprojectLatitude(south), north: unprojectLatitude(north) },
  };
}
