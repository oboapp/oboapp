import { beforeEach, describe, it, expect, vi } from "vitest";
import { INTEREST_REPORT_PATH } from "@oboapp/shared";
import { loadInterestReport } from "./interest-coverage-store";

const mock = vi.hoisted(() => ({ download: vi.fn(), file: vi.fn() }));
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket() { return { file: mock.file }; }
  },
}));
const snapshot = { version: 1, locality: "bg.sofia", generatedAt: "2026-10-02T10:00:00.000Z", gridMeters: 2000, status: "unavailable", summary: null, cells: [] };

describe("static interest report loading", () => {
  beforeEach(() => {
    vi.stubEnv("GCS_GENERIC_BUCKET", "test-bucket");
    mock.file.mockReset().mockReturnValue({ download: mock.download });
    mock.download.mockReset().mockResolvedValue([Buffer.from(JSON.stringify(snapshot))]);
  });
  it("reads only the snapshot JSON, including its generation timestamp", async () => {
    expect(await loadInterestReport()).toEqual(snapshot);
    expect(mock.file).toHaveBeenCalledExactlyOnceWith(INTEREST_REPORT_PATH);
  });
  it("returns unavailable when no report has been generated", async () => {
    mock.download.mockRejectedValue(Object.assign(new Error("not found"), { code: 404 }));
    expect(await loadInterestReport()).toBeNull();
  });
  it("reads version 2 snapshots without legacy cell geometry", async () => {
    const imageSnapshot = { version: 2, locality: snapshot.locality, generatedAt: snapshot.generatedAt, status: "unavailable", summary: null, image: null };
    mock.download.mockResolvedValue([Buffer.from(JSON.stringify(imageSnapshot))]);
    expect(await loadInterestReport()).toEqual(imageSnapshot);
  });
  it("rejects report payloads containing raw interest fields", async () => {
    mock.download.mockResolvedValue([Buffer.from(JSON.stringify({ ...snapshot, interests: [{ userId: "secret" }] }))]);
    await expect(loadInterestReport()).rejects.toThrow();
  });
  it("propagates storage failures without treating them as empty coverage", async () => {
    mock.download.mockRejectedValue(new Error("GCS unavailable"));
    await expect(loadInterestReport()).rejects.toThrow("GCS unavailable");
  });
  it("does not access storage if report pages are unconfigured", async () => {
    vi.stubEnv("GCS_GENERIC_BUCKET", "");
    expect(await loadInterestReport()).toBeNull();
    expect(mock.file).not.toHaveBeenCalled();
  });
});
