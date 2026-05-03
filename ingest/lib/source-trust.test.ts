import { describe, it, expect } from "vitest";
import { getSourceTrust } from "./source-trust";

describe("getSourceTrust", () => {
  it("returns trust 1.0 for toplo-bg", () => {
    const entry = getSourceTrust("toplo-bg");
    expect(entry).toEqual({ trust: 1.0 });
  });

  it("returns trust 1.0 for sofiyska-voda", () => {
    const entry = getSourceTrust("sofiyska-voda");
    expect(entry).toEqual({ trust: 1.0 });
  });

  it("returns trust 0.9 for erm-zapad", () => {
    const entry = getSourceTrust("erm-zapad");
    expect(entry).toEqual({ trust: 0.9 });
  });

  it("returns trust 0.8 for municipality sources", () => {
    const entry = getSourceTrust("sofia-bg");
    expect(entry).toEqual({ trust: 0.8 });
  });

  it("returns defaults for unknown source", () => {
    const entry = getSourceTrust("nonexistent-source");
    expect(entry).toEqual({ trust: 0.5 });
  });
});
