import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsReportAggregator } from "./report-aggregation";
import { saveNotificationsReportSnapshot } from "./report-store";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  file: vi.fn(),
  storage: vi.fn(),
}));
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    constructor(options: unknown) {
      mocks.storage(options);
    }
    bucket() {
      return { file: mocks.file };
    }
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GCS_GENERIC_BUCKET", "test");
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", "");
  mocks.file.mockReturnValue({ save: mocks.save });
  mocks.save.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("notifications report storage", () => {
  const snapshot = new NotificationsReportAggregator().snapshot(
    new Date("2026-10-02T12:00:00Z"),
  );
  it("writes the validated public report at the path consumed by the web route", async () => {
    await saveNotificationsReportSnapshot(snapshot);
    expect(mocks.file).toHaveBeenCalledWith("notifications/report.json");
    expect(mocks.save).toHaveBeenCalledWith(JSON.stringify(snapshot), {
      contentType: "application/json",
    });
  });
  it("fails if the bucket is missing instead of silently reporting success", async () => {
    vi.stubEnv("GCS_GENERIC_BUCKET", "");
    await expect(saveNotificationsReportSnapshot(snapshot)).rejects.toThrow(
      "GCS_GENERIC_BUCKET",
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("uses application default credentials even when a Firebase key is configured", async () => {
    vi.stubEnv(
      "FIREBASE_SERVICE_ACCOUNT_KEY",
      JSON.stringify({
        client_email: "firebase@example.com",
        private_key: "firebase-key",
      }),
    );
    await saveNotificationsReportSnapshot(snapshot);
    expect(mocks.storage).toHaveBeenCalledWith(undefined);
  });
  it("propagates upload failures so the job exits unsuccessfully", async () => {
    mocks.save.mockRejectedValue(new Error("upload failed"));
    await expect(saveNotificationsReportSnapshot(snapshot)).rejects.toThrow(
      "upload failed",
    );
  });
});
