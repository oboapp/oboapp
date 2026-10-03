import { describe, it, expect, vi } from "vitest";
import { generateInterestReport } from "./generate";

function dependencies() {
  return { readInterests: vi.fn().mockResolvedValue([]), save: vi.fn().mockResolvedValue(undefined), jitterSecret: "test-only-stable-key-with-at-least-32-bytes" };
}
describe("static interest report generation", () => {
  it("rejects a missing key before reading private data or publishing", async () => {
    const deps = { ...dependencies(), jitterSecret: "" };
    await expect(generateInterestReport(deps, "bg.sofia")).rejects.toThrow("JITTER_SECRET");
    expect(deps.readInterests).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });
  it("replaces the prior map with an unavailable snapshot when privacy checks fail", async () => {
    const deps = dependencies();
    await generateInterestReport(deps, "bg.sofia");
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ version: 2, status: "unavailable", image: null, summary: null }));
  });
  it("keeps dry-runs read-only", async () => {
    const deps = dependencies();
    await generateInterestReport(deps, "bg.sofia", true);
    expect(deps.save).not.toHaveBeenCalled();
  });
  it("does not replace the snapshot when reading source data fails", async () => {
    const deps = dependencies();
    deps.readInterests.mockRejectedValue(new Error("DB unavailable"));
    await expect(generateInterestReport(deps, "bg.sofia")).rejects.toThrow("DB unavailable");
    expect(deps.save).not.toHaveBeenCalled();
  });
});
