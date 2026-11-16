import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { OpenAPIObject } from "openapi3-ts/oas30";
import { openapiRoute } from "./openapi";

const app = new Hono().route("/v1", openapiRoute);

describe("source snapshot OpenAPI contract", () => {
  it("documents the authenticated snapshot response and error cases", async () => {
    const response = await app.request("/v1/openapi");
    const document = (await response.json()) as OpenAPIObject;

    expect(response.status).toBe(200);
    expect(document.paths?.["/v1/sources/{sourceId}/snapshot"]?.get).toMatchObject({
      security: [{ ApiKeyAuth: [] }],
      parameters: [{ name: "sourceId", in: "path", required: true }],
      responses: {
        "200": {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/V1SourceSnapshotResponse" },
            },
          },
        },
        "401": expect.any(Object),
        "404": expect.any(Object),
        "429": expect.objectContaining({
          headers: expect.objectContaining({ "Retry-After": expect.any(Object) }),
        }),
        "500": expect.any(Object),
      },
    });
    expect(document.components?.schemas?.V1SourceSnapshotResponse).toMatchObject({
      required: ["snapshot"],
      properties: {
        snapshot: document.components?.schemas?.V1SourceSnapshot,
      },
    });
    expect(document.components?.schemas?.V1SourceSnapshot).toMatchObject({
      required: ["sourceType", "locality", "count", "observedAt", "sourceUrl"],
      properties: {
        count: { type: "integer", minimum: 0 },
        observedAt: { type: "string", format: "date-time" },
        sourceUrl: { type: "string", format: "uri" },
      },
    });
  });
});
