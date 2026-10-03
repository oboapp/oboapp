import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../types";
import { NotificationMatchesRepository } from "./notification-matches";

describe("notification report pagination", () => {
  it("filters processed records and advances by ID with bounded projected pages", async () => {
    const findPage = vi
      .fn()
      .mockResolvedValue({ documents: [], nextCursor: null });
    const repository = new NotificationMatchesRepository({
      findPage,
    } as unknown as DbClient);
    await repository.findNotifiedPage(500);
    const after = { backend: "mongodb" as const, value: { nativeId: true } };
    await repository.findNotifiedPage(500, after);
    expect(findPage.mock.calls[0][1]).toMatchObject({
      where: [{ field: "notified", op: "==", value: true }],
      limit: 500,
    });
    expect(findPage.mock.calls[1][1].after).toBe(after);
    expect(findPage.mock.calls[1][1].select).toContain("deviceNotifications");
  });
});
