import { PNG } from "pngjs";
import {
  INTEREST_BLUR_METERS, INTEREST_HEATMAP_COLORS, INTEREST_HEATMAP_FULL_USERS,
  INTEREST_MIN_PIXEL_USERS, INTEREST_RASTER_METERS,
} from "@oboapp/shared";

function blur(values: Float32Array, width: number, height: number) {
  const sigma = INTEREST_BLUR_METERS / INTEREST_RASTER_METERS;
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)));
  const total = kernel.reduce((sum, weight) => sum + weight, 0);
  const weights = kernel.map((weight) => weight / total);
  const horizontal = new Float32Array(values.length);
  const result = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let k = -radius; k <= radius; k++) {
        if (x + k >= 0 && x + k < width) horizontal[y * width + x] += values[y * width + x + k] * weights[k + radius];
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let k = -radius; k <= radius; k++) {
        if (y + k >= 0 && y + k < height) result[y * width + x] += horizontal[(y + k) * width + x] * weights[k + radius];
      }
    }
  }
  return result;
}

/** Suppress BEFORE smoothing: isolated people contribute no recoverable pixels. */
export function renderInterestImage(counts: Uint32Array, width: number, height: number) {
  const eligible = Float32Array.from(counts, (count) => count < INTEREST_MIN_PIXEL_USERS
    ? 0 : Math.floor(count / INTEREST_MIN_PIXEL_USERS) * INTEREST_MIN_PIXEL_USERS);
  if (!eligible.some((count) => count > 0)) return null;
  const density = blur(eligible, width, height);
  const palette = INTEREST_HEATMAP_COLORS.map((hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)));
  const png = new PNG({ width, height });
  for (let index = 0; index < density.length; index++) {
    // Absolute scale: a small cluster never becomes red just because it is the
    // largest in this snapshot. Neither viewport nor population renormalizes it.
    const intensity = Math.min(1, density[index] / INTEREST_HEATMAP_FULL_USERS);
    const position = Math.max(0, (intensity - 0.25) / 0.75) * (palette.length - 1);
    const lower = Math.min(palette.length - 2, Math.floor(position));
    const fraction = position - lower;
    const alpha = Math.round(230 * (1 - Math.exp(-density[index] / 15)));
    if (alpha === 0) continue; // Leave all RGBA channels zero, not just alpha.
    for (let channel = 0; channel < 3; channel++) {
      png.data[index * 4 + channel] = Math.round(palette[lower][channel] * (1 - fraction) + palette[lower + 1][channel] * fraction);
    }
    png.data[index * 4 + 3] = alpha;
  }
  return { width, height, dataUrl: `data:image/png;base64,${PNG.sync.write(png).toString("base64")}` };
}
