import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { validateApiKeyMock, getMessagesMock } = vi.hoisted(() => ({
  validateApiKeyMock: vi.fn(),
  getMessagesMock: vi.fn(),
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

vi.mock("@/app/api/messages/route", () => ({
  GET: getMessagesMock,
}));

describe("GET /api/v1/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when API key is invalid", async () => {
    validateApiKeyMock.mockResolvedValue(false);

    const request = new Request("http://localhost/api/v1/messages");
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(getMessagesMock).not.toHaveBeenCalled();
  });

  it("strips qualitySignals from addresses in the response", async () => {
    validateApiKeyMock.mockResolvedValue(true);
    getMessagesMock.mockResolvedValue(
      Response.json(
        {
          messages: [
            {
              id: "abc12345",
              text: "test",
              locality: "Sofia",
              createdAt: "2024-01-01T00:00:00.000Z",
              cityWide: false,
              addresses: [
                {
                  originalText: "ул. Витоша",
                  formattedAddress: "ул. Витоша, София",
                  coordinates: { lat: 42.697, lng: 23.321 },
                  qualitySignals: { provider: "google", geometryQuality: 3 },
                },
              ],
            },
          ],
        },
        { status: 200 },
      ),
    );

    const request = new Request(
      "http://localhost/api/v1/messages?north=42.7&categories=water",
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(getMessagesMock).toHaveBeenCalledWith(request);
    const body = await response.json();
    expect(body.messages[0].addresses[0]).not.toHaveProperty("qualitySignals");
    expect(body.messages[0].addresses[0].formattedAddress).toBe(
      "ул. Витоша, София",
    );
  });

  it("delegates to internal handler and passes through non-ok responses", async () => {
    validateApiKeyMock.mockResolvedValue(true);
    getMessagesMock.mockResolvedValue(
      Response.json({ error: "Server error" }, { status: 500 }),
    );

    const request = new Request(
      "http://localhost/api/v1/messages?north=42.7&sources=foo,bar&categories=water",
    );

    const response = await GET(request);

    expect(response.status).toBe(500);
    expect(getMessagesMock).toHaveBeenCalledTimes(1);
    expect(getMessagesMock).toHaveBeenCalledWith(request);
  });
});
