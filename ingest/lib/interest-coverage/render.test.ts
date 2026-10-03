import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { renderInterestImage } from "./render";

function render(count: number) {
  const image = renderInterestImage(new Uint32Array(40 * 40).fill(count), 40, 40);
  if (!image) throw new Error("Expected an image");
  return PNG.sync.read(Buffer.from(image.dataUrl.split(",")[1], "base64"));
}
function center(png: PNG) { return [...png.data.subarray((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 4)]; }

describe("interest heatmap image", () => {
  it("suppresses one and two people before any blur", () => {
    expect(renderInterestImage(new Uint32Array(1600).fill(1), 40, 40)).toBeNull();
    expect(renderInterestImage(new Uint32Array(1600).fill(2), 40, 40)).toBeNull();
  });
  it("keeps small clusters faint and makes larger clusters hotter and more opaque", () => {
    const low = center(render(3));
    const high = center(render(30));
    expect(low[3]).toBeLessThan(50);
    expect(low[2]).toBeGreaterThan(low[0]);
    expect(high[3]).toBeGreaterThan(190);
    expect(high[0]).toBeGreaterThan(high[2]);
  });
  it("publishes the same pixels within each three-person count band", () => {
    expect(render(3).data).toEqual(render(5).data);
  });
  it("does not put hidden RGB information in fully transparent pixels", () => {
    const counts = new Uint32Array(1600);
    counts[20 * 40 + 20] = 10;
    const image = renderInterestImage(counts, 40, 40)!;
    const png = PNG.sync.read(Buffer.from(image.dataUrl.split(",")[1], "base64"));
    for (let offset = 0; offset < png.data.length; offset += 4) {
      if (png.data[offset + 3] === 0) expect([...png.data.subarray(offset, offset + 4)]).toEqual([0, 0, 0, 0]);
    }
  });
});
