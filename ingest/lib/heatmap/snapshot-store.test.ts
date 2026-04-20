import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// GCS mock — set up before importing the module under test
// ---------------------------------------------------------------------------
const mockSave = vi.fn();
const mockDownload = vi.fn();
const mockExists = vi.fn();
const mockFile = vi.fn();
const mockBucket = vi.fn();

vi.mock("@google-cloud/storage", () => ({
  // Must use a regular function — arrow functions cannot be called with `new`
  Storage: vi.fn().mockImplementation(function () {
    return { bucket: mockBucket };
  }),
}));

import { saveHeatmapSnapshot, loadHeatmapSnapshot } from "./snapshot-store";
import type { HeatmapSnapshot } from "./snapshot-store";

const SAMPLE_SNAPSHOT: HeatmapSnapshot = {
  generatedAt: "2024-01-01T00:00:00.000Z",
  messages: [
    {
      id: "msg-1",
      source: "sofiyska-voda",
      categories: ["water"],
      cityWide: false,
      finalizedAt: "2024-01-01T00:00:00.000Z",
      points: [[42.6977, 23.3219]],
    },
  ],
};

describe("saveHeatmapSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFile.mockReturnValue({
      save: mockSave,
      exists: mockExists,
      download: mockDownload,
    });
    mockBucket.mockReturnValue({ file: mockFile });
    process.env.GCS_GENERIC_BUCKET = "test-bucket";
  });

  it("saves the snapshot as JSON to GCS", async () => {
    await saveHeatmapSnapshot(SAMPLE_SNAPSHOT);
    expect(mockSave).toHaveBeenCalledOnce();
    const [body, options] = mockSave.mock.calls[0];
    expect(JSON.parse(body)).toEqual(SAMPLE_SNAPSHOT);
    expect(options).toMatchObject({ contentType: "application/json" });
  });

  it("does nothing when GCS_GENERIC_BUCKET is not set", async () => {
    delete process.env.GCS_GENERIC_BUCKET;
    await saveHeatmapSnapshot(SAMPLE_SNAPSHOT);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe("loadHeatmapSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFile.mockReturnValue({
      save: mockSave,
      exists: mockExists,
      download: mockDownload,
    });
    mockBucket.mockReturnValue({ file: mockFile });
    process.env.GCS_GENERIC_BUCKET = "test-bucket";
  });

  it("returns null when GCS_GENERIC_BUCKET is not set", async () => {
    delete process.env.GCS_GENERIC_BUCKET;
    const result = await loadHeatmapSnapshot();
    expect(result).toBeNull();
  });

  it("returns null when the snapshot file does not exist", async () => {
    mockExists.mockResolvedValue([false]);
    const result = await loadHeatmapSnapshot();
    expect(result).toBeNull();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("returns parsed snapshot when file exists", async () => {
    mockExists.mockResolvedValue([true]);
    mockDownload.mockResolvedValue([
      Buffer.from(JSON.stringify(SAMPLE_SNAPSHOT)),
    ]);
    const result = await loadHeatmapSnapshot();
    expect(result).toEqual(SAMPLE_SNAPSHOT);
  });
});
