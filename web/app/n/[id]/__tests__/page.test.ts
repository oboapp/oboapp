import { describe, it, expect, vi, beforeEach } from "vitest";
import NotificationRedirectPage from "../page";

const { findByIdMock, updateOneMock } = vi.hoisted(() => ({
  findByIdMock: vi.fn(),
  updateOneMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn().mockResolvedValue({
    notificationMatches: {
      findById: findByIdMock,
      updateOne: updateOneMock,
    },
  }),
}));

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn().mockImplementation((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT: ${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};307;`,
    });
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

function makeParams(id: string) {
  return Promise.resolve({ id });
}

describe("NotificationRedirectPage (/n/[id])", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation((url: string) => {
      throw Object.assign(new Error(`NEXT_REDIRECT: ${url}`), {
        digest: `NEXT_REDIRECT;replace;${url};307;`,
      });
    });
  });

  it("redirects to / when match is not found", async () => {
    findByIdMock.mockResolvedValue(null);

    await expect(
      NotificationRedirectPage({ params: makeParams("unknown-id") }),
    ).rejects.toThrow("NEXT_REDIRECT: /");

    expect(findByIdMock).toHaveBeenCalledWith("unknown-id");
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it("records clickedAt and redirects to the message (first click)", async () => {
    findByIdMock.mockResolvedValue({
      _id: "match-1",
      messageId: "msg-abc",
      clickedAt: null,
    });
    updateOneMock.mockResolvedValue(undefined);

    await expect(
      NotificationRedirectPage({ params: makeParams("match-1") }),
    ).rejects.toThrow("NEXT_REDIRECT: /?messageId=msg-abc");

    expect(findByIdMock).toHaveBeenCalledWith("match-1");
    expect(updateOneMock).toHaveBeenCalledWith("match-1", {
      clickedAt: expect.any(String),
    });
  });

  it("skips write but still redirects when already clicked (idempotent)", async () => {
    findByIdMock.mockResolvedValue({
      _id: "match-1",
      messageId: "msg-abc",
      clickedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(
      NotificationRedirectPage({ params: makeParams("match-1") }),
    ).rejects.toThrow("NEXT_REDIRECT: /?messageId=msg-abc");

    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it("URL-encodes messageId in the redirect target", async () => {
    findByIdMock.mockResolvedValue({
      _id: "match-2",
      messageId: "msg with spaces/slashes",
      clickedAt: null,
    });
    updateOneMock.mockResolvedValue(undefined);

    await expect(
      NotificationRedirectPage({ params: makeParams("match-2") }),
    ).rejects.toThrow(
      `NEXT_REDIRECT: /?messageId=${encodeURIComponent("msg with spaces/slashes")}`,
    );
  });

  it("redirects to / when messageId is empty string", async () => {
    findByIdMock.mockResolvedValue({
      _id: "match-3",
      messageId: "",
      clickedAt: null,
    });

    await expect(
      NotificationRedirectPage({ params: makeParams("match-3") }),
    ).rejects.toThrow("NEXT_REDIRECT: /");

    expect(updateOneMock).not.toHaveBeenCalled();
  });
});
