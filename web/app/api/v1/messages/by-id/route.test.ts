import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { validateApiKeyMock, getMessageByIdMock } = vi.hoisted(() => ({
  validateApiKeyMock: vi.fn(),
  getMessageByIdMock: vi.fn(),
}));

vi.mock("@/lib/withApiKey", () => ({
  validateApiKey: validateApiKeyMock,
  apiKeyUnauthorizedResponse: vi.fn(() =>
    Response.json(
      {
        error:
          "Invalid or missing API key. Provide a valid X-Api-Key request header.",
      },
      { status: 401 },
    ),
  ),
}));

vi.mock("@/app/api/messages/by-id/route", () => ({
  GET: getMessageByIdMock,
}));

describe("GET /api/v1/messages/by-id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when API key is invalid", async () => {
    validateApiKeyMock.mockResolvedValue(false);

    const request = new Request(
      "http://localhost/api/v1/messages/by-id?id=abc123",
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(getMessageByIdMock).not.toHaveBeenCalled();
  });

  it("returns 401 when X-Api-Key header is missing", async () => {
    validateApiKeyMock.mockResolvedValue(false);

    const request = new Request(
      "http://localhost/api/v1/messages/by-id?id=abc123",
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain("X-Api-Key");
  });

  it("delegates to getMessageById when API key is valid", async () => {
    validateApiKeyMock.mockResolvedValue(true);
    getMessageByIdMock.mockResolvedValue(
      Response.json(
        {
          message: {
            id: "abc12345",
            text: "test",
            locality: "Sofia",
            createdAt: "2024-01-01T00:00:00.000Z",
            cityWide: false,
          },
        },
        { status: 200 },
      ),
    );

    const request = new Request(
      "http://localhost/api/v1/messages/by-id?id=abc12345",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(getMessageByIdMock).toHaveBeenCalledTimes(1);
    expect(getMessageByIdMock).toHaveBeenCalledWith(request);
    const body = await response.json();
    expect(body.message.id).toBe("abc12345");
    expect(body.message.text).toBe("test");
  });

  it("forwards error responses from the underlying handler", async () => {
    validateApiKeyMock.mockResolvedValue(true);
    getMessageByIdMock.mockResolvedValue(
      Response.json({ error: "Message not found" }, { status: 404 }),
    );

    const request = new Request(
      "http://localhost/api/v1/messages/by-id?id=nonexistent",
    );
    const response = await GET(request);

    expect(response.status).toBe(404);
    expect(getMessageByIdMock).toHaveBeenCalledTimes(1);
  });
});
