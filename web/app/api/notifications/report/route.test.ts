import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  download: vi.fn(),
  storage: vi.fn(),
}));
vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    constructor(options: unknown) {
      mocks.storage(options);
    }
    bucket() {
      return {
        file: () => ({ exists: mocks.exists, download: mocks.download }),
      };
    }
  },
}));

const snapshot = {
  version: 1,
  generatedAt: "2026-10-02T12:00:00.000Z",
  periodStart: null,
  periodEnd: null,
  firstRecordedClickAt: null,
  kpis: {
    processed: 8,
    sent: 3,
    uniqueUsers: 2,
    failed: 2,
    noSubscriptions: 1,
    unknownDelivery: 2,
    clicked: 1,
    opened: 2,
  },
  sources: [
    {
      source: "test",
      processed: 8,
      sent: 3,
      failed: 2,
      noSubscriptions: 1,
      unknownDelivery: 2,
      clicked: 1,
      opened: 2,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GCS_GENERIC_BUCKET", "test-bucket");
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", "");
  mocks.exists.mockResolvedValue([true]);
  mocks.download.mockResolvedValue([Buffer.from(JSON.stringify(snapshot))]);
});
afterEach(() => vi.unstubAllEnvs());

describe("notifications report API", () => {
  it("serves the validated snapshot and cache headers without querying the database", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=3600");
  });
  it("does not expose fields outside the public schema", async () => {
    mocks.download.mockResolvedValue([
      Buffer.from(
        JSON.stringify({
          ...snapshot,
          userIds: ["private"],
          sources: [{ ...snapshot.sources[0], token: "private" }],
        }),
      ),
    ]);
    const response = await GET();
    expect(await response.json()).toEqual(snapshot);
  });
  it("returns 503 when reports are disabled", async () => {
    vi.stubEnv("GCS_GENERIC_BUCKET", " ");
    expect((await GET()).status).toBe(503);
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it("returns 503 until the first snapshot has been generated", async () => {
    mocks.exists.mockResolvedValue([false]);
    expect((await GET()).status).toBe(503);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("rejects malformed or old snapshots rather than inventing zero metrics", async () => {
    mocks.download.mockResolvedValue([
      Buffer.from(JSON.stringify({ kpis: { sent: -1 } })),
    ]);
    expect((await GET()).status).toBe(500);
  });
  it("handles GCS failures", async () => {
    mocks.download.mockRejectedValue(new Error("unavailable"));
    expect((await GET()).status).toBe(500);
  });
  it("uses configured service-account credentials when provided", async () => {
    vi.stubEnv(
      "FIREBASE_SERVICE_ACCOUNT_KEY",
      JSON.stringify({ client_email: "test@example.com" }),
    );
    await GET();
    expect(mocks.storage).toHaveBeenCalledWith({
      credentials: { client_email: "test@example.com" },
    });
  });
});
